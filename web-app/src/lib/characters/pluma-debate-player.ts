import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { AssignedVoice, DebateLine, ResolvedAgent } from './pluma-debate'
import { PLUMA_EMOTIONS } from './pluma-voice-style'
import { audioToVoiceSample } from './voice-recorder'

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function floatPcm(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length - (binary.length % 4))
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Float32Array(bytes.buffer)
}

export function base64Of(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/**
 * Loads each agent's voice once, as a trimmed WAV sample, and returns the id
 * of each (`undefined`: Pluma's own sample). Agents given the same Lore voice
 * share the sample.
 */
export async function loadDebateVoices(voices: AssignedVoice[], names: string[], convert: (audio: ArrayBuffer, unreadable: string) => Promise<string> = audioToVoiceSample): Promise<(string | undefined)[]> {
  const loaded = new Map<string, string>()
  const ids: (string | undefined)[] = []
  for (const [index, voice] of voices.entries()) {
    if (voice === 'pluma') {
      ids.push(undefined)
      continue
    }
    const { group, file } = voice
    const key = `${group}/${file}`
    if (!loaded.has(key)) {
      const original = await invoke<string>('lore_voice_read', group ? { singing: false, group, file } : { singing: false, file })
      const sample = await convert(bytesOf(original), `No se pudo leer la voz «${file}» de ${names[index] ?? 'un agente'}.`)
      loaded.set(key, await invoke<string>('voice_reference_load', { audio: sample }))
    }
    ids.push(loaded.get(key))
  }
  return ids
}

/** The pause between two speakers, in seconds. */
export const TURN_PAUSE = 0.35

/** The debate as it was heard: each line's samples, at one rate. */
export type DebateRecording = { sampleRate: number; lines: Float32Array[] }
/** Where each line falls in the whole debate, in seconds. */
export type DebateTiming = { agent: number; start: number; end: number }[]

export type DebatePlayback = {
  stop: () => void
  /** The recording once every line was generated and played; `null` when stopped first. */
  done: Promise<DebateRecording | null>
  /** How loud it sounds right now, 0 to 1, for the speaker's hologram. */
  level: () => number
}

function meter(context: AudioContext) {
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.connect(context.destination)
  const data = new Float32Array(analyser.fftSize)
  return {
    input: analyser,
    level: () => {
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (const value of data) sum += value * value
      return Math.min(1, Math.sqrt(sum / data.length) * 4)
    },
  }
}

function joined(parts: Float32Array[], pause: number, rate: number) {
  const gap = Math.round(pause * rate)
  const total = parts.reduce((sum, part) => sum + part.length, 0) + gap * Math.max(0, parts.length - 1)
  const out = new Float32Array(total)
  let at = 0
  for (const [index, part] of parts.entries()) {
    if (index) at += gap
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Reads the debate aloud, each line with its agent's voice and tone, and
 * records it. Lines are generated one after another while the earlier ones
 * play, so the conversation flows without gaps. `onLine` says who starts
 * speaking.
 */
export function playDebate(lines: DebateLine[], agents: ResolvedAgent[], voices: (string | undefined)[], onLine?: (index: number) => void): DebatePlayback {
  const context = new AudioContext()
  const output = meter(context)
  const timers: ReturnType<typeof setTimeout>[] = []
  const recorded: Float32Array[][] = lines.map(() => [])
  let rate = 0
  let stopped = false
  let endsAt = 0
  const done = (async (): Promise<DebateRecording | null> => {
    await context.resume()
    endsAt = context.currentTime + 0.1
    for (let index = 0; index < lines.length && !stopped; index++) {
      const line = lines[index]
      const agent = agents[line.agent]
      const description = PLUMA_EMOTIONS[agent?.tone ?? 'normal']?.voice
      let announced = false
      const events = new Channel<{ data: string; sampleRate: number } | { done: true }>()
      events.onmessage = event => {
        if (stopped || 'done' in event) return
        const { data, sampleRate } = event
        if (typeof data !== 'string' || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return
        const samples = floatPcm(data)
        if (!samples.length) return
        // One engine speaks the whole debate, so one rate; a different one is not kept.
        if (!rate) rate = sampleRate
        if (sampleRate === rate) recorded[index].push(samples)
        const buffer = context.createBuffer(1, samples.length, sampleRate)
        buffer.getChannelData(0).set(samples)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(output.input)
        const at = Math.max(endsAt, context.currentTime + 0.05)
        if (!announced) {
          announced = true
          timers.push(setTimeout(() => { if (!stopped) onLine?.(index) }, Math.max(0, (at - context.currentTime) * 1000)))
        }
        source.start(at)
        endsAt = at + buffer.duration
      }
      const voice = voices[line.agent]
      await invoke('voice_read_aloud', { ...(voice ? { reference: voice } : {}), text: line.text, ...(description ? { description } : {}), events })
      endsAt += TURN_PAUSE
    }
    // The last lines are still playing when their generation ends.
    while (!stopped && context.currentTime < endsAt) await sleep(100)
    if (stopped || !rate) return null
    return { sampleRate: rate, lines: recorded.map(parts => joined(parts, 0, rate)) }
  })().finally(() => {
    timers.forEach(clearTimeout)
    void context.close().catch(() => undefined)
  })
  return {
    done,
    level: output.level,
    stop: () => {
      if (stopped) return
      stopped = true
      void invoke('assistant_voice_cancel', {}).catch(() => undefined)
      void context.close().catch(() => undefined)
    },
  }
}

/** A mono 16-bit WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const put = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)) }
  put(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVE'); put(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  put(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * 0x7fff, true)
  return new Uint8Array(view.buffer)
}

/**
 * The tracks of a recorded debate: the whole conversation (with a short pause
 * between turns) and each agent's turns alone, plus where each line falls.
 */
export function debateTracks(recording: DebateRecording, lines: DebateLine[], agents: Pick<ResolvedAgent, 'name'>[]) {
  const { sampleRate: rate } = recording
  const timing: DebateTiming = []
  let at = 0
  for (const [index, samples] of recording.lines.entries()) {
    if (index) at += TURN_PAUSE
    const length = samples.length / rate
    timing.push({ agent: lines[index]?.agent ?? 0, start: at, end: at + length })
    at += length
  }
  return {
    full: joined(recording.lines, TURN_PAUSE, rate),
    voices: agents.map((agent, index) => ({ name: agent.name, samples: joined(recording.lines.filter((_, line) => lines[line]?.agent === index), TURN_PAUSE, rate) })),
    timing,
  }
}

/** Who is speaking at `seconds` into the whole debate, or `undefined` in a pause. */
export const speakerAt = (timing: DebateTiming, seconds: number) =>
  timing.findIndex(line => seconds >= line.start && seconds < line.end)

export type TrackPlayback = { stop: () => void; done: Promise<void>; level: () => number; position: () => number }

/** Plays a saved WAV (the whole debate or one voice). */
export function playTrack(wav: ArrayBuffer): TrackPlayback {
  const context = new AudioContext()
  const output = meter(context)
  let source: AudioBufferSourceNode | undefined
  let startedAt = 0
  let stopped = false
  const done = (async () => {
    await context.resume()
    const buffer = await context.decodeAudioData(wav.slice(0))
    if (stopped) return
    source = context.createBufferSource()
    source.buffer = buffer
    source.connect(output.input)
    const ended = new Promise<void>(resolve => { source!.onended = () => resolve() })
    startedAt = context.currentTime
    source.start()
    await ended
  })().finally(() => { void context.close().catch(() => undefined) })
  return {
    done,
    level: output.level,
    position: () => (stopped || !source ? 0 : context.currentTime - startedAt),
    stop: () => {
      if (stopped) return
      stopped = true
      try { source?.stop() } catch { /* not started */ }
      void context.close().catch(() => undefined)
    },
  }
}
