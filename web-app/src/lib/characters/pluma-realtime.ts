import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import { createPlumaPcmEncoder, createPlumaTurnDetector, decodePlumaPcm } from './pluma-audio'
import { answerWithPluma, plumaReasoningTool, plumaRealtimeInstructions } from './pluma-reasoning'
import { normalizePlumaSpeech } from './pluma-text'
import type { CharacterProfile } from './types'

export const plumaDirectVoice = 'lfm3:direct'
export type PlumaCallPhase = 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'consulting' | 'speaking' | 'composing' | 'singing'
export type PlumaCallTiming = { fromSpeechMs: number; fromCommitMs: number }

type AudioFormat = { format?: { type?: string; rate?: number } }
type RealtimeEvent = {
  type: string
  session?: { audio?: { input?: AudioFormat; output?: AudioFormat } }
  response?: { status?: string }
  delta?: string
  call_id?: string
  name?: string
  arguments?: string
  error?: { message?: string }
  message?: string
}
export type PlumaCallCallbacks = {
  isCurrent: () => boolean
  onPhase: (phase: PlumaCallPhase) => void
  onAmplitude: (level: number) => void
  onError: (message: string) => void
  onFirstAudio: (timing: PlumaCallTiming) => void
  onSongCapability?: (available: boolean) => void
}

export function supportsPlumaCall(characterId: string | undefined) {
  return characterId === 'literatura' && isPlatformTauri() && /Windows/i.test(navigator.userAgent)
}

export function usesPlumaCall(profile: CharacterProfile | undefined) {
  return supportsPlumaCall(profile?.id) && profile?.voice.plumaDirect !== false
}

function pcmRate(format: AudioFormat | undefined) {
  const rate = format?.format?.rate
  if (format?.format?.type !== 'audio/pcm' || typeof rate !== 'number' || !Number.isInteger(rate) || rate < 8000 || rate > 48000) {
    throw new Error('El motor de Pluma no devolvió un formato de audio compatible.')
  }
  return rate
}

export function describeStartError(cause: unknown) {
  if (cause instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(cause.name)) {
    return 'Permite el micrófono en Configuración de Windows y vuelve a iniciar la llamada.'
  }
  if (cause instanceof DOMException && ['NotFoundError', 'NotReadableError'].includes(cause.name)) {
    return 'Conecta un micrófono disponible y vuelve a iniciar la llamada.'
  }
  return cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo iniciar la llamada de Pluma.'
}

export function startPlumaCall(callbacks: PlumaCallCallbacks) {
  const { isCurrent, onPhase, onAmplitude, onError, onFirstAudio } = callbacks
  const abort = new AbortController()
  const channel = new Channel<RealtimeEvent>()
  let id: string | undefined
  let audio: AudioContext | undefined
  let gain: GainNode | undefined
  let stream: MediaStream | undefined
  let mic: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  const playback = new Set<AudioBufferSourceNode>()
  let playAt = 0
  let phase: PlumaCallPhase = 'connecting'
  let responseFinished = false
  let waitingForConfig = true
  let timeout: ReturnType<typeof setTimeout> | undefined
  let sendQueue = Promise.resolve()
  let pendingMessages = 0
  let outputRate = 0
  let inputRate = 0
  let lastVoicedAt = 0
  let committedAt = 0
  let hadAudio = false
  let detector: ReturnType<typeof createPlumaTurnDetector> | undefined
  let toolCalls = new Map<string, RealtimeEvent>()
  const usable = () => !abort.signal.aborted && isCurrent()

  function closeNative(sessionId: string) {
    void getServiceHub().core().invoke('pluma_realtime_stop', { sessionId }).catch(() => undefined)
  }

  function stop() {
    if (abort.signal.aborted) return
    abort.abort()
    clearTimeout(timeout)
    channel.onmessage = () => {}
    if (processor) processor.onaudioprocess = null
    processor?.disconnect()
    mic?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    for (const source of playback) source.stop()
    playback.clear()
    void audio?.close().catch(() => undefined)
    if (id) closeNative(id)
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

  function armTimeout(ms: number, message: string) {
    clearTimeout(timeout)
    timeout = setTimeout(() => fail(message), ms)
  }

  function send(event: Record<string, unknown>) {
    if (!usable()) return
    if (++pendingMessages > 32) {
      fail('El motor de voz no puede seguir el micrófono. Vuelve a iniciar la llamada.')
      return
    }
    sendQueue = sendQueue.then(async () => {
      if (usable() && id) await getServiceHub().core().invoke('pluma_realtime_send', { sessionId: id, event })
    }).catch(cause => fail(describeStartError(cause))).finally(() => { pendingMessages-- })
  }

  function finishTurn() {
    if (!usable() || phase !== 'listening' || !detector?.started) return
    setPhase('thinking')
    onAmplitude(0)
    detector.reset()
    responseFinished = false
    hadAudio = false
    toolCalls = new Map()
    committedAt = performance.now()
    send({ type: 'input_audio_buffer.commit' })
    send({ type: 'response.create', response: { output_modalities: ['text', 'audio'] } })
    armTimeout(45000, 'Pluma tardó demasiado en responder. Vuelve a iniciar la llamada.')
  }

  function listenAfterPlayback() {
    if (responseFinished && !playback.size && usable()) {
      clearTimeout(timeout)
      playAt = 0
      setPhase('listening')
    }
  }

  function play(delta: string) {
    if (!audio || !gain) return
    let samples = decodePlumaPcm(delta)
    if (!samples.length) return
    let audibleOffset = 0
    if (!hadAudio) {
      const onset = samples.findIndex(sample => Math.abs(sample) >= 0.005)
      if (onset < 0) return
      const trim = Math.max(0, onset - Math.round(outputRate * 0.02))
      audibleOffset = (onset - trim) / outputRate
      samples = samples.subarray(trim)
    }
    const startAt = Math.max(playAt, audio.currentTime + 0.012)
    if (startAt - audio.currentTime > 30) throw new Error('La cola de reproducción de Pluma se llenó.')
    const buffer = audio.createBuffer(1, samples.length, outputRate)
    buffer.getChannelData(0).set(samples)
    const source = audio.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    playback.add(source)
    source.onended = () => {
      playback.delete(source)
      source.disconnect()
      listenAfterPlayback()
    }
    playAt = startAt + buffer.duration
    source.start(startAt)
    if (!hadAudio) {
      hadAudio = true
      const scheduledAt = performance.now() + (startAt - audio.currentTime + audibleOffset) * 1000
      onFirstAudio({ fromSpeechMs: Math.round(scheduledAt - lastVoicedAt), fromCommitMs: Math.round(scheduledAt - committedAt) })
    }
    if (phase !== 'speaking') setPhase('speaking')
    armTimeout(45000, 'La reproducción de Pluma se interrumpió. Vuelve a iniciar la llamada.')
  }

  async function consult() {
    setPhase('consulting')
    armTimeout(120000, 'Jan 4B tardó demasiado en consultar la biblioteca. Vuelve a iniciar la llamada.')
    for (const [callId, call] of toolCalls) {
      let output: string
      try {
        const args: unknown = JSON.parse(call.arguments ?? '')
        if (call.name !== plumaReasoningTool.name || !args || typeof args !== 'object' || !('consulta' in args) || typeof args.consulta !== 'string') {
          throw new Error('No se entendió la consulta. Pide al usuario que la repita.')
        }
        if (!id) throw new Error('La llamada de Pluma se cerró.')
        output = normalizePlumaSpeech(await answerWithPluma(args.consulta, id, abort.signal))
      } catch (cause) {
        output = `La consulta no se pudo realizar. ${describeStartError(cause)}`
      }
      if (!usable()) return
      send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } })
    }
    toolCalls.clear()
    if (usable()) {
      setPhase('thinking')
      armTimeout(45000, 'Pluma tardó demasiado en leer la respuesta. Vuelve a iniciar la llamada.')
      send({ type: 'response.create', response: { output_modalities: ['audio'], tool_choice: 'none' } })
    }
  }

  function eventReceived(event: RealtimeEvent) {
    if (!usable()) return
    switch (event.type) {
      case 'session.created': {
        inputRate = pcmRate(event.session?.audio?.input)
        outputRate = pcmRate(event.session?.audio?.output)
        send({ type: 'session.update', session: { instructions: plumaRealtimeInstructions, tools: [plumaReasoningTool], max_output_tokens: 360 } })
        break
      }
      case 'session.updated':
        if (waitingForConfig) {
          waitingForConfig = false
          void startMicrophone().catch(cause => fail(describeStartError(cause)))
        }
        break
      case 'response.output_audio.delta':
        if (typeof event.delta === 'string') play(event.delta)
        break
      case 'response.function_call_arguments.done':
        if (event.call_id && toolCalls.size < 4) toolCalls.set(event.call_id, event)
        break
      case 'response.done':
        if (event.response?.status === 'failed') throw new Error('El motor local interrumpió la respuesta de voz.')
        if (toolCalls.size) void consult().catch(cause => fail(describeStartError(cause)))
        else {
          if (!hadAudio) throw new Error('Pluma terminó la respuesta sin audio. Puedes elegir una voz instalada o volver a iniciar la llamada.')
          responseFinished = true
          listenAfterPlayback()
        }
        break
      case 'error':
      case 'rey30.error':
        fail(event.message ?? event.error?.message ?? 'El motor de voz local se detuvo.')
        break
    }
  }

  async function startMicrophone() {
    if (!audio) return
    const capture = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    if (!usable()) {
      capture.getTracks().forEach(track => track.stop())
      return
    }
    stream = capture
    capture.getAudioTracks().forEach(track => track.addEventListener('ended', () => fail('Se desconectó el micrófono. Conéctalo y vuelve a iniciar la llamada.'), { once: true }))
    mic = audio.createMediaStreamSource(stream)
    processor = audio.createScriptProcessor(2048, 1, 1)
    const encode = createPlumaPcmEncoder(audio.sampleRate, inputRate)
    detector = createPlumaTurnDetector(audio.sampleRate)
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (!usable() || phase !== 'listening' || !detector) return
      const { chunks, ended, level, voiced } = detector.push(inputBuffer.getChannelData(0).slice())
      if (voiced) lastVoicedAt = performance.now()
      onAmplitude(level)
      for (const chunk of chunks) {
        const encoded = encode(chunk)
        if (encoded) send({ type: 'input_audio_buffer.append', audio: encoded })
      }
      if (ended) finishTurn()
    }
    mic.connect(processor)
    processor.connect(audio.destination)
    clearTimeout(timeout)
    setPhase('listening')
  }

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No se puede acceder al micrófono en esta ventana de Rey30.')
    audio = new AudioContext()
    gain = audio.createGain()
    gain.connect(audio.destination)
    await audio.resume()
    if (!usable()) return
    const earlyEvents: RealtimeEvent[] = []
    channel.onmessage = event => {
      if (!id) { earlyEvents.push(event); return }
      try { eventReceived(event) } catch (cause) { fail(describeStartError(cause)) }
    }
    const startedId = await getServiceHub().core().invoke<string>('pluma_realtime_start', { events: channel })
    if (!usable()) { closeNative(startedId); return }
    id = startedId
    for (const event of earlyEvents) eventReceived(event)
  }

  armTimeout(170000, 'La voz local no pudo iniciarse. Revisa el micrófono y vuelve a intentar.')
  void open().catch(cause => fail(describeStartError(cause)))
  return { stop, finishTurn, setMuted: (muted: boolean) => { if (gain) gain.gain.value = muted ? 0 : 1 } }
}
