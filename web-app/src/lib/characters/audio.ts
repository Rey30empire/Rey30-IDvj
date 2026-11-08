import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
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
  kairo: 'm1',
  beto: 'm2',
  tino: 'm3',
  milo: 'm4',
  roco: 'm5',
  nara: 'f3',
  centinela: 'm2',
  verso: 'm4',
  fullstack: 'm3',
  literatura: 'f3',
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
