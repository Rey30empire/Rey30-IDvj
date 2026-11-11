import { getServiceHub } from '@/hooks/useServiceHub'
import { useMessages } from '@/hooks/useMessages'
import { useChatSessions } from '@/stores/chat-session-store'

export type PlumaRecordingKind = 'user' | 'voice' | 'song'
export type PlumaRecording = { threadId: string; file: string; kind: PlumaRecordingKind }

const invoke = <T>(command: string, args: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)

/** The audio attached to a chat message. It lives in metadata so the model is never sent the audio. */
export function plumaRecordingOf(metadata: unknown): PlumaRecording | undefined {
  const value = (metadata as { plumaRecording?: Partial<PlumaRecording> } | undefined)?.plumaRecording
  if (typeof value?.threadId !== 'string' || typeof value.file !== 'string') return undefined
  if (value.kind !== 'user' && value.kind !== 'voice' && value.kind !== 'song') return undefined
  return { threadId: value.threadId, file: value.file, kind: value.kind }
}

export async function savePlumaRecording(threadId: string, wavBase64: string, kind: PlumaRecordingKind): Promise<PlumaRecording> {
  return { threadId, kind, file: await invoke<string>('pluma_recording_save', { threadId, wavBase64 }) }
}

export async function plumaRecordingUrl({ threadId, file }: PlumaRecording) {
  return getServiceHub().core().convertFileSrc(await invoke<string>('pluma_recording_path', { threadId, file }))
}

/** Resolves false when the person closes the save dialog. */
export function downloadPlumaRecording({ threadId, file }: PlumaRecording, suggestedName: string) {
  return invoke<boolean>('pluma_recording_download', { threadId, file, suggestedName })
}

function withoutRecording<T extends { metadata?: unknown }>(message: T): T {
  const metadata = { ...(message.metadata as Record<string, unknown> | undefined) }
  delete metadata.plumaRecording
  return { ...message, metadata }
}

/** Removes the audio only: the words stay in the conversation. */
export async function deletePlumaRecording(recording: PlumaRecording, messageId: string) {
  const { threadId, file } = recording
  await invoke<void>('pluma_recording_delete', { threadId, file })
  const stored = useMessages.getState().getMessages(threadId).find(message => message.id === messageId)
  if (stored) useMessages.getState().updateMessage(withoutRecording(stored))
  const chat = useChatSessions.getState().sessions[threadId]?.chat
  if (chat) chat.messages = chat.messages.map(message => message.id === messageId ? withoutRecording(message) : message)
}
