import { Channel } from '@tauri-apps/api/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { DebateLine, ResolvedAgent } from './pluma-debate'
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

/**
 * Loads each participant's voice once, as a trimmed WAV sample, and returns
 * the id of each (`undefined`: Pluma's own sample). Participants who share a
 * Lore voice share the sample.
 */
export async function loadDebateVoices(agents: ResolvedAgent[], convert: (audio: ArrayBuffer, unreadable: string) => Promise<string> = audioToVoiceSample): Promise<(string | undefined)[]> {
  const loaded = new Map<string, string>()
  const ids: (string | undefined)[] = []
  for (const agent of agents) {
    if (!agent.voice) {
      ids.push(undefined)
      continue
    }
    const { group, file } = agent.voice
    const key = `${group}/${file}`
    if (!loaded.has(key)) {
      const original = await invoke<string>('lore_voice_read', group ? { singing: false, group, file } : { singing: false, file })
      const sample = await convert(bytesOf(original), `No se pudo leer la voz «${file}» de ${agent.name}.`)
      loaded.set(key, await invoke<string>('voice_reference_load', { audio: sample }))
    }
    ids.push(loaded.get(key))
  }
  return ids
}

export type DebatePlayback = { stop: () => void; done: Promise<void> }

/** The pause between two speakers, in seconds. */
const turnPause = 0.35

/**
 * Reads the debate aloud, each line with its participant's voice and tone.
 * Lines are generated one after another while the earlier ones play, so the
 * conversation flows without gaps. `onLine` says who starts speaking.
 */
export function playDebate(lines: DebateLine[], agents: ResolvedAgent[], voices: (string | undefined)[], onLine?: (index: number) => void): DebatePlayback {
  const context = new AudioContext()
  const timers: ReturnType<typeof setTimeout>[] = []
  let stopped = false
  let endsAt = 0
  const done = (async () => {
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
        const buffer = context.createBuffer(1, samples.length, sampleRate)
        buffer.getChannelData(0).set(samples)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
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
      endsAt += turnPause
    }
    // The last lines are still playing when their generation ends.
    while (!stopped && context.currentTime < endsAt) await sleep(100)
  })().finally(() => {
    timers.forEach(clearTimeout)
    void context.close().catch(() => undefined)
  })
  return {
    done,
    stop: () => {
      if (stopped) return
      stopped = true
      void invoke('assistant_voice_cancel', {}).catch(() => undefined)
      void context.close().catch(() => undefined)
    },
  }
}
