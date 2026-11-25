import { Channel } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import { applyVoiceStyle, styleChangesAudio, usePlumaVoiceStyle } from './pluma-voice-style'
import type { CharacterProfile, OriginalCharacterId } from './types'

export type LocalVoice = {
  id: string
  name: string
  language: string
  provider: string
  gender: string
}
type AudioStatus =
  'idle' | 'preparing' | 'speaking' | 'listening' | 'transcribing' | 'error'
type Catalog = {
  voices: LocalVoice[]
  dictation: boolean
  dictationLanguage: string
  localOnly: boolean
}
export type AudioOwnership = { owner?: string; isCurrent?: () => boolean }
type AudioState = {
  status: AudioStatus
  amplitude: number
  error: string | null
  voices: LocalVoice[]
  dictation: boolean
  catalogLoaded: boolean
  autoplayCancelled: boolean
  owner: string | null
  loadCatalog: () => Promise<void>
  speak: (
    text: string,
    profile: CharacterProfile,
    options?: AudioOwnership
  ) => Promise<void>
  stop: (owner?: string) => void
  startDictation: (
    onText: (text: string) => void,
    options?: AudioOwnership & { autoFinish?: boolean }
  ) => Promise<void>
  finishDictation: () => Promise<void>
}
const variants: Record<OriginalCharacterId, string> = {
  literatura: 'f3',
  coder: 'm1',
}
export const defaultVoiceId = (profile: CharacterProfile) =>
  `espeak:es-419+${variants[profile.baseId]}`
const invoke = <T>(command: string, args: Record<string, unknown>) =>
  getServiceHub().core().invoke<T>(command, args)
let generation = 0
let nativeJob: string | undefined
let context: AudioContext | undefined
let source: AudioBufferSourceNode | undefined
let frame = 0
let media: MediaStream | undefined
let processor: ScriptProcessorNode | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let samples: Float32Array[] = []
let sampleRate = 48000
let receiveText: ((text: string) => void) | undefined
let finishPlayback: (() => void) | undefined
let catalogPromise: Promise<void> | undefined
let activeOwnership: AudioOwnership | undefined
let capturedSamples = 0
const authorized = (ownership?: AudioOwnership) => {
  try {
    return ownership?.isCurrent?.() !== false
  } catch {
    return false
  }
}

export function speechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' Bloque de código omitido. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' enlace ')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_#`]/g, '')
    .trim()
}
export function speechChunks(text: string): string[] {
  const clean = speechText(text)
  if (clean.length > 24000)
    throw new Error(
      'La respuesta es demasiado larga para leerla completa. Selecciona un fragmento de hasta 24 000 caracteres.'
    )
  const chunks: string[] = []
  let remaining = clean
  while (remaining.length > 1200) {
    const boundary = remaining.lastIndexOf(' ', 1200)
    const end = boundary > 600 ? boundary : 1200
    chunks.push(remaining.slice(0, end))
    remaining = remaining.slice(end).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
export function resamplePcm16(
  chunks: Float32Array[],
  fromRate: number
): Uint8Array {
  if (!Number.isFinite(fromRate) || fromRate < 8000 || fromRate > 192000)
    throw new Error('Frecuencia de micrófono no válida.')
  const total = Math.min(
    Math.floor(fromRate * 30),
    chunks.reduce((n, chunk) => n + chunk.length, 0)
  )
  const input = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    const allowed = chunk.subarray(0, Math.max(0, total - offset))
    input.set(allowed, offset)
    offset += allowed.length
    if (offset === total) break
  }
  const count = Math.min(480000, Math.floor((total * 16000) / fromRate))
  const output = new Uint8Array(count * 2)
  const view = new DataView(output.buffer)
  for (let i = 0; i < count; i++) {
    const pos = (i * fromRate) / 16000
    const left = Math.floor(pos)
    const fraction = pos - left
    const sample = Math.max(
      -1,
      Math.min(
        1,
        (input[left] ?? 0) * (1 - fraction) + (input[left + 1] ?? 0) * fraction
      )
    )
    view.setInt16(
      i * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true
    )
  }
  return output
}
export function createSpeechEndpoint() {
  let voicedMs = 0
  let quietMs = 0
  return (samples: Float32Array, rate: number): boolean => {
    if (!samples.length || !Number.isFinite(rate) || rate <= 0) return false
    const duration = (samples.length * 1000) / rate
    const rms = Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length
    )
    if (rms >= 0.012) {
      voicedMs += duration
      quietMs = 0
    } else quietMs += duration
    return voicedMs >= 240 && quietMs >= 1200
  }
}
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
function releaseResource(release: () => void) {
  try {
    release()
  } catch {
    return
  }
}
function closeDevices() {
  const previousMedia = media
  media = undefined
  const previousProcessor = processor
  processor = undefined
  const previousSource = source
  source = undefined
  const previousContext = context
  context = undefined
  const resolvePlayback = finishPlayback
  finishPlayback = undefined
  if (timer) clearTimeout(timer)
  timer = undefined
  previousMedia?.getTracks().forEach((track) => {
    releaseResource(() => track.stop())
  })
  if (previousProcessor) {
    previousProcessor.onaudioprocess = null
    releaseResource(() => previousProcessor.disconnect())
  }
  if (previousSource) {
    previousSource.onended = null
    releaseResource(() => previousSource.stop())
    releaseResource(() => previousSource.disconnect())
  }
  resolvePlayback?.()
  cancelAnimationFrame(frame)
  frame = 0
  if (previousContext) void previousContext.close().catch(() => {})
}
/**
 * On the Windows desktop app every assistant speaks with its own cloned voice
 * (a sample from Lore, a recording or a file), never with a synthetic one.
 */
export function clonedVoices() {
  return isPlatformTauri() && /Windows/i.test(navigator.userAgent)
}
let clonedSpeaking = false

function floatPcm(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length - (binary.length % 4))
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Float32Array(bytes.buffer)
}

/**
 * Says `text` with the assistant's cloned voice: Qwen3-TTS streams PCM that is
 * scheduled gap-free as it arrives, through the volume and a meter for the
 * sphere. Resolves when the last sound has played or the turn is replaced.
 */
async function speakCloned(
  player: AudioContext,
  text: string,
  profile: CharacterProfile,
  current: () => boolean,
  update: (state: Partial<Pick<AudioState, 'status' | 'amplitude'>>) => void
) {
  const output = player.createGain()
  output.gain.value = profile.voice.volume
  const analyser = player.createAnalyser()
  analyser.fftSize = 1024
  output.connect(analyser)
  analyser.connect(player.destination)
  const waveform = new Float32Array(analyser.fftSize)
  let endsAt = player.currentTime
  let lastFrame = 0
  const animate = (time: number) => {
    if (!current()) return
    if (time - lastFrame >= 33) {
      analyser.getFloatTimeDomainData(waveform)
      const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length)
      update({ amplitude: Math.min(1, rms * 7) })
      lastFrame = time
    }
    frame = requestAnimationFrame(animate)
  }
  // Pluma's chosen speed and pitch need the whole sentence: it is gathered first.
  const style = profile.id === 'literatura' ? usePlumaVoiceStyle.getState() : undefined
  const styled = !!style && styleChangesAudio(style)
  const held: Float32Array[] = []
  let heldRate = 0
  const play = (samples: Float32Array, sampleRate: number) => {
    if (!samples.length || !current()) return
    const buffer = player.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const part = player.createBufferSource()
    part.buffer = buffer
    part.connect(output)
    const at = Math.max(endsAt, player.currentTime + 0.03)
    part.start(at)
    endsAt = at + buffer.duration
    if (!frame) {
      update({ status: 'speaking' })
      frame = requestAnimationFrame(animate)
    }
  }
  const events = new Channel<{ data: string; sampleRate: number } | { done: true }>()
  events.onmessage = (event) => {
    if (!current() || 'done' in event) return
    const { data, sampleRate } = event
    if (typeof data !== 'string' || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return
    const samples = floatPcm(data)
    if (styled) {
      held.push(samples)
      heldRate = sampleRate
    } else play(samples, sampleRate)
  }
  clonedSpeaking = true
  try {
    await invoke('assistant_voice_speak', {
      ...(profile.id === 'literatura' ? {} : { owner: profile.id }),
      text,
      events,
    })
  } finally {
    clonedSpeaking = false
  }
  if (!current()) return
  if (styled && held.length) {
    const joined = new Float32Array(held.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of held) {
      joined.set(part, offset)
      offset += part.length
    }
    play(applyVoiceStyle(joined, heldRate, style), heldRate)
  }
  // The stream ends before the sound does: wait for what is still queued.
  await new Promise<void>((resolve) => {
    const done = () => {
      if (finishPlayback === done) finishPlayback = undefined
      clearTimeout(timer)
      resolve()
    }
    finishPlayback = done
    timer = setTimeout(done, Math.max(0, (endsAt - player.currentTime) * 1000) + 60)
  })
  cancelAnimationFrame(frame)
  frame = 0
  output.disconnect()
  analyser.disconnect()
}

const fail = (error: unknown) =>
  useCharacterAudio.setState({
    status: 'error',
    amplitude: 0,
    error:
      error instanceof Error
        ? error.message
        : 'El audio local no está disponible; puedes continuar por texto.',
  })

export const useCharacterAudio = create<AudioState>((set, get) => ({
  status: 'idle',
  amplitude: 0,
  error: null,
  voices: [],
  dictation: false,
  catalogLoaded: false,
  autoplayCancelled: false,
  owner: null,
  loadCatalog: async () => {
    if (get().catalogLoaded) return
    if (catalogPromise) return catalogPromise
    catalogPromise = (async () => {
      try {
        const catalog = await invoke<Catalog>('character_audio_capabilities', {
          jobId: crypto.randomUUID(),
        })
        set({
          voices: catalog.voices,
          dictation: catalog.dictation,
          catalogLoaded: true,
          error: null,
        })
      } catch {
        set({
          catalogLoaded: false,
          error:
            'No se pudo consultar el audio local. El chat sigue disponible.',
        })
      }
    })().finally(() => {
      catalogPromise = undefined
    })
    return catalogPromise
  },
  stop: (owner) => {
    if (owner !== undefined && get().owner !== owner) return
    ++generation
    const job = nativeJob
    nativeJob = undefined
    if (job)
      void invoke('character_audio_cancel', { jobId: job }).catch(() => {})
    if (clonedSpeaking) {
      clonedSpeaking = false
      void invoke('assistant_voice_cancel', {}).catch(() => {})
    }
    closeDevices()
    samples = []
    capturedSamples = 0
    receiveText = undefined
    activeOwnership = undefined
    set({
      status: 'idle',
      amplitude: 0,
      error: null,
      autoplayCancelled: true,
      owner: null,
    })
  },
  speak: async (text, profile, options) => {
    if (!authorized(options)) return
    get().stop()
    activeOwnership = options
    set({ owner: options?.owner ?? null })
    const turn = generation
    const current = () => turn === generation && authorized(options)
    const discard = () => {
      if (turn === generation) get().stop(options?.owner)
    }
    try {
      const chunks = speechChunks(text)
      if (!chunks.length) return
      const voiceId = profile.voice.voiceURI ?? defaultVoiceId(profile)
      context = new AudioContext()
      const player = context
      await player.resume()
      for (const chunk of chunks) {
        if (!current()) {
          discard()
          return
        }
        set({ status: 'preparing', error: null, amplitude: 0 })
        if (clonedVoices()) {
          await speakCloned(player, chunk, profile, current, (state) => set(state))
          if (!current()) {
            discard()
            return
          }
          continue
        }
        const jobId = crypto.randomUUID()
        nativeJob = jobId
        const result = await invoke<{ audioBase64: string }>(
          'character_audio_synthesize',
          {
            jobId,
            text: chunk,
            voiceId,
            rate: profile.voice.rate,
            pitch: profile.voice.pitch,
            volume: profile.voice.volume,
          }
        )
        if (!current()) {
          discard()
          return
        }
        nativeJob = undefined
        if (
          typeof result.audioBase64 !== 'string' ||
          result.audioBase64.length > 24 * 1024 * 1024
        )
          throw new Error(
            'El motor local devolvió un audio no válido o demasiado grande.'
          )
        const binary = atob(result.audioBase64)
        const buffer = await player.decodeAudioData(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer
        )
        if (!current()) {
          discard()
          return
        }
        source = player.createBufferSource()
        source.buffer = buffer
        const playbackSource = source
        const analyser = player.createAnalyser()
        analyser.fftSize = 1024
        source.connect(analyser)
        analyser.connect(player.destination)
        const waveform = new Float32Array(analyser.fftSize)
        let lastFrame = 0
        const animate = (time: number) => {
          if (!current()) {
            discard()
            return
          }
          if (time - lastFrame >= 33) {
            analyser.getFloatTimeDomainData(waveform)
            const rms = Math.sqrt(
              waveform.reduce((sum, value) => sum + value * value, 0) /
                waveform.length
            )
            set({ amplitude: Math.min(1, rms * 7) })
            lastFrame = time
          }
          frame = requestAnimationFrame(animate)
        }
        set({ status: 'speaking' })
        await new Promise<void>((resolve) => {
          const done = () => {
            if (finishPlayback === done) finishPlayback = undefined
            resolve()
          }
          finishPlayback = done
          playbackSource.onended = done
          playbackSource.start()
          frame = requestAnimationFrame(animate)
        })
        if (!current()) {
          discard()
          return
        }
        cancelAnimationFrame(frame)
        playbackSource.disconnect()
        if (source === playbackSource) source = undefined
      }
      if (current()) {
        closeDevices()
        set({ status: 'idle', amplitude: 0 })
      }
    } catch (error) {
      if (!current()) {
        discard()
        return
      }
      closeDevices()
      fail(error)
    }
  },
  startDictation: async (onText, options) => {
    if (!authorized(options)) return
    get().stop()
    activeOwnership = options
    set({ owner: options?.owner ?? null })
    const turn = generation
    const current = () => turn === generation && authorized(options)
    const discard = () => {
      if (turn === generation) get().stop(options?.owner)
    }
    try {
      if (!get().dictation)
        throw new Error(
          'Falta el motor local de dictado español. Puedes escribir mientras se configura.'
        )
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'Este entorno no permite acceder al micrófono. Continúa por texto.'
        )
      set({ status: 'preparing', error: null })
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop())
        discard()
        return
      }
      media = stream
      context = new AudioContext()
      const recorder = context
      await recorder.resume()
      if (!current()) {
        discard()
        return
      }
      sampleRate = recorder.sampleRate
      receiveText = onText
      samples = []
      capturedSamples = 0
      const input = recorder.createMediaStreamSource(stream)
      processor = recorder.createScriptProcessor(4096, 1, 1)
      const speechEnded = createSpeechEndpoint()
      processor.onaudioprocess = (event) => {
        if (!current()) {
          discard()
          return
        }
        if (get().status !== 'listening') return
        const available = event.inputBuffer.getChannelData(0)
        const chunk = new Float32Array(
          available.subarray(
            0,
            Math.max(0, Math.floor(sampleRate * 30) - capturedSamples)
          )
        )
        samples.push(chunk)
        capturedSamples += chunk.length
        if (
          capturedSamples >= Math.floor(sampleRate * 30) ||
          (options?.autoFinish && speechEnded(chunk, sampleRate))
        )
          void get().finishDictation()
      }
      const silence = recorder.createGain()
      silence.gain.value = 0
      input.connect(processor)
      processor.connect(silence)
      silence.connect(recorder.destination)
      set({ status: 'listening' })
      timer = setTimeout(() => void get().finishDictation(), 30000)
    } catch (error) {
      if (!current()) {
        discard()
        return
      }
      closeDevices()
      fail(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? new Error(
              'No se concedió acceso al micrófono. Puedes seguir escribiendo.'
            )
          : error
      )
    }
  },
  finishDictation: async () => {
    if (get().status !== 'listening') return
    const turn = generation
    const ownership = activeOwnership
    const current = () => turn === generation && authorized(ownership)
    if (!current()) {
      if (turn === generation) get().stop(ownership?.owner)
      return
    }
    const chunks = samples
    samples = []
    capturedSamples = 0
    const callback = receiveText
    receiveText = undefined
    closeDevices()
    set({ status: 'transcribing', amplitude: 0 })
    try {
      const pcmBase64 = base64(resamplePcm16(chunks, sampleRate))
      const jobId = crypto.randomUUID()
      nativeJob = jobId
      const result = await invoke<{ text: string }>(
        'character_audio_transcribe',
        { jobId, pcmBase64 }
      )
      if (!current()) {
        if (turn === generation) get().stop(ownership?.owner)
        return
      }
      nativeJob = undefined
      if (
        typeof result.text !== 'string' ||
        result.text.length > 100000 ||
        !result.text.trim()
      )
        throw new Error(
          'No se reconocieron palabras válidas. Prueba otra vez o escribe tu mensaje.'
        )
      set({ status: 'idle', error: null })
      callback?.(result.text.trim())
    } catch (error) {
      if (current()) fail(error)
      else if (turn === generation) get().stop(ownership?.owner)
    }
  },
}))
