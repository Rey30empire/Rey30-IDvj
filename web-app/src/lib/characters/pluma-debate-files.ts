import { getServiceHub } from '@/hooks/useServiceHub'
import type { DebateLine, DebateGender, DebatePortrait, ResolvedAgent } from './pluma-debate'
import { base64Of, debateTracks, encodeWav, type DebateRecording, type DebateTiming } from './pluma-debate-player'

/**
 * Debates kept in `Lore/debates/<fecha participantes>/`: «Debate completo.wav»,
 * one WAV per agent with only their turns, «Guion.md» and «debate.json» (who
 * spoke and when, to light the right hologram when it plays again).
 */
export const FULL_TRACK = 'Debate completo.wav'
export const SCRIPT_FILE = 'Guion.md'
export const TIMING_FILE = 'debate.json'

export type SavedAgent = { name: string; gender: DebateGender; portrait: DebatePortrait; file: string }
export type SavedDebateInfo = { folder: string; agents: SavedAgent[]; timing: DebateTiming }

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)
const KEY = 'rey30-pluma-debate-audio'
const MAX_REMEMBERED = 60

/** A short fingerprint of a script, to find its saved audio again. */
export function scriptKey(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}-${text.length}`
}

type Remembered = Record<string, SavedDebateInfo>
function remembered(): Remembered {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return value && typeof value === 'object' ? value as Remembered : {}
  } catch {
    return {}
  }
}
function remember(key: string, info: SavedDebateInfo) {
  try {
    const all = { ...remembered(), [key]: info }
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[old]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Without storage the debate is still in Lore; it just is not found from the chat.
  }
}

/** A file name for an agent's track that no other agent of the debate has. */
export function trackFiles(names: string[]) {
  const used = new Set([FULL_TRACK.toLowerCase(), SCRIPT_FILE.toLowerCase(), TIMING_FILE.toLowerCase()])
  return names.map((name, index) => {
    const clean = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 60).trim()
    // Windows keeps device names (CON, COM1…) for itself.
    const base = !clean || /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(clean.split('.')[0]) ? `Agente ${index + 1}` : clean
    let file = `${base}.wav`
    for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} ${n}.wav`
    used.add(file.toLowerCase())
    return file
  })
}

const two = (value: number) => String(value).padStart(2, '0')
export function debateTitle(names: string[], when = new Date()) {
  const date = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}.${two(when.getMinutes())}`
  const cast = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0] ?? 'Pluma'
  return `${date} Debate de ${cast}`
}

const utf8 = (text: string) => new TextEncoder().encode(text)

/** Saves a recorded debate in Lore and remembers where, for this script. */
export async function saveDebate(script: string, lines: DebateLine[], agents: ResolvedAgent[], recording: DebateRecording): Promise<SavedDebateInfo> {
  const { full, voices, timing } = debateTracks(recording, lines, agents)
  const files = trackFiles(agents.map(agent => agent.name))
  const transcript = `# ${debateTitle(agents.map(agent => agent.name))}\n\n${lines.map(line => `**${line.name}:** ${line.text}`).join('\n\n')}\n`
  const saved: SavedAgent[] = agents.map((agent, index) => ({ name: agent.name, gender: agent.gender, portrait: agent.portrait, file: files[index] }))
  const result = await invoke<{ folder: string; files: string[] }>('debate_save', {
    title: debateTitle(agents.map(agent => agent.name)),
    files: [
      { name: FULL_TRACK, data: base64Of(encodeWav(full, recording.sampleRate)) },
      ...voices.map((voice, index) => ({ name: files[index], data: base64Of(encodeWav(voice.samples, recording.sampleRate)) })),
      { name: SCRIPT_FILE, data: base64Of(utf8(transcript)) },
      { name: TIMING_FILE, data: base64Of(utf8(JSON.stringify({ agents: saved, timing }))) },
    ],
  })
  const info = { folder: result.folder, agents: saved, timing }
  remember(scriptKey(script), info)
  return info
}

/** The saved debate of this script, when its folder is still in Lore. */
export async function savedDebate(script: string): Promise<SavedDebateInfo | undefined> {
  const info = remembered()[scriptKey(script)]
  if (!info?.folder) return undefined
  try {
    const files = await invoke<string[]>('debate_files', { folder: info.folder })
    return files.includes(FULL_TRACK) ? info : undefined
  } catch {
    return undefined
  }
}

export async function readDebateTrack(folder: string, file: string): Promise<ArrayBuffer> {
  const binary = atob(await invoke<string>('debate_read', { folder, file }))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export const openDebateFolder = (folder: string) => invoke<void>('debate_open', { folder })

/** Copies one file (or with none, the whole debate) to where the person chooses; `null` if they cancel. */
export const exportDebate = (folder: string, file?: string) => invoke<string | null>('debate_export', file ? { folder, file } : { folder })
