import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { createPlumaTurnDetector, encodePlumaDictation, isVoiceLike, plumaDictationWav } from './pluma-audio'
import { answerWithGemma, warmPlumaGemma, isPlumaAudioMisunderstanding, PlumaAudioNotUnderstoodError, PLUMA_HISTORY_MESSAGES, plumaMicrophoneMessage, plumaMusicTasteStyle, plumaSongStyle, withSpokenText, type GemmaMessage, type PlumaSongRequest, type PlumaVoiceAnswer } from './pluma-gemma'
import { startPlumaFast } from './pluma-fast'
import { plumaActions, type PlumaActions } from './pluma-actions'
import { loadPlumaMemory } from './pluma-memory'
import { normalizePlumaSpeech } from './pluma-text'
import { describeStartError as describePlumaAudioError, supportsPlumaCall, type PlumaCallCallbacks, type PlumaCallPhase } from './pluma-realtime'
import type { PlumaAudioClip } from './pluma-call-history'
import { readingPercent } from './pluma-reading'
import { loadLoreSongs, type LoreSong } from './lore'
import type { CharacterProfile } from './types'

export const plumaCloneVoice = 'pluma:gemma-qwen'

/** `name` is the Lore voice the sample came from, when it came from Lore. */
export type PlumaReference = { ready: boolean; format?: 'wav' | 'mp3' | null; bytes?: number | null; name?: string | null }
type TurnTiming = { committedAt: number; voicedAt: number; heardAudio: boolean }
type PlayedAudio = { samples: Float32Array; sampleRate: number; startAt: number }
type TurnRecord = {
  pcmBase64: string
  /** The same words as the WAV Gemma heard, so the history can swap it for text. */
  audioWav?: string
  transcript?: string
  understood: boolean
  text?: string
  spoken: { text: string; startAt: number }[]
  voice: PlayedAudio[]
  song: PlayedAudio[]
  lyrics?: string
  saved: boolean
  /** Typed in the chat during the call instead of said: `transcript` holds the words. */
  typed?: boolean
}
/** A book being read aloud: which passage each stretch of audio belongs to. */
type TurnReading = {
  title: string
  total: number
  from: number
  pending: number
  marks: { index: number; startAt: number }[]
  done: boolean
  saved: boolean
}
type CloneTurn = {
  id: number
  abort: AbortController
  timing: TurnTiming
  record: TurnRecord
  readingRequested?: boolean
  reading?: TurnReading
  transcriptionId?: string
  completedHistory?: GemmaMessage[]
}
type EchoFrame = { start: number; samples: Float32Array }
type MicFrame = { samples: Float32Array; capturedAt: number }

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)
const emptyLead = /^(?:claro|por supuesto|entendido|sin problema)[.!…]*$/iu
const abbreviation = /\b(?:sr|sra|dr|dra|etc|av|aprox|núm|vol)\.$/iu
const echoRate = 4000
const echoLag = Math.round(echoRate * 0.3)
const echoLead = Math.round(echoRate * 0.01)
// Interrupting Pluma takes a clear voice: about a quarter second of periodic
// sound above speaking level. Breath, a cough or room noise is not periodic and
// never cuts her off; short gaps between syllables are tolerated.
const bargeVoiceMs = 240
const bargeQuietMs = 120
const bargeRms = 0.025
// While a song plays: twice as loud and close to a full second of voice.
const singingBargeRmsFactor = 2
const singingBargeVoiceMs = 900
const repeatRequest = 'No te entendí bien. ¿Puedes repetirlo?'
const songFailed = 'No pude generar el audio cantado. Seguimos en la llamada.'
/** `singing` is the optional sample she sings with; without it she sings with the speaking one. */
export const plumaReferenceStatus = (singing = false) => invoke<PlumaReference>('pluma_clone_reference_status', { singing })
export const choosePlumaReference = (singing = false) => invoke<PlumaReference>('pluma_clone_reference_choose', { singing })
export const clearPlumaReference = (singing = false) => invoke<PlumaReference>('pluma_clone_reference_clear', { singing })

export function usesPlumaClone(profile: CharacterProfile | undefined) {
  return supportsPlumaCall(profile?.id) && profile?.voice.plumaClone === true
}

/** Seconds of a book queued ahead of what is playing. */
const readAheadSeconds = 20

/** A clause this long can be voiced on its own, so the voice starts while Gemma keeps writing. */
const minOpeningClause = 18

function firstSpokenSentence(text: string) {
  let start = 0
  for (const punctuation of text.matchAll(/[.!?…,;:]+(?=\s)|[.!?…]+$/gu)) {
    const end = punctuation.index + punctuation[0].length
    const speech = normalizePlumaSpeech(text.slice(start, end))
    if (!speech || emptyLead.test(speech)) { start = end; continue }
    if (isPlumaAudioMisunderstanding(speech)) return undefined
    const wholeSentence = /[.!?…]$/u.test(punctuation[0])
    if (speech.length >= (wholeSentence ? 8 : minOpeningClause) && !abbreviation.test(speech)) return { end, speech }
  }
}

const minStreamedSpeech = 40

// The next stretch of complete sentences after `from`, once it is long enough
// to sound natural on its own. Requires whitespace after the punctuation so a
// number or abbreviation still arriving ("3." then "5") is never split.
function nextSpokenStretch(text: string, from: number) {
  for (const punctuation of text.slice(from).matchAll(/[.!?…]+(?=\s)/gu)) {
    const end = from + punctuation.index + punctuation[0].length
    const raw = text.slice(from, end).trim()
    if (abbreviation.test(raw)) continue
    const speech = normalizePlumaSpeech(raw)
    if (speech.length >= minStreamedSpeech) return { end, speech }
  }
}

/** With `stoppedAt`, only what reached the speakers before she was cut off. */
function playedClip(parts: PlayedAudio[], stoppedAt?: number): PlumaAudioClip | undefined {
  const heard = stoppedAt === undefined ? parts : parts.filter(part => part.startAt < stoppedAt)
    .map(part => ({ ...part, samples: part.samples.subarray(0, Math.round((stoppedAt - part.startAt) * part.sampleRate)) }))
  const sampleRate = heard[0]?.sampleRate
  const samples = heard.filter(part => part.sampleRate === sampleRate && part.samples.length).map(part => part.samples)
  return sampleRate && samples.length ? { samples, sampleRate } : undefined
}

function reducedPcm(samples: Float32Array, rate: number) {
  const ratio = rate / echoRate
  return Float32Array.from({ length: Math.floor(samples.length / ratio) }, (_, index) => {
    const from = Math.floor(index * ratio)
    const to = Math.floor((index + 1) * ratio)
    let sum = 0
    for (let offset = from; offset < to; offset++) sum += samples[offset]
    return sum / (to - from)
  })
}

// Compare the mic against recent scheduled output on the same AudioContext clock.
// A bounded lag accounts for render, speaker and capture delay after system AEC.
function isPlaybackEcho(samples: Float32Array, rate: number, audioTime: number, frames: EchoFrame[]) {
  if (!frames.length) return false
  const mic = reducedPcm(samples, rate)
  const micStart = Math.round(audioTime * echoRate) - mic.length
  const from = micStart - echoLag
  const reference = new Float32Array(mic.length + echoLag + echoLead)
  let hasReference = false
  for (const frame of frames) {
    const start = Math.max(frame.start, from)
    const end = Math.min(frame.start + frame.samples.length, from + reference.length)
    if (start >= end) continue
    reference.set(frame.samples.subarray(start - frame.start, end - frame.start), start - from)
    hasReference = true
  }
  if (!hasReference) return false
  const power = mic.reduce((sum, sample) => sum + sample * sample, 0)
  if (power < 1e-5) return false
  for (let offset = 0; offset <= reference.length - mic.length; offset += 2) {
    let dot = 0
    let outputPower = 0
    for (let index = 0; index < mic.length; index++) {
      const sample = reference[index + offset]
      dot += sample * mic[index]
      outputPower += sample * sample
    }
    if (outputPower >= 1e-5 && dot * dot >= 0.43 * outputPower * power) return true
  }
  return false
}

async function captureMicrophone() {
  const audio = { channelCount: 1, noiseSuppression: true, autoGainControl: true }
  try {
    // WebView2 accepts the system-wide mode before this project's DOM types do.
    const echoCancellation = { ideal: 'all' } as unknown as ConstrainBoolean
    return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, echoCancellation } })
  } catch (cause) {
    if (!(cause instanceof TypeError) && !(cause instanceof DOMException && cause.name === 'OverconstrainedError')) throw cause
    return navigator.mediaDevices.getUserMedia({ audio: { ...audio, echoCancellation: true } })
  }
}

export function startPlumaClone(callbacks: PlumaCallCallbacks, volume: number) {
  const abort = new AbortController()
  const { isCurrent, onPhase, onAmplitude, onError, onFirstAudio, onSongCapability, onTurnRecorded, reader, onReading, onTyped } = callbacks
  const usable = () => !abort.signal.aborted && isCurrent()
  const lifecycle = new Channel<{ type: 'clone.ready' | 'clone.error'; message?: string; canSing?: boolean }>()
  let sessionId: string | undefined
  let nativeReady = false
  let canSing = false
  let fast: ReturnType<typeof startPlumaFast> | undefined
  let captureRequested = false
  let context: AudioContext | undefined
  let stream: MediaStream | undefined
  let mic: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let gain: GainNode | undefined
  let phase: PlumaCallPhase = 'connecting'
  let detector: ReturnType<typeof createPlumaTurnDetector> | undefined
  let chunks: Float32Array[] = []
  let previousMessages: GemmaMessage[] = []
  // What Pluma learned in earlier calls; read once per call, updated as she learns.
  let memory: string[] = []
  // Documents and trusted MCP tools; built once per call.
  let actions: PlumaActions | undefined
  // Songs saved in the Lore folder that she can sing by title.
  let songs: LoreSong[] = []
  let lastVoicedAt = 0
  let activeTurn: CloneTurn | undefined
  let nextTurnId = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let levelTimer: ReturnType<typeof setInterval> | undefined
  let warmed = false
  let prepared: Promise<void> = Promise.resolve()
  const playing = new Set<AudioBufferSourceNode>()
  let nextPlayback = 0
  let echoCancellation = false
  let echoFrames: EchoFrame[] = []
  let bargeFrames: MicFrame[] = []
  let bargeVoiced = 0
  let bargeQuiet = 0

  const turnUsable = (turn: CloneTurn) => usable() && activeTurn === turn && !turn.abort.signal.aborted
  function clearBarge() {
    bargeFrames = []
    bargeVoiced = bargeQuiet = 0
  }

  function discardPlayback(audioTime?: number) {
    for (const source of playing) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    playing.clear()
    nextPlayback = 0
    if (audioTime !== undefined) {
      const played = Math.round(audioTime * echoRate)
      echoFrames = echoFrames.filter(frame => frame.start < played)
        .map(frame => ({ ...frame, samples: frame.samples.subarray(0, played - frame.start) }))
    }
  }

  /**
   * Keeps her place in the book: the passage that was playing when she was cut
   * off, so it starts again from its first word; the end once it all played.
   */
  function saveReading(turn: CloneTurn, stoppedAt?: number) {
    const reading = turn.reading
    if (!reading || reading.saved) return ''
    reading.saved = true
    const heard = reading.marks.filter(mark => stoppedAt === undefined || mark.startAt <= stoppedAt).at(-1)
    const position = reading.done && stoppedAt === undefined ? reading.total : heard?.index ?? reading.from
    reader?.save(position, reading.total)
    onReading?.(undefined)
    return `(Leí «${reading.title}» hasta el ${readingPercent(position, reading.total)} %.)`
  }

  // A song is kept whole even if she was cut off: it is the thing asked for.
  function saveTurn(turn: CloneTurn, stoppedAt?: number) {
    const readingNote = saveReading(turn, stoppedAt)
    const { record } = turn
    if (record.saved) return
    record.saved = true
    const heardText = record.spoken.filter(part => stoppedAt === undefined || part.startAt < stoppedAt).map(part => part.text).join(' ')
    const songAudio = playedClip(record.song)
    // Cut off mid-answer, she still remembers what she was asked and how far she got.
    if (stoppedAt !== undefined && !abort.signal.aborted && !turn.reading) {
      if (turn.completedHistory) previousMessages = turn.completedHistory
      else if (heardText && (record.audioWav || record.typed)) {
        const asked: GemmaMessage = record.typed ? { role: 'user', content: record.transcript ?? '' } : plumaMicrophoneMessage(record.audioWav!)
        previousMessages = [...previousMessages, asked, { role: 'assistant' as const, content: `${heardText} (me interrumpieron aquí)` }].slice(-PLUMA_HISTORY_MESSAGES)
      }
    }
    // Written down in the background: the chat shows it, and her history keeps
    // the words so Gemma does not have to hear the recording again every turn.
    const transcript = record.transcript !== undefined ? Promise.resolve(record.transcript) : transcribeInBackground(record.pcmBase64)
    const wav = record.audioWav
    if (wav) void transcript.then(text => { if (!abort.signal.aborted) previousMessages = withSpokenText(previousMessages, wav, text) })
    onTurnRecorded?.({
      pcmBase64: record.pcmBase64,
      transcript,
      understood: record.understood,
      said: [(stoppedAt === undefined && record.text) || heardText, readingNote].filter(Boolean).join(' '),
      voice: playedClip(record.voice, stoppedAt),
      ...(songAudio && record.lyrics !== undefined && { song: { lyrics: record.lyrics, audio: songAudio } }),
      ...(record.typed && { typed: true }),
    })
  }

  function abortTurn(turn: CloneTurn, stoppedAt?: number) {
    saveTurn(turn, stoppedAt)
    activeTurn = undefined
    turn.abort.abort()
    if (turn.transcriptionId) void invoke('character_audio_cancel', { jobId: turn.transcriptionId }).catch(() => undefined)
  }

  const stopNative = (id: string) => { void invoke('pluma_clone_stop', { sessionId: id }).catch(() => undefined) }
  function stop() {
    if (abort.signal.aborted) return
    abort.abort()
    clearTimeout(timeout)
    clearInterval(levelTimer)
    if (activeTurn) abortTurn(activeTurn, context?.currentTime)
    fast?.stop()
    lifecycle.onmessage = () => {}
    if (processor) processor.onaudioprocess = null
    processor?.disconnect()
    mic?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    discardPlayback()
    echoFrames = []
    clearBarge()
    chunks = []
    previousMessages = []
    void context?.close().catch(() => undefined)
    if (sessionId) stopNative(sessionId)
  }

  function fail(message: string) {
    const notify = usable()
    stop()
    if (notify) onError(message)
  }

  function setPhase(next: PlumaCallPhase) {
    if (!usable()) return
    phase = next
    onPhase(next)
  }

  function resumeListening(turn: CloneTurn) {
    if (!turnUsable(turn) || !turn.completedHistory || playing.size) return
    saveTurn(turn)
    clearTimeout(timeout)
    previousMessages = turn.completedHistory
    activeTurn = undefined
    nextPlayback = 0
    clearBarge()
    setPhase('listening')
  }

  async function playNativeAudio(request: { text: string } | PlumaSongRequest, turn: CloneTurn, id: string) {
    const audio = context
    const output = gain
    if (!audio || !output || !turnUsable(turn)) return
    const song = 'lyrics' in request
    const playingPhase = song ? 'singing' : 'speaking'
    const pendingPhase = song ? 'composing' : 'thinking'
    const timing = turn.timing
    const events = new Channel<{ data: string; sampleRate: number } | { done: true }>()
    let complete!: () => void
    const channelDone = new Promise<void>(resolve => { complete = resolve })
    let canceled!: () => void
    const stopped = new Promise<void>(resolve => { canceled = resolve })
    const cancelWait = () => { complete(); canceled() }
    let heardAudio = false
    let packetError: unknown
    events.onmessage = event => {
      if ('done' in event) { complete(); return }
      if (!turnUsable(turn) || packetError) return
      const { data, sampleRate } = event
      try {
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new Error('El motor devolvió una frecuencia de audio incompatible.')
        let samples = decodePlumaCloneAudio(data)
        let offset = 0
        if (!heardAudio) {
          const first = samples.findIndex(sample => Math.abs(sample) >= 0.005)
          if (first < 0) return
          const trim = Math.max(0, first - Math.round(sampleRate * 0.02))
          samples = samples.subarray(trim)
          offset = (first - trim) / sampleRate
        }
        if (!samples.length) return
        const startAt = Math.max(nextPlayback, audio.currentTime + 0.012)
        // A song arrives whole and is queued at once; a spoken answer streams.
        if (startAt - audio.currentTime > (song ? 240 : 120)) throw new Error('La respuesta supera la cola de audio. Pide una respuesta más breve.')
        const buffer = audio.createBuffer(1, samples.length, sampleRate)
        buffer.getChannelData(0).set(samples)
        const source = audio.createBufferSource()
        source.buffer = buffer
        source.connect(output)
        source.onended = () => {
          if (!turnUsable(turn)) return
          playing.delete(source)
          source.disconnect()
          if (!playing.size && !turn.completedHistory && phase === playingPhase) setPhase(pendingPhase)
          resumeListening(turn)
        }
        source.start(startAt)
        playing.add(source)
        // A book can last hours: its audio is never kept for the chat history.
        const reading = turn.reading
        if (reading) {
          if (!heardAudio) reading.marks.push({ index: reading.pending, startAt })
        } else {
          const played = song ? turn.record.song : turn.record.voice
          played.push({ samples, sampleRate, startAt })
          if (!heardAudio && 'text' in request) turn.record.spoken.push({ text: request.text, startAt })
        }
        const forgotten = Math.round((audio.currentTime - 5) * echoRate)
        while (echoFrames[0] && echoFrames[0].start + echoFrames[0].samples.length < forgotten) echoFrames.shift()
        echoFrames.push({ start: Math.round(startAt * echoRate), samples: reducedPcm(samples, sampleRate) })
        nextPlayback = startAt + buffer.duration
        if (!heardAudio) {
          heardAudio = true
          if (!timing.heardAudio) {
            timing.heardAudio = true
            const audibleAt = performance.now() + (startAt - audio.currentTime + offset) * 1000
            onFirstAudio({ fromSpeechMs: Math.round(audibleAt - timing.voicedAt), fromCommitMs: Math.round(audibleAt - timing.committedAt) })
          }
        }
        if (phase !== playingPhase) setPhase(playingPhase)
      } catch (cause) {
        packetError = cause
      }
    }
    turn.abort.signal.addEventListener('abort', cancelWait, { once: true })
    try {
      const command = song ? 'pluma_clone_sing' : 'pluma_clone_speak'
      await Promise.race([Promise.all([invoke(command, { sessionId: id, turnId: turn.id, ...request, events }), channelDone]), stopped])
    } finally {
      turn.abort.signal.removeEventListener('abort', cancelWait)
      events.onmessage = () => {}
    }
    if (!turnUsable(turn)) return
    if (packetError) throw packetError
    if (!heardAudio) throw new Error(song ? 'El motor de canto terminó sin audio audible.' : 'Qwen terminó sin audio audible. Comprueba la muestra de referencia.')
  }
  const speak = (text: string, turn: CloneTurn, id: string) => playNativeAudio({ text }, turn, id)

  async function transcribeTurn(pcmBase64: string, turn: CloneTurn) {
    setPhase('transcribing')
    const jobId = crypto.randomUUID()
    turn.transcriptionId = jobId
    try {
      const result = await invoke<{ text: string }>('character_audio_transcribe', { jobId, pcmBase64 })
      const text = typeof result.text === 'string' ? result.text.trim() : ''
      if (text) turn.record.transcript = text
      return text
    } finally {
      turn.transcriptionId = undefined
    }
  }

  /** Never blocks or cancels the live call: it runs beside it. */
  function transcribeInBackground(pcmBase64: string): Promise<string> {
    if (!pcmBase64) return Promise.resolve('')
    return invoke<{ text?: unknown }>('character_audio_transcribe', { jobId: crypto.randomUUID(), pcmBase64, background: true })
      .then(result => typeof result?.text === 'string' ? result.text.trim() : '', () => '')
  }

  async function answerTurn(id: string, pcmBase64: string, turn: CloneTurn, onTextDelta: (delta: string) => void, hasFirstSentence: () => boolean): Promise<PlumaVoiceAnswer | undefined> {
    const typed = turn.record.typed ? turn.record.transcript ?? '' : undefined
    const audioWav = typed === undefined ? plumaDictationWav(pcmBase64) : ''
    if (audioWav) turn.record.audioWav = audioWav
    // The chat she continues, her notes and tools: the first turn needs them too.
    await prepared
    if (!turnUsable(turn)) return
    const options = {
      sessionId: id, turnId: turn.id, previousMessages, canSing, signal: turn.abort.signal, onTextDelta,
      memory, onMemory: (notes: string[]) => { memory = notes }, actions, book: reader?.current(), songs,
    }
    // Typed words need no listening: Gemma reads them and she answers aloud.
    if (typed !== undefined) {
      try {
        return await answerWithGemma({ ...options, transcript: typed })
      } catch (cause) {
        // An answer that reads like "I didn't hear you" asks to repeat instead of ending the call.
        if (cause instanceof PlumaAudioNotUnderstoodError) return undefined
        throw cause
      }
    }
    const firstTurn = fast
    fast = undefined
    if (firstTurn) {
      const text = await firstTurn.finish(turn.abort.signal)
      if (!turnUsable(turn)) return
      if (text) {
        const history: GemmaMessage[] = [...previousMessages, plumaMicrophoneMessage(audioWav), { role: 'assistant', content: text }]
        return { text, messages: history.slice(-PLUMA_HISTORY_MESSAGES) }
      }
    }
    let directError: unknown
    try {
      const direct = await answerWithGemma({ ...options, audioWav })
      if (!turnUsable(turn)) return
      if (direct.song?.accompanimentQuote) {
        const transcript = await transcribeTurn(pcmBase64, turn).catch(() => '')
        if (!turnUsable(turn)) return
        direct.song.style = plumaSongStyle(direct.song.accompanimentQuote, transcript, plumaMusicTasteStyle(memory))
      }
      if (!isPlumaAudioMisunderstanding(direct.text)) return direct
      directError = new PlumaAudioNotUnderstoodError()
    } catch (cause) {
      if (hasFirstSentence()) throw cause
      directError = cause
    }
    if (!turnUsable(turn)) return
    let transcript = ''
    try {
      transcript = await transcribeTurn(pcmBase64, turn)
    } catch (cause) {
      if (!(directError instanceof PlumaAudioNotUnderstoodError)) throw directError ?? cause
    }
    if (!turnUsable(turn)) return
    if (!transcript) {
      if (directError && !(directError instanceof PlumaAudioNotUnderstoodError)) throw directError
      return undefined
    }
    setPhase('thinking')
    try {
      const answer = await answerWithGemma({ ...options, transcript })
      return isPlumaAudioMisunderstanding(answer.text) ? undefined : answer
    } catch (cause) {
      if (cause instanceof PlumaAudioNotUnderstoodError && !hasFirstSentence()) return undefined
      throw cause
    }
  }

  async function runTurn(id: string, pcmBase64: string, turn: CloneTurn) {
    let partial = ''
    let spokenUpTo = 0
    let spokenPrefix = ''
    // Sentences are synthesized in order while Gemma keeps writing, so the
    // next one is usually ready before the current one finishes playing.
    let firstSpeech: Promise<void> | undefined
    const queueSpeech = (text: string) => {
      const previous = firstSpeech ?? Promise.resolve()
      firstSpeech = previous
        .then(() => (turnUsable(turn) ? speak(text, turn, id) : undefined))
        .catch(cause => {
          if (turnUsable(turn)) fail(describePlumaAudioError(cause))
        })
    }
    const onTextDelta = (delta: string) => {
      if (!turnUsable(turn)) return
      partial += delta
      if (!firstSpeech) {
        const first = firstSpokenSentence(partial)
        if (!first) return
        spokenUpTo = first.end
        spokenPrefix = partial.slice(0, spokenUpTo).trimStart()
        queueSpeech(first.speech)
      }
      for (let next = nextSpokenStretch(partial, spokenUpTo); next; next = nextSpokenStretch(partial, spokenUpTo)) {
        spokenUpTo = next.end
        spokenPrefix = partial.slice(0, spokenUpTo).trimStart()
        queueSpeech(next.speech)
      }
    }
    const result = await answerTurn(id, pcmBase64, turn, onTextDelta, () => firstSpeech !== undefined)
    turn.record.understood = Boolean(result)
    turn.record.text = result?.text ?? repeatRequest
    if (!turnUsable(turn)) return
    await firstSpeech
    if (!turnUsable(turn)) return
    if (result?.song && canSing) {
      setPhase('composing')
      let outcome = `Generé una canción con esta letra:\n${result.song.lyrics}`
      turn.record.lyrics = result.song.lyrics
      try {
        await playNativeAudio({ lyrics: result.song.lyrics, style: result.song.style, seconds: result.song.seconds }, turn, id)
      } catch {
        if (!turnUsable(turn)) return
        discardPlayback(context?.currentTime)
        outcome = songFailed
        turn.record.song = []
        turn.record.text = [result.text, songFailed].filter(Boolean).join(' ')
        await speak(outcome, turn, id)
      }
      if (!turnUsable(turn)) return
      const history: GemmaMessage[] = [...result.messages, { role: 'assistant', content: outcome }]
      turn.completedHistory = history.slice(-PLUMA_HISTORY_MESSAGES)
      resumeListening(turn)
      return
    }
    if (result?.read) {
      const book = reader?.current()
      if (book) {
        await readBook(turn, id, result.read.fromStart)
        if (!turnUsable(turn)) return
        const history: GemmaMessage[] = [...result.messages, { role: 'assistant', content: `Leí en voz alta «${book.title}».` }]
        turn.completedHistory = history.slice(-PLUMA_HISTORY_MESSAGES)
        resumeListening(turn)
        return
      }
      if (!result.text.trim()) result.text = 'No hay ningún libro cargado en el modo lectura.'
    }
    if (spokenPrefix && !result?.text.startsWith(spokenPrefix)) throw new Error('Gemma no pudo terminar la respuesta hablada de forma coherente.')
    const spoken = result ? normalizePlumaSpeech(result.text.slice(spokenPrefix.length)) : repeatRequest
    if (spoken) await speak(spoken, turn, id)
    if (!turnUsable(turn)) return
    if (!turn.timing.heardAudio) throw new Error('Gemma no devolvió una respuesta que se pueda leer en voz alta.')
    turn.completedHistory = result?.messages ?? previousMessages
    resumeListening(turn)
  }

  /**
   * Reads the loaded book aloud, passage after passage, from where it was left.
   * About twenty seconds stay queued: enough for no gaps, without synthesizing
   * whole chapters she may never reach. A long book has no overall time limit;
   * each passage has its own.
   */
  async function readBook(turn: CloneTurn, id: string, fromStart: boolean) {
    if (!reader) return
    turn.readingRequested = true
    const book = await reader.load()
    if (!turnUsable(turn) || !book.chunks.length) return
    const saved = reader.position()
    const from = fromStart || saved >= book.chunks.length ? 0 : saved
    const reading: TurnReading = { title: book.title, total: book.chunks.length, from, pending: from, marks: [], done: false, saved: false }
    turn.reading = reading
    let failures = 0
    for (let index = from; index < book.chunks.length; index++) {
      while (turnUsable(turn) && context && nextPlayback - context.currentTime > readAheadSeconds) await new Promise(resolve => setTimeout(resolve, 250))
      if (!turnUsable(turn)) return
      const text = normalizePlumaSpeech(book.chunks[index])
      if (!text) continue
      reading.pending = index
      onReading?.({ title: book.title, percent: readingPercent(index, book.chunks.length) })
      clearTimeout(timeout)
      timeout = setTimeout(() => { if (turnUsable(turn)) fail('La lectura se detuvo porque la voz de Qwen dejó de responder.') }, 120000)
      try {
        await speak(text, turn, id)
        failures = 0
      } catch (cause) {
        if (!turnUsable(turn)) return
        // One passage the voice cannot say is skipped; several in a row end the reading.
        if (++failures >= 3) throw cause
      }
    }
    clearTimeout(timeout)
    reading.done = true
  }

  /** Reading asked for with the button, without speaking: false while she is busy. */
  function read(fromStart: boolean) {
    if (!usable() || phase !== 'listening' || !sessionId || !reader?.current()) return false
    const now = performance.now()
    const turn: CloneTurn = {
      id: ++nextTurnId,
      abort: new AbortController(),
      timing: { committedAt: now, voicedAt: now, heardAudio: false },
      // Nothing was said, so nothing goes to the chat; only her place in the book is kept.
      record: { pcmBase64: '', understood: true, spoken: [], voice: [], song: [], saved: true },
    }
    activeTurn = turn
    detector?.reset()
    chunks = []
    clearBarge()
    setPhase('thinking')
    const id = sessionId
    void readBook(turn, id, fromStart).then(() => {
      if (!turnUsable(turn)) return
      turn.completedHistory = previousMessages
      resumeListening(turn)
    }).catch(cause => { if (turnUsable(turn)) fail(describePlumaAudioError(cause)) })
    return true
  }

  /** Stops the reading where it is and listens again; her place is kept. */
  function stopReading() {
    const turn = activeTurn
    if (!turn?.readingRequested || !context || !sessionId) return
    const at = context.currentTime
    clearTimeout(timeout)
    abortTurn(turn, at)
    discardPlayback(at)
    void invoke('pluma_clone_cancel_turn', { sessionId, turnId: turn.id }).catch(() => undefined)
    detector?.reset()
    chunks = []
    clearBarge()
    setPhase('listening')
  }

  function finishTurn() {
    if (!usable() || phase !== 'listening' || !detector?.started || !context || !sessionId) return
    const pcmBase64 = encodePlumaDictation(chunks, context.sampleRate)
    chunks = []
    const turn: CloneTurn = {
      id: ++nextTurnId,
      abort: new AbortController(),
      timing: { committedAt: performance.now(), voicedAt: lastVoicedAt, heardAudio: false },
      record: { pcmBase64, understood: true, spoken: [], voice: [], song: [], saved: false },
    }
    activeTurn = turn
    setPhase('thinking')
    onAmplitude(0)
    detector.reset()
    clearBarge()
    const id = sessionId
    timeout = setTimeout(() => {
      if (turnUsable(turn)) fail('Gemma o Qwen tardó demasiado en responder. Vuelve a iniciar la llamada.')
    // Covers composing and playing a full song (about 50 s + 90 s) with room to spare.
    }, 300000)
    void runTurn(id, pcmBase64, turn).catch(cause => {
      if (turnUsable(turn)) fail(describePlumaAudioError(cause))
    })
  }

  /**
   * Words typed in the chat during the call: a turn like a spoken one, which
   * she answers aloud. If she was talking she stops to read it, as when the
   * person speaks over her. False while the call is still getting ready.
   */
  function sendText(text: string) {
    const words = text.trim().slice(0, 4_000)
    if (!words || !usable() || !context || !sessionId || !nativeReady || phase === 'connecting') return false
    const previous = activeTurn
    if (previous) {
      const at = context.currentTime
      clearTimeout(timeout)
      abortTurn(previous, at)
      discardPlayback(at)
      void invoke('pluma_clone_cancel_turn', { sessionId, turnId: previous.id }).catch(() => undefined)
    }
    // What the microphone held so far is not part of this turn.
    fast?.stop()
    fast = undefined
    detector?.reset()
    chunks = []
    clearBarge()
    const now = performance.now()
    const turn: CloneTurn = {
      id: ++nextTurnId,
      abort: new AbortController(),
      timing: { committedAt: now, voicedAt: now, heardAudio: false },
      record: { pcmBase64: '', transcript: words, typed: true, understood: true, spoken: [], voice: [], song: [], saved: false },
    }
    activeTurn = turn
    onTyped?.(words)
    setPhase('thinking')
    onAmplitude(0)
    const id = sessionId
    timeout = setTimeout(() => {
      if (turnUsable(turn)) fail('Gemma o Qwen tardó demasiado en responder. Vuelve a iniciar la llamada.')
    }, 300000)
    void runTurn(id, '', turn).catch(cause => {
      if (turnUsable(turn)) fail(describePlumaAudioError(cause))
    })
    return true
  }

  function listen(frame: MicFrame) {
    if (!detector) return
    const result = detector.push(frame.samples)
    if (result.voiced) lastVoicedAt = frame.capturedAt
    if (context) fast?.append(result.chunks, context.sampleRate, result.voiced)
    chunks.push(...result.chunks)
    onAmplitude(result.level)
    if (result.ended) finishTurn()
  }

  function considerInterruption(frame: MicFrame, rate: number, audioTime: number, echo: boolean) {
    const turn = activeTurn
    if (!turn || !sessionId || !echoCancellation) return
    // Only her own voice can be interrupted. Until it plays, a sound in the room
    // would throw away the answer being prepared and she would seem not to reply.
    if (echo || !playing.size) { clearBarge(); return }
    const ms = frame.samples.length * 1000 / rate
    const power = frame.samples.reduce((sum, sample) => sum + sample * sample, 0) / frame.samples.length
    // A song is long, continuous and voice-like, so speaker bleed the echo
    // check misses would cut it within a second. Singing needs a louder, longer
    // interruption before it stops.
    const singing = phase === 'singing'
    const threshold = singing ? bargeRms * singingBargeRmsFactor : bargeRms
    if (power >= threshold * threshold && isVoiceLike(frame.samples, rate)) {
      bargeVoiced += ms
      bargeQuiet = 0
    } else {
      if (!bargeVoiced) {
        bargeFrames.push(frame)
        while (bargeFrames.length > Math.max(1, Math.floor(bargeQuietMs / ms))) bargeFrames.shift()
        return
      }
      bargeQuiet += ms
      if (bargeQuiet >= bargeQuietMs) { clearBarge(); return }
    }
    bargeFrames.push(frame)
    if (bargeVoiced < (singing ? singingBargeVoiceMs : bargeVoiceMs)) return
    const onset = bargeFrames
    clearBarge()
    clearTimeout(timeout)
    abortTurn(turn, audioTime)
    discardPlayback(audioTime)
    void invoke('pluma_clone_cancel_turn', { sessionId, turnId: turn.id }).catch(() => undefined)
    detector?.reset()
    chunks = []
    setPhase('listening')
    onset.forEach(listen)
  }

  async function startMicrophone() {
    if (!context || !sessionId || !nativeReady || captureRequested || !usable()) return
    captureRequested = true
    const capture = await captureMicrophone()
    if (!usable()) {
      capture.getTracks().forEach(track => track.stop())
      return
    }
    stream = capture
    const echoMode = capture.getAudioTracks()[0]?.getSettings().echoCancellation as boolean | string | undefined
    echoCancellation = echoMode === true || echoMode === 'all'
    capture.getAudioTracks().forEach(track => track.addEventListener('ended', () => fail('Se desconectó el micrófono. Conéctalo y vuelve a iniciar la llamada.'), { once: true }))
    mic = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(2048, 1, 1)
    detector = createPlumaTurnDetector(context.sampleRate)
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (!usable() || !context || !detector || (phase !== 'listening' && (!activeTurn || !echoCancellation))) return
      try {
        const frame = { samples: inputBuffer.getChannelData(0).slice(), capturedAt: performance.now() }
        const { sampleRate, currentTime } = context
        const cutoff = Math.round(currentTime * echoRate) - echoLag - Math.ceil(frame.samples.length * echoRate / sampleRate)
        while (echoFrames[0] && echoFrames[0].start + echoFrames[0].samples.length < cutoff) echoFrames.shift()
        const echo = (gain?.gain.value ?? 0) > 0 && isPlaybackEcho(frame.samples, sampleRate, currentTime, echoFrames)
        if (phase === 'listening') {
          if (!echo) listen(frame)
        } else considerInterruption(frame, sampleRate, currentTime, echo)
      } catch (cause) {
        fail(describePlumaAudioError(cause))
      }
    }
    mic.connect(processor)
    processor.connect(context.destination)
    clearTimeout(timeout)
    setPhase('listening')
  }

  /** Reads her instructions once before the first turn, so that turn does not pay for it. */
  async function warmUp() {
    if (warmed || !sessionId || !nativeReady) return
    warmed = true
    const id = sessionId
    await prepared
    if (usable()) await warmPlumaGemma({ sessionId: id, canSing, memory, actions, book: reader?.current(), songs }).catch(() => undefined)
  }

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No se puede acceder al micrófono en esta ventana de Rey30.')
    context = new AudioContext()
    gain = context.createGain()
    gain.gain.value = volume
    gain.connect(context.destination)
    const meter = context.createAnalyser()
    meter.fftSize = 1024
    gain.connect(meter)
    const wave = new Float32Array(meter.fftSize)
    // What moves the avatar's lips: the level of the voice actually playing.
    levelTimer = setInterval(() => {
      if (phase !== 'speaking' && phase !== 'singing') return
      meter.getFloatTimeDomainData(wave)
      onAmplitude(Math.min(1, Math.sqrt(wave.reduce((sum, sample) => sum + sample * sample, 0) / wave.length) * 6))
    }, 33)
    await context.resume()
    if (!usable()) return
    if (!(await plumaReferenceStatus()).ready) throw new Error('Elige una muestra WAV o MP3 para usar la voz clonada.')
    if (!usable()) return
    lifecycle.onmessage = event => {
      if (!usable()) return
      if (event.type === 'clone.error') {
        fail(event.message ?? 'No se pudo iniciar Gemma y Qwen en el equipo.')
      } else if (event.type === 'clone.ready') {
        canSing = event.canSing === true
        onSongCapability?.(canSing)
        nativeReady = true
        void startMicrophone().catch(cause => fail(describePlumaAudioError(cause)))
        void warmUp()
      }
    }
    prepared = Promise.all([
      loadPlumaMemory().then(notes => { if (usable()) memory = notes }),
      plumaActions().then(tools => { if (usable()) actions = tools }).catch(() => undefined),
      loadLoreSongs().then(list => { if (usable()) songs = list }),
      // A call in a chat continues that conversation instead of starting blank.
      callbacks.loadHistory?.().then(history => { if (usable() && !previousMessages.length) previousMessages = history.slice(-PLUMA_HISTORY_MESSAGES) }).catch(() => undefined),
    ]).then(() => undefined)
    fast = startPlumaFast()
    const id = await invoke<string>('pluma_clone_start', { events: lifecycle })
    if (!usable()) { stopNative(id); return }
    sessionId = id
    await startMicrophone()
    void warmUp()
  }

  timeout = setTimeout(() => fail('Gemma y Qwen no terminaron de iniciar. Revisa el estado de los modelos y vuelve a intentar.'), 240000)
  void open().catch(cause => fail(describePlumaAudioError(cause)))
  return { stop, finishTurn, read, stopReading, sendText, setMuted: (muted: boolean) => { if (gain) gain.gain.value = muted ? 0 : volume } }
}

export function decodePlumaCloneAudio(data: string) {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
  if (bytes.length % 4 !== 0) throw new Error('El motor devolvió un fragmento de audio incompleto.')
  const view = new DataView(bytes.buffer)
  return Float32Array.from({ length: bytes.length / 4 }, (_, index) => {
    const value = view.getFloat32(index * 4, true)
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
  })
}
