import { ulid } from 'ulidx'
import { ChatCompletionRole, ContentType, MessageStatus, type ThreadMessage } from '@rey30-idvj/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { literaryAssistantId } from '@/lib/literaryLibrary'
import { computeActivePath, hasBranching } from '@/lib/message-branching'
import { convertThreadMessageToUIMessage } from '@/lib/messages'
import { useChatSessions } from '@/stores/chat-session-store'
import { preferredCharacterModel, toCharacterAssistant } from './assistant-integration'
import { encodePlumaWav, plumaDictationWav } from './pluma-audio'
import { plumaChatHistory, type GemmaMessage } from './pluma-gemma'
import { savePlumaRecording, type PlumaRecording, type PlumaRecordingKind } from './pluma-recording'
import type { CharacterProfile } from './types'

export type PlumaAudioClip = { samples: Float32Array[]; sampleRate: number }
export type PlumaCallTurn = {
  /** What the person said: mono 16 kHz PCM. */
  pcmBase64: string
  /** What the person said, written down; the call recognizes it in the background. */
  transcript?: string | Promise<string>
  understood: boolean
  said: string
  voice?: PlumaAudioClip
  song?: { lyrics: string; audio: PlumaAudioClip }
  /** Typed in the chat during the call: the message is already there and has no recording. */
  typed?: boolean
}
type PlumaCallHistoryOptions = {
  profile: CharacterProfile
  threadId?: string | null
  onThread: (threadId: string) => void
  onError: () => void
}

const unrecognizedVoice = '(Mensaje de voz)'
const titleDate = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
let lastCreatedAt = 0

function transcribeInBackground(pcmBase64: string) {
  return getServiceHub().core()
    .invoke<{ text?: unknown }>('character_audio_transcribe', { jobId: crypto.randomUUID(), pcmBase64, background: true })
    .then(result => typeof result.text === 'string' ? result.text.trim() : '')
}

/** Created beside the current chat, never opened: switching chats would end the call. */
async function createCallThread(profile: CharacterProfile) {
  const assistant = toCharacterAssistant(profile)
  const { providers, selectedModel, selectedProvider } = useModelProvider.getState()
  const binding = profile.modelBinding ?? preferredCharacterModel(providers, selectedModel)
  const created = await getServiceHub().threads().createThread({
    id: ulid(),
    title: `Llamada con ${profile.name} · ${titleDate.format(new Date())}`,
    model: binding ? { id: binding.modelId, provider: binding.providerId } : { id: selectedModel?.id ?? '', provider: selectedProvider },
    updated: Date.now() / 1000,
    assistants: [assistant],
    ...(assistant.id === literaryAssistantId && { metadata: { literaryLibrary: true } }),
  } as Thread)
  const { threads, setThreads } = useThreads.getState()
  setThreads([created, ...Object.values(threads)])
  return created.id
}

function branchLink(threadId: string) {
  const messages = useMessages.getState().getMessages(threadId)
  if (!hasBranching(messages)) return undefined
  const activeRootId = useThreads.getState().threads[threadId]?.metadata?.activeRootId as string | undefined
  return computeActivePath(messages, activeRootId).at(-1)?.id ?? null
}

function appendMessage(threadId: string, role: ChatCompletionRole, text: string, recording?: PlumaRecording) {
  const createdAt = lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1)
  const parentId = branchLink(threadId)
  const message: ThreadMessage = {
    id: ulid(),
    object: 'thread.message',
    thread_id: threadId,
    type: 'text',
    role,
    status: MessageStatus.Ready,
    content: [{ type: ContentType.Text, text: { value: text, annotations: [] } }],
    created_at: createdAt,
    completed_at: createdAt,
    metadata: { ...(recording && { plumaRecording: recording }), ...(parentId !== undefined && { parentId }) },
  }
  useMessages.getState().addMessage(message)
  // An open chat keeps its own list. While it streams a reply it stays out of
  // the way: the message is already stored and appears when the chat reloads.
  const chat = useChatSessions.getState().sessions[threadId]?.chat
  if (chat && chat.status !== 'streaming' && chat.status !== 'submitted') {
    chat.messages = [...chat.messages, convertThreadMessageToUIMessage(message)]
  }
}

const messageText = (message: ThreadMessage) => (message.content ?? [])
  .filter(part => part.type === ContentType.Text)
  .map(part => part.text?.value ?? '')
  .join('\n')

/**
 * The chat a call belongs to, as history Pluma continues: what was said in it
 * by voice or in writing, so a new call in the same chat remembers it.
 */
export async function plumaChatMemory(threadId?: string | null): Promise<GemmaMessage[]> {
  if (!threadId) return []
  let messages = useMessages.getState().getMessages(threadId)
  if (!messages.length) messages = await getServiceHub().messages().fetchMessages(threadId).catch(() => [])
  const activeRootId = useThreads.getState().threads[threadId]?.metadata?.activeRootId as string | undefined
  const path = hasBranching(messages) ? computeActivePath(messages, activeRootId) : messages
  return plumaChatHistory(path.map(message => ({ role: message.role, text: messageText(message) })))
}

/** Turns a call's finished turns into chat messages, one turn at a time and in order. */
export function createPlumaCallHistory({ profile, threadId, onThread, onError }: PlumaCallHistoryOptions) {
  let thread = threadId ?? undefined
  let pending = Promise.resolve()

  async function callThread() {
    if (!thread || !useThreads.getState().threads[thread]) {
      thread = await createCallThread(profile)
      onThread(thread)
    }
    return thread
  }

  // The words matter more than the audio: if it cannot be kept, the text still is.
  function keepAudio(id: string, wavBase64: string, kind: PlumaRecordingKind) {
    return savePlumaRecording(id, wavBase64, kind).catch(() => { onError(); return undefined })
  }
  const clipWav = ({ samples, sampleRate }: PlumaAudioClip) => encodePlumaWav(samples, sampleRate)

  async function store(turn: PlumaCallTurn) {
    const transcript = await Promise.resolve(turn.transcript ?? transcribeInBackground(turn.pcmBase64)).catch(() => '')
    // Room noise she asked to repeat, or a turn nothing came of.
    if (!transcript && (!turn.understood || (!turn.said && !turn.song))) return
    const id = await callThread()
    if (!turn.typed) appendMessage(id, ChatCompletionRole.User, transcript || unrecognizedVoice, await keepAudio(id, plumaDictationWav(turn.pcmBase64), 'user'))
    if (turn.said) appendMessage(id, ChatCompletionRole.Assistant, turn.said, turn.voice && await keepAudio(id, clipWav(turn.voice), 'voice'))
    if (turn.song) {
      const lyrics = turn.song.lyrics.split('\n').join('  \n')
      appendMessage(id, ChatCompletionRole.Assistant, `**Canción**\n\n${lyrics}`, await keepAudio(id, clipWav(turn.song.audio), 'song'))
    }
    useThreads.getState().updateThreadTimestamp(id)
  }

  return {
    record(turn: PlumaCallTurn) {
      pending = pending.then(() => store(turn)).catch(onError)
      return pending
    },
    /** A typed message goes into the chat at once; her answer follows with `record`. */
    typed(text: string) {
      pending = pending.then(async () => {
        const id = await callThread()
        appendMessage(id, ChatCompletionRole.User, text)
        useThreads.getState().updateThreadTimestamp(id)
      }).catch(onError)
      return pending
    },
  }
}
