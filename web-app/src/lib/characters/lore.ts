import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import type { PlumaReference } from './pluma-clone'

/**
 * The project's Lore folder: Pluma's library (`biblioteca`), the voices she can
 * speak and sing with (`voces/hablar`, `voces/cantar`) and saved song lyrics
 * (`canciones`). Files dropped there show up here without rebuilding the app.
 */
export type LoreFolder = '' | 'biblioteca' | 'voces/hablar' | 'voces/cantar' | 'canciones'
export type LoreVoice = { file: string; name: string; bytes: number }
export type LoreVoices = { root: string | null; voices: LoreVoice[]; selected: string | null }
export type LoreSong = { title: string; lyrics: string }

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)

export const loreVoices = (singing = false) => invoke<LoreVoices>('lore_voices', { singing })
/** Makes a Lore voice her speaking sample, or with `singing` the one she sings with. */
export const applyLoreVoice = (file: string, singing = false) => invoke<PlumaReference>('lore_voice_use', { singing, file })
export const openLoreFolder = (folder: LoreFolder) => invoke<void>('lore_open', { folder })

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
