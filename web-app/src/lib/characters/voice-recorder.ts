import { encodePlumaWav } from './pluma-audio'

/**
 * Records a voice sample from the microphone for Pluma to clone: a few seconds
 * of clear speech, saved as a 24 kHz mono WAV like the samples in Lore.
 */

/** Qwen needs a few seconds of voice to copy it; past half a minute it learns nothing more. */
export const VOICE_SAMPLE_MIN_SECONDS = 5
export const VOICE_SAMPLE_MAX_SECONDS = 30
const SAMPLE_RATE = 24_000
/** Below this the start and end of the take count as silence. */
const SILENCE = 0.02
/** A take whose loudest moment stays under this heard no voice at all. */
const NO_VOICE = 0.05
const MARGIN_SECONDS = 0.15

/**
 * The part of a take worth cloning: silence around it trimmed (keeping a short
 * margin), at most the maximum length, and brought to an even loudness.
 */
export function prepareVoiceSample(take: Float32Array, rate: number): Float32Array {
  let peak = 0
  for (const value of take) peak = Math.max(peak, Math.abs(value))
  if (peak < NO_VOICE) throw new Error('No se oye tu voz. Revisa que el micrófono esté encendido y sin silenciar.')
  let start = 0
  let end = take.length
  while (start < end && Math.abs(take[start]) < SILENCE) start++
  while (end > start && Math.abs(take[end - 1]) < SILENCE) end--
  const margin = Math.round(rate * MARGIN_SECONDS)
  start = Math.max(0, start - margin)
  end = Math.min(take.length, end + margin, start + Math.round(rate * VOICE_SAMPLE_MAX_SECONDS))
  const seconds = (end - start) / rate
  if (seconds < VOICE_SAMPLE_MIN_SECONDS) throw new Error(`Solo se oyen ${seconds.toFixed(1)} s de voz. Habla al menos ${VOICE_SAMPLE_MIN_SECONDS} segundos.`)
  const gain = Math.min(4, 0.9 / peak)
  return take.slice(start, end).map(value => value * gain)
}

export type VoiceRecorder = {
  /** How loud the microphone is right now, 0 to 1. */
  level: () => number
  /** Stops and returns the sample as a WAV in base64. */
  finish: () => Promise<string>
  cancel: () => void
}

/**
 * Any audio the window can play (a recording, an M4A or OGG voice note…) as a
 * voice sample: a 24 kHz mono WAV in base64, trimmed and evened out.
 */
export async function audioToVoiceSample(data: ArrayBuffer, unreadable = 'No se pudo leer la grabación. Vuelve a grabar.'): Promise<string> {
  const decoder = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decoder.decodeAudioData(data)
  } catch {
    throw new Error(unreadable)
  } finally {
    void decoder.close().catch(() => undefined)
  }
  // Rendering into one channel at the sample rate mixes down and resamples in one go.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const mono = (await offline.startRendering()).getChannelData(0)
  return encodePlumaWav([prepareVoiceSample(mono, SAMPLE_RATE)], SAMPLE_RATE)
}

export async function recordVoice(): Promise<VoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('No se puede grabar audio en esta ventana de Rey30.')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
  const meter = new AudioContext()
  // Created after the permission prompt, it may start suspended and read silence.
  void meter.resume().catch(() => undefined)
  const analyser = meter.createAnalyser()
  analyser.fftSize = 1024
  meter.createMediaStreamSource(stream).connect(analyser)
  const frame = new Float32Array(analyser.fftSize)
  let released = false
  const release = () => {
    if (released) return
    released = true
    stream.getTracks().forEach(track => track.stop())
    void meter.close().catch(() => undefined)
  }
  recorder.start(250)
  return {
    level: () => {
      if (released) return 0
      analyser.getFloatTimeDomainData(frame)
      let sum = 0
      for (const value of frame) sum += value * value
      return Math.min(1, Math.sqrt(sum / frame.length) * 6)
    },
    cancel: () => {
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
    finish: () => new Promise<string>((resolve, reject) => {
      recorder.onstop = () => {
        release()
        new Blob(chunks, { type: recorder.mimeType }).arrayBuffer().then(audioToVoiceSample).then(resolve, cause => reject(cause instanceof Error ? cause : new Error('No se pudo preparar la grabación.')))
      }
      if (recorder.state === 'inactive') recorder.onstop(new Event('stop'))
      else recorder.stop()
    }),
  }
}
