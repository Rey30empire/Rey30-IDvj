import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: h.error } }))

import { usePrompt } from '@/hooks/usePrompt'
import { useCharacterAudio } from '@/lib/characters/audio'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { ComposerDictation } from '../ComposerDictation'

let heard: ((text: string) => void) | undefined
const startDictation = vi.fn(async (onText: (text: string) => void, options?: { owner?: string }) => {
  heard = onText
  useCharacterAudio.setState({ owner: options?.owner ?? null, status: 'listening' })
})
const finishDictation = vi.fn(async () => {
  heard?.('y luego pruébalo')
  useCharacterAudio.setState({ status: 'idle' })
})

beforeEach(() => {
  vi.clearAllMocks()
  heard = undefined
  usePrompt.setState({ prompt: '' })
  useAvatarVoiceSession.setState({ open: false, active: false, phase: 'idle' })
  useCharacterAudio.setState({ status: 'idle', owner: null, error: null, dictation: true, catalogLoaded: true, loadCatalog: vi.fn(async () => undefined), startDictation, finishDictation })
})

describe('dictado del espacio de trabajo', () => {
  it('escribe lo que dices en la caja, sin enviarlo', async () => {
    usePrompt.setState({ prompt: 'Revisa el proyecto' })
    render(<ComposerDictation />)
    fireEvent.click(screen.getByRole('button', { name: 'Dictar por voz' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Terminar dictado' })).toHaveAttribute('aria-pressed', 'true'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Terminar dictado' })) })
    expect(usePrompt.getState().prompt).toBe('Revisa el proyecto y luego pruébalo')
    expect(screen.getByRole('button', { name: 'Dictar por voz' })).toBeEnabled()
  })

  it('pausa una llamada de voz para usar el micrófono', async () => {
    useAvatarVoiceSession.setState({ open: true, active: true, phase: 'ready' })
    render(<ComposerDictation />)
    fireEvent.click(screen.getByRole('button', { name: 'Dictar por voz' }))
    await waitFor(() => expect(startDictation).toHaveBeenCalled())
    expect(useAvatarVoiceSession.getState().active).toBe(false)
  })

  it('avisa si falta el dictado local', async () => {
    useCharacterAudio.setState({ dictation: false })
    render(<ComposerDictation />)
    fireEvent.click(screen.getByRole('button', { name: 'Dictar por voz' }))
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Falta el dictado local en español. Puedes escribir mientras tanto.'))
    expect(startDictation).not.toHaveBeenCalled()
  })

  it('explica el error del micrófono', async () => {
    startDictation.mockImplementationOnce(async (_onText, options) => { useCharacterAudio.setState({ owner: options?.owner ?? null, status: 'error', error: 'Conecta un micrófono.' }) })
    render(<ComposerDictation />)
    fireEvent.click(screen.getByRole('button', { name: 'Dictar por voz' }))
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Conecta un micrófono.'))
  })

  it('no se puede usar mientras el agente trabaja', () => {
    render(<ComposerDictation disabled />)
    expect(screen.getByRole('button', { name: 'Dictar por voz' })).toBeDisabled()
  })
})
