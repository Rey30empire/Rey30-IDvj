import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { createPlumaTurnDetector, encodePlumaDictation, isVoiceLike, plumaDictationWav } from './pluma-audio'
import { answerWithGemma, isPlumaAudioMisunderstanding, PlumaAudioNotUnderstoodError, plumaMicrophoneMessage, plumaSongStyle, type GemmaMessage, type PlumaSongRequest, type PlumaVoiceAnswer } from './pluma-gemma'
import { startPlumaFast } from './pluma-fast'
import { plumaActions, type PlumaActions } from './pluma-actions'
import { loadPlumaMemory } from './pluma-memory'
import { normalizePlumaSpeech } from './pluma-text'
import { describeStartError as describePlumaAudioError, supportsPlumaCall, type PlumaCallCallbacks, type PlumaCallPhase } from './pluma-realtime'
import type { CharacterProfile } from './types'

export const plumaCloneVoice = 'pluma:gemma-qwen'

export type PlumaReference = { ready: boolean; format?: 'wav' | 'mp3' | null; bytes?: number | null }
type TurnTiming = { committedAt: number; voicedAt: number; heardAudio: boolean }
type CloneTurn = {
  id: number
  abort: AbortController
  timing: TurnTiming
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
const repeatRequest = 'No te entendí bien. ¿Puedes repetirlo?'
const songFailed = 'No pude generar el audio cantado. Seguimos en la llamada.'
export const plumaReferenceStatus = () => invoke<PlumaReference>('pluma_clone_reference_status')
export const choosePlumaReference = () => invoke<PlumaReference>('pluma_clone_reference_choose')
export const clearPlumaReference = () => invoke<PlumaReference>('pluma_clone_reference_clear')

export function usesPlumaClone(profile: CharacterProfile | undefined) {
  return supportsPlumaCall(profile?.id) && profile?.voice.plumaClone === true
}

function firstSpokenSentence(text: string) {
  let start = 0
  for (const punctuation of text.matchAll(/[.!?…]+(?=\s|$)/gu)) {
    const end = punctuation.index + punctuation[0].length
    const speech = normalizePlumaSpeech(text.slice(start, end))
    if (!speech || emptyLead.test(speech)) { start = end; continue }
    if (isPlumaAudioMisunderstanding(speech)) return undefined
    if (speech.length >= 8 && !abbreviation.test(speech)) return { end, speech }
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
  const { isCurrent, onPhase, onAmplitude, onError, onFirstAudio, onSongCapability } = callbacks
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
  let lastVoicedAt = 0
  let activeTurn: CloneTurn | undefined
  let nextTurnId = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
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

  function abortTurn(turn: CloneTurn) {
    activeTurn = undefined
    turn.abort.abort()
    if (turn.transcriptionId) void invoke('character_audio_cancel', { jobId: turn.transcriptionId }).catch(() => undefined)
  }

  const stopNative = (id: string) => { void invoke('pluma_clone_stop', { sessionId: id }).catch(() => undefined) }
  function stop() {
    if (abort.signal.aborted) return
    abort.abort()
    clearTimeout(timeout)
    if (activeTurn) abortTurn(activeTurn)
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
      return typeof result.text === 'string' ? result.text.trim() : ''
    } finally {
      turn.transcriptionId = undefined
    }
  }

  async function answerTurn(id: string, pcmBase64: string, turn: CloneTurn, onTextDelta: (delta: string) => void, hasFirstSentence: () => boolean): Promise<PlumaVoiceAnswer | undefined> {
    const audioWav = plumaDictationWav(pcmBase64)
    const firstTurn = fast
    fast = undefined
    if (firstTurn) {
      const text = await firstTurn.finish(turn.abort.signal)
      if (!turnUsable(turn)) return
      if (text) {
        const history: GemmaMessage[] = [...previousMessages, plumaMicrophoneMessage(audioWav), { role: 'assistant', content: text }]
        return { text, messages: history.slice(-4) }
      }
    }
    const options = {
      sessionId: id, turnId: turn.id, previousMessages, canSing, signal: turn.abort.signal, onTextDelta,
      memory, onMemory: (notes: string[]) => { memory = notes }, actions,
    }
    let directError: unknown
    try {
      const direct = await answerWithGemma({ ...options, audioWav })
      if (!turnUsable(turn)) return
      if (direct.song?.accompanimentQuote) {
        const transcript = await transcribeTurn(pcmBase64, turn).catch(() => '')
        if (!turnUsable(turn)) return
        direct.song.style = plumaSongStyle(direct.song.accompanimentQuote, transcript)
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
    if (!turnUsable(turn)) return
    await firstSpeech
    if (!turnUsable(turn)) return
    if (result?.song && canSing) {
      setPhase('composing')
      let outcome = `Generé una canción con esta letra:\n${result.song.lyrics}`
      try {
        await playNativeAudio({ lyrics: result.song.lyrics, style: result.song.style }, turn, id)
      } catch {
        if (!turnUsable(turn)) return
        discardPlayback(context?.currentTime)
        outcome = songFailed
        await speak(outcome, turn, id)
      }
      if (!turnUsable(turn)) return
      const history: GemmaMessage[] = [...result.messages, { role: 'assistant', content: outcome }]
      turn.completedHistory = history.slice(-4)
      resumeListening(turn)
      return
    }
    if (spokenPrefix && !result?.text.startsWith(spokenPrefix)) throw new Error('Gemma no pudo terminar la respuesta hablada de forma coherente.')
    const spoken = result ? normalizePlumaSpeech(result.text.slice(spokenPrefix.length)) : repeatRequest
    if (spoken) await speak(spoken, turn, id)
    if (!turnUsable(turn)) return
    if (!turn.timing.heardAudio) throw new Error('Gemma no devolvió una respuesta que se pueda leer en voz alta.')
    turn.completedHistory = result?.messages ?? previousMessages
    resumeListening(turn)
  }

  function finishTurn() {
    if (!usable() || phase !== 'listening' || !detector?.started || !context || !sessionId) return
    const turn: CloneTurn = {
      id: ++nextTurnId,
      abort: new AbortController(),
      timing: { committedAt: performance.now(), voicedAt: lastVoicedAt, heardAudio: false },
    }
    activeTurn = turn
    setPhase('thinking')
    onAmplitude(0)
    detector.reset()
    clearBarge()
    const id = sessionId
    const pcmBase64 = encodePlumaDictation(chunks, context.sampleRate)
    chunks = []
    timeout = setTimeout(() => {
      if (turnUsable(turn)) fail('Gemma o Qwen tardó demasiado en responder. Vuelve a iniciar la llamada.')
    // Covers composing and playing a full song (about 50 s + 90 s) with room to spare.
    }, 300000)
    void runTurn(id, pcmBase64, turn).catch(cause => {
      if (turnUsable(turn)) fail(describePlumaAudioError(cause))
    })
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
    if (echo) { clearBarge(); return }
    const ms = frame.samples.length * 1000 / rate
    const power = frame.samples.reduce((sum, sample) => sum + sample * sample, 0) / frame.samples.length
    if (power >= bargeRms * bargeRms && isVoiceLike(frame.samples, rate)) {
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
    if (bargeVoiced < bargeVoiceMs) return
    const onset = bargeFrames
    clearBarge()
    clearTimeout(timeout)
    abortTurn(turn)
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

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No se puede acceder al micrófono en esta ventana de Rey30.')
    context = new AudioContext()
    gain = context.createGain()
    gain.gain.value = volume
    gain.connect(context.destination)
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
      }
    }
    void loadPlumaMemory().then(notes => { if (usable()) memory = notes })
    void plumaActions().then(tools => { if (usable()) actions = tools }).catch(() => undefined)
    fast = startPlumaFast()
    const id = await invoke<string>('pluma_clone_start', { events: lifecycle })
    if (!usable()) { stopNative(id); return }
    sessionId = id
    await startMicrophone()
  }

  timeout = setTimeout(() => fail('Gemma y Qwen no terminaron de iniciar. Revisa el estado de los modelos y vuelve a intentar.'), 240000)
  void open().catch(cause => fail(describePlumaAudioError(cause)))
  return { stop, finishTurn, setMuted: (muted: boolean) => { if (gain) gain.gain.value = muted ? 0 : volume } }
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
