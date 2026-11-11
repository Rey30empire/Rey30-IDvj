import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ choose: vi.fn(), open: vi.fn() }))
vi.mock('@/lib/characters/pluma-reading', async original => ({
  ...await original<typeof import('@/lib/characters/pluma-reading')>(),
  choosePlumaReading: h.choose,
  openPlumaBook: h.open,
}))

import { usePlumaReading } from '@/stores/usePlumaReading'
import { PlumaReadingPanel } from '../PlumaReadingPanel'

const book = { path: 'C:\\Libros\\Rayuela.pdf', title: 'Rayuela', total: 200 }
const show = (reading?: { title: string; percent: number }) => {
  const onRead = vi.fn()
  const onStop = vi.fn()
  render(<PlumaReadingPanel reading={reading} onRead={onRead} onStop={onStop} />)
  return { onRead, onStop }
}

beforeEach(() => {
  vi.clearAllMocks()
  usePlumaReading.setState({ book: null, positions: {} })
  h.open.mockImplementation(async (path: string) => usePlumaReading.getState().open({ ...book, path }))
})

describe('panel del modo lectura', () => {
  it('abre lo que eliges en el selector o una ruta pegada', async () => {
    h.choose.mockResolvedValueOnce('C:\\Libros\\Rayuela.pdf').mockResolvedValueOnce(null)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir archivo' }))
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('C:\\Libros\\Rayuela.pdf'))
    expect(h.choose).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Elegir carpeta' }))
    await waitFor(() => expect(h.choose).toHaveBeenCalledWith(true))
    expect(h.open).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Ruta del libro o carpeta'), { target: { value: '"D:\\Cuentos"' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('"D:\\Cuentos"'))
  })

  it('explica por qué no pudo abrir una ruta', async () => {
    h.open.mockRejectedValue(new Error('No encontré ese archivo o carpeta.'))
    show()
    fireEvent.change(screen.getByLabelText('Ruta del libro o carpeta'), { target: { value: 'C:\\nada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No encontré ese archivo o carpeta.'))
  })

  it('sigue donde quedó o empieza de nuevo', () => {
    usePlumaReading.setState({ book, positions: { [book.path]: 50 } })
    const { onRead } = show()
    expect(screen.getByRole('status')).toHaveTextContent('«Rayuela» · 25 %')
    fireEvent.click(screen.getByRole('button', { name: 'Seguir leyendo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desde el inicio' }))
    expect(onRead.mock.calls).toEqual([[false], [true]])
  })

  it('un libro terminado se vuelve a leer desde el principio', () => {
    usePlumaReading.setState({ book, positions: { [book.path]: 200 } })
    const { onRead } = show()
    expect(screen.getByRole('status')).toHaveTextContent('terminado')
    fireEvent.click(screen.getByRole('button', { name: 'Leer' }))
    expect(onRead).toHaveBeenCalledWith(true)
  })

  it('mientras lee solo deja detenerla', () => {
    usePlumaReading.setState({ book, positions: {} })
    const { onStop } = show({ title: 'Rayuela', percent: 30 })
    expect(screen.getByRole('status')).toHaveTextContent('«Rayuela» · 30 % · leyendo')
    expect(screen.getByRole('button', { name: 'Quitar libro' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Detener lectura' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('quita el libro sin borrar dónde quedó', () => {
    usePlumaReading.setState({ book, positions: { [book.path]: 50 } })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar libro' }))
    expect(usePlumaReading.getState()).toMatchObject({ book: null, positions: { [book.path]: 50 } })
  })
})
