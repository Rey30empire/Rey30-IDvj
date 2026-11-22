import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import type { PlumaReference } from './pluma-clone'
import { audioToVoiceSample } from './voice-recorder'

/**
 * The project's Lore folder: Pluma's library (`biblioteca`), the voices she can
 * speak and sing with (`voces/hablar`, `voces/cantar`) and saved song lyrics
 * (`canciones`). Files dropped there show up here without rebuilding the app.
 */
export type LoreFolder = '' | 'biblioteca' | 'voces/hablar' | 'voces/cantar' | 'canciones'
/** `convert`: not a WAV or MP3 (an M4A or OGG voice note, say), so the app turns it into a WAV to use it. */
export type LoreVoice = { file: string; name: string; bytes: number; convert?: boolean }
export type LoreVoices = { root: string | null; voices: LoreVoice[]; selected: string | null }
export type LoreSong = { title: string; lyrics: string }

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)

export const loreVoices = (singing = false) => invoke<LoreVoices>('lore_voices', { singing })
const directAudio = /\.(?:wav|mp3)$/i

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/**
 * Makes a Lore voice her speaking sample, or with `singing` the one she sings
 * with. A WAV or MP3 goes as it is; another format (an M4A or OGG voice note)
 * is turned into a WAV here first, and the file in Lore is left untouched.
 */
export async function applyLoreVoice(file: string, singing = false, convert: (audio: ArrayBuffer, unreadable: string) => Promise<string> = audioToVoiceSample): Promise<PlumaReference> {
  if (directAudio.test(file)) return invoke<PlumaReference>('lore_voice_use', { singing, file })
  const original = await invoke<string>('lore_voice_read', { singing, file })
  const audio = await convert(bytesOf(original), `No se pudo leer «${file}». Guárdalo como WAV, MP3, M4A u OGG.`)
  return invoke<PlumaReference>('lore_voice_use', { singing, file, audio })
}
export const openLoreFolder = (folder: LoreFolder) => invoke<void>('lore_open', { folder })
/**
 * Saves a voice recorded in the app (`wav` in base64) as a new file in Lore,
 * never over another one, and makes it the sample she speaks or sings with.
 */
export const saveLoreVoice = (name: string, wav: string, singing = false) => invoke<PlumaReference>('lore_voice_save', { singing, name, audio: wav })

/** The songs saved in `Lore/canciones`; none outside the desktop app or when Lore is missing. */
export async function loadLoreSongs(): Promise<LoreSong[]> {
  if (!isPlatformTauri()) return []
  try {
    const songs = await invoke<LoreSong[]>('lore_songs')
    return Array.isArray(songs) ? songs.filter(song => typeof song?.title === 'string' && typeof song.lyrics === 'string' && song.title.trim() && song.lyrics.trim()) : []
  } catch {
    return []
  }
}

const comparable = (value: string) => value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()

/** The saved song a title names: exact first, then ignoring case, accents and punctuation. */
export function findLoreSong(songs: LoreSong[], title: string): LoreSong | undefined {
  const wanted = comparable(title)
  if (!wanted) return undefined
  return songs.find(song => song.title === title) ?? songs.find(song => comparable(song.title) === wanted)
}
