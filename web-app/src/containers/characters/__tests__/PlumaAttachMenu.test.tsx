import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
// The menu opens on pointer events jsdom does not send; its items are shown as plain buttons here.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button type="button" onClick={onSelect}>{children}</button>,
}))

const { PlumaAttachMenu } = await import('../PlumaAttachMenu')
const { documentText } = await import('@/lib/characters/pluma-reading')

describe('adjuntar documentos en el chat de Pluma', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.toast.warning.mockReset()
    h.toast.error.mockReset()
  })

  it('un documento se adjunta entero, ya leído, para ir dentro del mensaje', async () => {
    h.invoke.mockImplementation(async (command: string) => command === 'pluma_reading_choose' ? 'C:\\Textos\\carta.md'
      : { title: 'carta', sections: [{ title: 'carta.md', text: 'Querida Ana:\r\n\r\n\r\n\r\nTe escribo desde la lluvia.' }] })
    const onAttach = vi.fn()
    render(<PlumaAttachMenu onAttach={onAttach} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Agregar documento/ })) })
    await waitFor(() => expect(onAttach).toHaveBeenCalled())
    expect(h.invoke).toHaveBeenCalledWith('pluma_reading_choose', { folder: false })
    expect(h.invoke).toHaveBeenCalledWith('pluma_reading_open', { path: 'C:\\Textos\\carta.md' })
    expect(onAttach.mock.calls[0][0]).toMatchObject({
      name: 'carta', type: 'document', path: 'C:\\Textos\\carta.md', fileType: 'md',
      parseMode: 'inline', processed: true, injectionMode: 'inline', inlineContent: 'Querida Ana:\n\nTe escribo desde la lluvia.',
    })
  })

  it('una carpeta se adjunta con cada archivo bajo su nombre', async () => {
    h.invoke.mockImplementation(async (command: string) => command === 'pluma_reading_choose' ? 'C:\\Novela'
      : { title: 'Novela', sections: [{ title: '01.md', text: 'Capítulo uno.' }, { title: '02.txt', text: 'Capítulo dos.' }, { title: 'vacío.txt', text: '  12  ' }] })
    const onAttach = vi.fn()
    render(<PlumaAttachMenu onAttach={onAttach} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agregar carpeta' })) })
    await waitFor(() => expect(onAttach).toHaveBeenCalled())
    expect(h.invoke).toHaveBeenCalledWith('pluma_reading_choose', { folder: true })
    expect(onAttach.mock.calls[0][0]).toMatchObject({ name: 'Novela', fileType: 'carpeta', inlineContent: '## 01.md\n\nCapítulo uno.\n\n## 02.txt\n\nCapítulo dos.' })
  })

  it('cerrar el diálogo no adjunta nada, y un archivo sin texto lo avisa', async () => {
    h.invoke.mockResolvedValueOnce(null)
    const onAttach = vi.fn()
    render(<PlumaAttachMenu onAttach={onAttach} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Agregar documento/ })) })
    expect(onAttach).not.toHaveBeenCalled()
    h.invoke.mockImplementation(async (command: string) => command === 'pluma_reading_choose' ? 'C:\\vacío.txt' : { title: 'vacío', sections: [{ title: 'vacío.txt', text: ' 3 ' }] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Agregar documento/ })) })
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('No encontré texto en «vacío».'))
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('un texto muy largo se corta y se avisa', () => {
    expect(documentText('Libro', [{ title: 'a', text: 'palabra '.repeat(10) }], 20)).toEqual({ title: 'Libro', text: 'palabra palabra pala', cut: true })
  })
})
