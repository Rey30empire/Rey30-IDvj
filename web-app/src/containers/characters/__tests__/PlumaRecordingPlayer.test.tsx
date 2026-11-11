import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ url: vi.fn(), download: vi.fn(), remove: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/characters/pluma-recording', () => ({
  plumaRecordingUrl: h.url,
  downloadPlumaRecording: h.download,
  deletePlumaRecording: h.remove,
}))
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }))

import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { PlumaRecordingPlayer } from '../PlumaRecordingPlayer'

const recording = { threadId: 'chat', file: 'audio.wav', kind: 'song' as const }
const createdAt = new Date(2026, 10, 9, 14, 32).getTime()
const show = async () => {
  render(<PlumaRecordingPlayer recording={recording} messageId="m1" createdAt={createdAt} align="start" />)
  await waitFor(() => expect(screen.getByLabelText('Escuchar canción')).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  h.url.mockResolvedValue('asset://audio.wav')
  h.download.mockResolvedValue(true)
  h.remove.mockResolvedValue(undefined)
  useAvatarVoiceSession.setState({ open: false, active: false, phase: 'idle' })
})

describe('reproductor de grabaciones de Pluma', () => {
  it('permite volver a escuchar sin la descarga propia del navegador', async () => {
    await show()
    const audio = screen.getByLabelText('Escuchar canción')
    expect(audio).toHaveAttribute('src', 'asset://audio.wav')
    expect(audio).toHaveAttribute('controlslist', 'nodownload')
  })

  it('pausa la llamada al reproducir, para que el micrófono no se oiga a sí mismo', async () => {
    await show()
    useAvatarVoiceSession.setState({ open: true, active: true, phase: 'ready' })
    fireEvent.play(screen.getByLabelText('Escuchar canción'))
    expect(useAvatarVoiceSession.getState()).toMatchObject({ open: true, active: false, phase: 'paused' })
  })

  it('descarga con un nombre claro y avisa al terminar', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    expect(h.download).toHaveBeenCalledWith(recording, 'Cancion de Pluma 2026-11-09 14-32')
    await waitFor(() => expect(h.success).toHaveBeenCalledWith('Audio guardado.'))
  })

  it('no dice nada si cierras el diálogo de guardar', async () => {
    h.download.mockResolvedValue(false)
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled())
    expect(h.success).not.toHaveBeenCalled()
  })

  it('pide confirmar antes de eliminar', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar canción' }))
    expect(h.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByRole('button', { name: 'Eliminar canción' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar canción' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' })) })
    expect(h.remove).toHaveBeenCalledWith(recording, 'm1')
  })

  it('avisa si no se pudo eliminar y deja volver a intentarlo', async () => {
    h.remove.mockRejectedValue(new Error('en uso'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar canción' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' })) })
    expect(h.error).toHaveBeenCalledWith('No se pudo eliminar el audio.')
    expect(screen.getByRole('button', { name: 'Eliminar canción' })).toBeEnabled()
  })

  it('explica cuando el archivo ya no existe', async () => {
    h.url.mockRejectedValue(new Error('no existe'))
    render(<PlumaRecordingPlayer recording={recording} messageId="m1" createdAt={createdAt} align="start" />)
    await waitFor(() => expect(screen.getByTestId('pluma-recording-missing')).toHaveTextContent('Este audio ya no está disponible.'))
  })
})
