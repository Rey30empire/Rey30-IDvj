import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlumaCloneReference } from '../PlumaCloneReference'
import type { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'

type Controls = ReturnType<typeof usePlumaCloneReference>
const voices = [{ file: 'Pluma.wav', name: 'Pluma', bytes: 100 }, { file: 'Nueva voz.mp3', name: 'Nueva voz', bytes: 200 }]
const controls = (over: Partial<Controls> = {}): Controls => ({
  reference: { ready: true, format: 'wav', name: 'Pluma' },
  lore: { root: 'C:\\Proyecto\\Lore', voices, selected: 'Pluma.wav' },
  busy: false,
  error: undefined,
  choose: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
  pickLore: vi.fn(async () => undefined),
  saveRecording: vi.fn(async () => undefined),
  refreshLore: vi.fn(async () => undefined),
  openLore: vi.fn(async () => undefined),
  ...over,
})

describe('voces de Lore para Pluma', () => {
  it('muestra la voz de Lore en uso y cambia a otra de la carpeta', () => {
    const value = controls()
    render(<PlumaCloneReference controls={value} active={false} />)
    const select = screen.getByTestId('lore-voice') as HTMLSelectElement
    expect(select.value).toBe('Pluma.wav')
    expect(screen.getByRole('status')).toHaveTextContent('Habla con la voz «Pluma» de Lore.')
    fireEvent.change(select, { target: { value: 'Nueva voz.mp3' } })
    expect(value.pickLore).toHaveBeenCalledWith('Nueva voz.mp3')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir carpeta' }))
    expect(value.openLore).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    expect(value.refreshLore).toHaveBeenCalled()
  })

  it('una muestra elegida a mano no se confunde con una voz de Lore', () => {
    render(<PlumaCloneReference controls={controls({ reference: { ready: true, format: 'mp3', name: null } })} active={false} singing />)
    expect((screen.getByTestId('lore-song-voice') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: 'Muestra elegida a mano' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Muestra MP3 de canto guardada.')
  })

  it('cambia de voz sin colgar; solo quitar la muestra espera a una pausa', () => {
    const value = controls()
    render(<PlumaCloneReference controls={value} active />)
    expect(screen.getByTestId('lore-voice')).toBeEnabled()
    fireEvent.change(screen.getByTestId('lore-voice'), { target: { value: 'Nueva voz.mp3' } })
    expect(value.pickLore).toHaveBeenCalledWith('Nueva voz.mp3')
    expect(screen.getByText(/Puedes cambiar de voz sin colgar: la usa desde su próxima frase\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Otro archivo…' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Grabar mi voz' })).toBeEnabled()
    expect(screen.getByText(/Al grabar tu voz, la llamada se pausa/)).toBeInTheDocument()
  })

  it('grabar durante la llamada la pausa primero para liberar el micrófono', async () => {
    const { useAvatarVoiceSession } = await import('@/stores/useAvatarVoiceSession')
    useAvatarVoiceSession.getState().openFor('literatura', null)
    useAvatarVoiceSession.getState().start()
    render(<PlumaCloneReference controls={controls()} active />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Grabar mi voz' })) })
    expect(useAvatarVoiceSession.getState().active).toBe(false)
    useAvatarVoiceSession.getState().close()
  })

  it('ofrece grabar la voz propia para hablar y para cantar', () => {
    render(<PlumaCloneReference controls={controls()} active={false} />)
    expect(screen.getByRole('button', { name: 'Grabar mi voz' })).toBeEnabled()
    render(<PlumaCloneReference controls={controls()} active={false} singing />)
    expect(screen.getByRole('button', { name: 'Grabarme cantando' })).toBeEnabled()
  })

  it('sin carpeta Lore se comporta como antes', () => {
    render(<PlumaCloneReference controls={controls({ lore: undefined, reference: { ready: false } })} active={false} />)
    expect(screen.queryByTestId('lore-voice')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir carpeta' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grabar mi voz' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elegir WAV o MP3' })).toBeEnabled()
  })
})
