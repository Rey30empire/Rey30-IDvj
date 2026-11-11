import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ choose: vi.fn(), data: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/characters/avatar-image', async original => ({
  ...await original<typeof import('@/lib/characters/avatar-image')>(),
  chooseAvatarImage: h.choose,
  avatarImageData: h.data,
  deleteAvatarImage: h.remove,
}))

import { AvatarPortraitEditor } from '../AvatarPortraitEditor'

const file = '67e55044-10b1-426f-9247-bb680e5fe0c8.png'

// A 400×400 picture shown at 200×200: each tap counts double in picture pixels.
async function openMarking() {
  const onChange = vi.fn()
  render(<AvatarPortraitEditor builtInSrc="/hologram/plumita.png" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar imagen' }))
  const image = await screen.findByAltText('Imagen elegida para el holograma') as HTMLImageElement
  Object.defineProperty(image, 'naturalWidth', { value: 400 })
  Object.defineProperty(image, 'naturalHeight', { value: 400 })
  image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 200, right: 210, bottom: 220, x: 10, y: 20, toJSON: () => ({}) })
  const tap = (x: number, y: number) => fireEvent.click(image, { clientX: 10 + x, clientY: 20 + y })
  return { onChange, tap }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.choose.mockResolvedValue(file)
  h.data.mockResolvedValue('data:image/png;base64,AAAA')
})

describe('editor de la imagen del holograma', () => {
  it('guía las tres marcas y entrega la cara en píxeles de la imagen', async () => {
    const { onChange, tap } = await openMarking()
    expect(screen.getByRole('status')).toHaveTextContent('izquierda')
    tap(50, 60)
    expect(screen.getByRole('status')).toHaveTextContent('derecha')
    tap(90, 60)
    expect(screen.getByRole('status')).toHaveTextContent('boca')
    tap(70, 100)
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta imagen' }))
    expect(onChange).toHaveBeenCalledWith({ file, leftEye: [100, 120], rightEye: [180, 120], mouth: [140, 200] })
    expect(h.remove).not.toHaveBeenCalled()
  })

  it('no acepta marcas en mal orden y deja volver a marcar', async () => {
    const { onChange, tap } = await openMarking()
    tap(90, 60)
    tap(50, 60)
    tap(70, 100)
    expect(screen.getByRole('alert')).toHaveTextContent('izquierda')
    expect(screen.getByRole('button', { name: 'Usar esta imagen' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a marcar' }))
    expect(screen.getByRole('status')).toHaveTextContent('izquierda')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('al cancelar borra la copia que no se usó', async () => {
    const { onChange } = await openMarking()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(h.remove).toHaveBeenCalledWith(file)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('avatar-portrait')).toBeInTheDocument()
  })

  it('no hace nada si cierras el selector', async () => {
    h.choose.mockResolvedValue(null)
    render(<AvatarPortraitEditor onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar imagen' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cambiar imagen' })).toBeEnabled())
    expect(screen.queryByTestId('avatar-portrait-marking')).toBeNull()
  })

  it('vuelve a la imagen original', async () => {
    const onChange = vi.fn()
    render(<AvatarPortraitEditor value={{ file, leftEye: [1, 1], rightEye: [9, 1], mouth: [5, 9] }} builtInSrc="/hologram/plumita.png" onChange={onChange} />)
    await waitFor(() => expect(screen.getByAltText('Imagen actual del holograma')).toHaveAttribute('src', 'data:image/png;base64,AAAA'))
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la original' }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('explica que un asistente sin imagen aparece como esfera', () => {
    render(<AvatarPortraitEditor onChange={vi.fn()} />)
    expect(screen.getByText(/se muestra como esfera/)).toBeInTheDocument()
  })
})
