import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from '@rey30-idvj/core'

const hub = vi.hoisted(() => ({
  invoke: vi.fn(),
  createThread: vi.fn(),
  createMessage: vi.fn(async (message: unknown) => message),
  updateThread: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: hub.invoke }),
    threads: () => ({ createThread: hub.createThread, updateThread: hub.updateThread }),
    messages: () => ({ createMessage: hub.createMessage }),
    path: () => ({ sep: () => '/' }),
  }),
}))
vi.mock('../assistant-integration', () => ({
  toCharacterAssistant: (profile: { name: string }) => ({ id: 'character:literatura', name: profile.name, instructions: '', created_at: 0, parameters: {} }),
  preferredCharacterModel: () => ({ providerId: 'llamacpp', modelId: 'gemma' }),
}))

import { useMessages } from '@/hooks/useMessages'
import { useThreads } from '@/hooks/useThreads'
import { useChatSessions } from '@/stores/chat-session-store'
import { createPlumaCallHistory, plumaChatMemory, type PlumaCallTurn } from '../pluma-call-history'
import type { CharacterProfile } from '../types'

const profile = { id: 'literatura', name: 'Plumita' } as CharacterProfile
const pcmBase64 = btoa('\0\0\x01\0')
const clip = { samples: [Float32Array.of(0.5, -0.5)], sampleRate: 24000 }
const turn = (extra: Partial<PlumaCallTurn> = {}): PlumaCallTurn => ({ pcmBase64, understood: true, said: 'Hola, soy Plumita.', voice: clip, ...extra })
const textOf = (message: ThreadMessage) => message.content[0]?.text?.value
const recordingOf = (message: ThreadMessage) => (message.metadata as { plumaRecording?: { kind: string; file: string } }).plumaRecording
const stored = (threadId: string) => useMessages.getState().getMessages(threadId)
const existing = (id: string) => useThreads.setState({ threads: { [id]: { id, title: 'Chat', updated: 0, assistants: [] } as unknown as Thread } })

let saved = 0
beforeEach(() => {
  vi.clearAllMocks()
  saved = 0
  useMessages.setState({ messages: {} })
  useChatSessions.setState({ sessions: {} })
  useThreads.setState({ threads: {}, currentThreadId: undefined })
  hub.createThread.mockImplementation(async thread => ({ ...thread, id: 'llamada' }))
  hub.invoke.mockImplementation(async (command: string) => {
    if (command === 'character_audio_transcribe') return { text: 'hola plumita' }
    if (command === 'pluma_recording_save') return `audio-${++saved}.wav`
  })
})

function history(threadId?: string) {
  const onThread = vi.fn()
  const onError = vi.fn()
  return { onThread, onError, ...createPlumaCallHistory({ profile, threadId, onThread, onError }) }
}

describe('historial de las llamadas de Pluma', () => {
  it('desde el inicio crea un chat sin abrirlo y deja cada voz con su audio', async () => {
    const call = history()
    await call.record(turn())
    expect(hub.createThread).toHaveBeenCalledTimes(1)
    expect(hub.createThread.mock.calls[0][0].title).toMatch(/^Llamada con Plumita · /)
    expect(hub.createThread.mock.calls[0][0].metadata).toEqual({ literaryLibrary: true })
    expect(call.onThread).toHaveBeenCalledWith('llamada')
    expect(useThreads.getState().currentThreadId).toBeUndefined()
    expect(useThreads.getState().threads.llamada).toBeDefined()
    const [user, assistant] = stored('llamada')
    expect(user.role).toBe('user')
    expect(textOf(user)).toBe('hola plumita')
    expect(recordingOf(user)).toEqual({ threadId: 'llamada', file: 'audio-1.wav', kind: 'user' })
    expect(assistant.role).toBe('assistant')
    expect(textOf(assistant)).toBe('Hola, soy Plumita.')
    expect(recordingOf(assistant)).toEqual({ threadId: 'llamada', file: 'audio-2.wav', kind: 'voice' })
    expect(assistant.created_at).toBeGreaterThan(user.created_at)
    expect(call.onError).not.toHaveBeenCalled()
  })

  it('lo escrito durante la llamada aparece al momento, sin audio, y su respuesta después', async () => {
    const call = history()
    await call.typed('Escribe un haiku')
    expect(stored('llamada').map(textOf)).toEqual(['Escribe un haiku'])
    expect(recordingOf(stored('llamada')[0])).toBeUndefined()
    await call.record(turn({ pcmBase64: '', transcript: 'Escribe un haiku', typed: true, said: 'Luna sobre el mar.' }))
    const [user, assistant] = stored('llamada')
    expect(stored('llamada')).toHaveLength(2)
    expect(textOf(user)).toBe('Escribe un haiku')
    expect(textOf(assistant)).toBe('Luna sobre el mar.')
    expect(recordingOf(assistant)).toEqual({ threadId: 'llamada', file: 'audio-1.wav', kind: 'voice' })
    expect(hub.invoke.mock.calls.some(([command]) => command === 'character_audio_transcribe')).toBe(false)
    expect(hub.createThread).toHaveBeenCalledTimes(1)
  })

  it('reconoce tu voz sin ocupar el turno de audio de la llamada', async () => {
    await history().record(turn())
    expect(hub.invoke).toHaveBeenCalledWith('character_audio_transcribe', expect.objectContaining({ pcmBase64, background: true }))
  })

  it('escribe en el chat donde ya estás y no crea otro', async () => {
    existing('abierto')
    const call = history('abierto')
    await call.record(turn())
    expect(hub.createThread).not.toHaveBeenCalled()
    expect(stored('abierto')).toHaveLength(2)
  })

  it('usa un solo chat para toda la llamada', async () => {
    const call = history()
    await Promise.all([call.record(turn()), call.record(turn({ said: 'Segundo.' }))])
    expect(hub.createThread).toHaveBeenCalledTimes(1)
    expect(stored('llamada').map(textOf)).toEqual(['hola plumita', 'Hola, soy Plumita.', 'hola plumita', 'Segundo.'])
  })

  it('aprovecha el texto si la llamada ya reconoció la frase', async () => {
    await history().record(turn({ transcript: 'ya reconocido' }))
    expect(hub.invoke.mock.calls.some(([command]) => command === 'character_audio_transcribe')).toBe(false)
    expect(textOf(stored('llamada')[0])).toBe('ya reconocido')
  })

  it('ignora el ruido que no se entendió', async () => {
    hub.invoke.mockImplementation(async (command: string) => command === 'character_audio_transcribe' ? { text: '' } : undefined)
    await history().record(turn({ understood: false, said: 'No te entendí bien.' }))
    expect(hub.createThread).not.toHaveBeenCalled()
  })

  it('marca como mensaje de voz lo que Gemma entendió y el dictado no', async () => {
    hub.invoke.mockImplementation(async (command: string) => command === 'character_audio_transcribe' ? { text: '' } : 'audio.wav')
    await history().record(turn())
    expect(textOf(stored('llamada')[0])).toBe('(Mensaje de voz)')
  })

  it('deja el texto aunque no se pueda guardar el audio', async () => {
    hub.invoke.mockImplementation(async (command: string) => {
      if (command === 'character_audio_transcribe') return { text: 'hola' }
      throw new Error('disco lleno')
    })
    const call = history()
    await call.record(turn())
    expect(stored('llamada').map(textOf)).toEqual(['hola', 'Hola, soy Plumita.'])
    expect(stored('llamada').some(recordingOf)).toBe(false)
    expect(call.onError).toHaveBeenCalled()
  })

  it('guarda la canción con su letra línea por línea y su audio', async () => {
    await history().record(turn({ said: '', voice: undefined, song: { lyrics: 'Cae la lluvia\nLa noche canta', audio: clip } }))
    const [, song] = stored('llamada')
    expect(textOf(song)).toBe('**Canción**\n\nCae la lluvia  \nLa noche canta')
    expect(recordingOf(song)?.kind).toBe('song')
  })

  it('aparece en el chat abierto en vivo, pero no se mete en una respuesta en curso', async () => {
    existing('abierto')
    const chat = { status: 'ready', messages: [] as unknown[] }
    useChatSessions.setState({ sessions: { abierto: { chat } } as never })
    const call = history('abierto')
    await call.record(turn())
    expect(chat.messages).toHaveLength(2)
    expect((chat.messages[1] as { metadata: { plumaRecording: { kind: string } } }).metadata.plumaRecording.kind).toBe('voice')
    chat.status = 'streaming'
    await call.record(turn())
    expect(chat.messages).toHaveLength(2)
    expect(stored('abierto')).toHaveLength(4)
  })

  it('enlaza los turnos en un chat con versiones para que no se pierdan', async () => {
    existing('versiones')
    useMessages.setState({ messages: { versiones: [{ id: 'raiz', thread_id: 'versiones', role: 'user', content: [], created_at: 1, metadata: { parentId: null } } as unknown as ThreadMessage] } })
    await history('versiones').record(turn())
    const [, user, assistant] = stored('versiones')
    expect((user.metadata as { parentId: string }).parentId).toBe('raiz')
    expect((assistant.metadata as { parentId: string }).parentId).toBe(user.id)
  })

  it('espera el texto que la llamada reconoce en segundo plano', async () => {
    await history().record(turn({ transcript: Promise.resolve('dicho en la llamada') }))
    expect(hub.invoke.mock.calls.some(([command]) => command === 'character_audio_transcribe')).toBe(false)
    expect(textOf(stored('llamada')[0])).toBe('dicho en la llamada')
  })

  it('una llamada nueva en el mismo chat retoma lo que se habló, por voz o por escrito', async () => {
    existing('abierto')
    const text = (id: string, role: string, value: string, created: number) => ({ id, thread_id: 'abierto', role, created_at: created, content: [{ type: 'text', text: { value, annotations: [] } }] }) as unknown as ThreadMessage
    useMessages.setState({ messages: { abierto: [text('a', 'user', 'Me llamo Rey.', 1), text('b', 'assistant', 'Hola, Rey.', 2), text('c', 'user', 'Cuéntame algo.', 3)] } })
    expect(await plumaChatMemory('abierto')).toEqual([{ role: 'user', content: 'Me llamo Rey.' }, { role: 'assistant', content: 'Hola, Rey.' }])
    expect(await plumaChatMemory(null)).toEqual([])
  })

  it('si no se puede crear el chat avisa y sigue con el siguiente turno', async () => {
    hub.createThread.mockRejectedValueOnce(new Error('sin disco'))
    const call = history()
    await call.record(turn())
    expect(call.onError).toHaveBeenCalledTimes(1)
    await call.record(turn({ said: 'Sigo aquí.' }))
    expect(stored('llamada').map(textOf)).toEqual(['hola plumita', 'Sigo aquí.'])
  })
})
