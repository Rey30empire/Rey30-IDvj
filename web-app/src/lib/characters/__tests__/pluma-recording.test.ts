import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from '@rey30-idvj/core'

const hub = vi.hoisted(() => ({ invoke: vi.fn(), modifyMessage: vi.fn(async () => undefined), deleteMessage: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: hub.invoke, convertFileSrc: (path: string) => `asset://${path}` }),
    messages: () => ({ modifyMessage: hub.modifyMessage, deleteMessage: hub.deleteMessage }),
  }),
}))

import { useMessages } from '@/hooks/useMessages'
import { useChatSessions } from '@/stores/chat-session-store'
import { deletePlumaRecording, downloadPlumaRecording, plumaRecordingOf, plumaRecordingUrl, type PlumaRecording } from '../pluma-recording'

const recording: PlumaRecording = { threadId: 'chat', file: 'audio.wav', kind: 'song' }
const message = { id: 'm1', thread_id: 'chat', role: 'assistant', content: [], metadata: { plumaRecording: recording, parentId: 'p' } } as unknown as ThreadMessage

beforeEach(() => {
  vi.clearAllMocks()
  hub.invoke.mockResolvedValue(undefined)
  useMessages.setState({ messages: { chat: [message] } })
  useChatSessions.setState({ sessions: {} })
})

describe('grabaciones de las llamadas de Pluma', () => {
  it('solo reconoce metadatos completos', () => {
    expect(plumaRecordingOf(message.metadata)).toEqual(recording)
    expect(plumaRecordingOf(undefined)).toBeUndefined()
    expect(plumaRecordingOf({})).toBeUndefined()
    expect(plumaRecordingOf({ plumaRecording: { threadId: 'chat', file: 'a.wav', kind: 'otro' } })).toBeUndefined()
    expect(plumaRecordingOf({ plumaRecording: { threadId: 'chat', kind: 'song' } })).toBeUndefined()
  })

  it('reproduce desde la ruta que confirma el lado nativo', async () => {
    hub.invoke.mockResolvedValue('C:/datos/audio.wav')
    await expect(plumaRecordingUrl(recording)).resolves.toBe('asset://C:/datos/audio.wav')
    expect(hub.invoke).toHaveBeenCalledWith('pluma_recording_path', { threadId: 'chat', file: 'audio.wav' })
  })

  it('pide descargar sin elegir la carpeta desde la página', async () => {
    hub.invoke.mockResolvedValue(true)
    await expect(downloadPlumaRecording(recording, 'Cancion')).resolves.toBe(true)
    expect(hub.invoke).toHaveBeenCalledWith('pluma_recording_download', { threadId: 'chat', file: 'audio.wav', suggestedName: 'Cancion' })
  })

  it('al eliminar borra el audio y conserva la letra', async () => {
    const chat = { messages: [{ id: 'm1', metadata: { plumaRecording: recording } }, { id: 'm2' }] }
    useChatSessions.setState({ sessions: { chat: { chat } } as never })
    await deletePlumaRecording(recording, 'm1')
    expect(hub.invoke).toHaveBeenCalledWith('pluma_recording_delete', { threadId: 'chat', file: 'audio.wav' })
    expect(useMessages.getState().getMessages('chat')[0].metadata).toEqual({ parentId: 'p' })
    expect(hub.modifyMessage).toHaveBeenCalledTimes(1)
    expect(chat.messages[0].metadata).toEqual({})
    expect(chat.messages[1]).toEqual({ id: 'm2' })
  })

  it('si el disco falla, el mensaje sigue teniendo su audio', async () => {
    hub.invoke.mockRejectedValue(new Error('en uso'))
    await expect(deletePlumaRecording(recording, 'm1')).rejects.toThrow('en uso')
    expect(useMessages.getState().getMessages('chat')[0].metadata).toEqual(message.metadata)
  })

  it('borrar el mensaje también borra su audio', () => {
    useMessages.getState().deleteMessage('chat', 'm1')
    expect(hub.invoke).toHaveBeenCalledWith('pluma_recording_delete', { threadId: 'chat', file: 'audio.wav' })
    expect(hub.deleteMessage).toHaveBeenCalledWith('chat', 'm1')
  })
})
