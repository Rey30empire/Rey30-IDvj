import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import { defaultVoiceId } from './audio'
import type { PlumaReference } from './pluma-clone'
import type { CharacterProfile } from './types'
import { audioToVoiceSample } from './voice-recorder'

/**
 * The project's Lore folder: Pluma's library (`biblioteca`), the voices to
 * speak and sing with (`voces/<carpeta>/hablar`, `voces/<carpeta>/cantar`) and
 * saved song lyrics (`canciones`). Files dropped there show up here without
 * rebuilding the app.
 *
 * A voice folder is an assistant's first name (`Pluma`, `Coder`) or a gender
 * (`mujer`, `hombre`): an assistant is offered its own voices and those of its
 * gender, so a man's voice never turns up for a woman. The old flat
 * `voces/hablar` and `voces/cantar` still count, as the folder "".
 */
export type LoreFolder = '' | 'biblioteca' | 'voces' | 'voces/hablar' | 'voces/cantar' | 'canciones' | `voces/${string}`
/** `convert`: not a WAV or MP3 (an M4A or OGG voice note, say), so the app turns it into a WAV to use it. */
export type LoreVoice = { group?: string; file: string; name: string; bytes: number; convert?: boolean }
/** `selected`: the voice in use as `carpeta/archivo` (the file alone in the old flat folder). */
export type LoreVoices = { root: string | null; voices: LoreVoice[]; selected: string | null }
export type LoreSong = { title: string; lyrics: string }
export type LoreGender = 'mujer' | 'hombre'
/** The voice folders an assistant uses: its own, then its gender's. */
export type LoreVoiceGroups = { own: string; gender: LoreGender }

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)

/** How the app names a Lore voice: the same text the backend remembers. */
export const loreVoiceKey = (voice: Pick<LoreVoice, 'group' | 'file'>) => voice.group ? `${voice.group}/${voice.file}` : voice.file

/** The assistant's own voice folder: its first name, without characters a folder cannot have. */
export function loreOwnFolder(name: string, fallback: string) {
  const first = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ').trim().split(/\s+/)[0]?.replace(/^\.+|\.+$/g, '') ?? ''
  return first && !/^(?:hablar|cantar|mujer|hombre)$/i.test(first) ? first : fallback
}

/** Woman or man, from the voice it speaks with (`…+f3` is a woman's). */
export function loreGender(profile: Pick<CharacterProfile, 'baseId' | 'voice'>): LoreGender {
  const variant = /\+([fm])\d*$/i.exec(profile.voice.voiceURI ?? '') ?? /\+([fm])\d*$/i.exec(defaultVoiceId(profile as CharacterProfile))
  return variant?.[1].toLowerCase() === 'f' ? 'mujer' : 'hombre'
}

/** A built-in assistant keeps its folder even if renamed: Plumita's is `Pluma`, Coder's `Coder`. */
function builtInFolder(profile: Pick<CharacterProfile, 'id' | 'baseId'>) {
  if (profile.id !== profile.baseId) return undefined
  return profile.baseId === 'literatura' ? 'Pluma' : profile.baseId.charAt(0).toUpperCase() + profile.baseId.slice(1)
}

export const loreVoiceGroups = (profile: Pick<CharacterProfile, 'id' | 'name' | 'baseId' | 'voice'>): LoreVoiceGroups =>
  ({ own: builtInFolder(profile) ?? loreOwnFolder(profile.name, profile.baseId), gender: loreGender(profile) })

/** `voces/<carpeta>/hablar` or `…/cantar`. */
export const loreVoiceFolder = (group: string, singing = false): LoreFolder => `voces/${group}/${singing ? 'cantar' : 'hablar'}`

/** `owner`: another assistant than Pluma, whose own choice of Lore voice is remembered apart. */
const withOwner = <T extends Record<string, unknown>>(args: T, owner?: string) => owner ? { ...args, owner } : args

/** The voices of `groups` (its own folder, its gender's, then the old flat one), or every folder's. */
export const loreVoices = (singing = false, groups?: LoreVoiceGroups, owner?: string) =>
  invoke<LoreVoices>('lore_voices', withOwner(groups ? { singing, groups: [groups.own, groups.gender, ''] } : { singing }, owner))
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
export async function applyLoreVoice(voice: Pick<LoreVoice, 'group' | 'file'>, singing = false, convert: (audio: ArrayBuffer, unreadable: string) => Promise<string> = audioToVoiceSample, owner?: string): Promise<PlumaReference> {
  const { file } = voice
  const where = voice.group ? { singing, group: voice.group, file } : { singing, file }
  if (directAudio.test(file)) return invoke<PlumaReference>('lore_voice_use', withOwner(where, owner))
  const original = await invoke<string>('lore_voice_read', where)
  const audio = await convert(bytesOf(original), `No se pudo leer «${file}». Guárdalo como WAV, MP3, M4A u OGG.`)
  return invoke<PlumaReference>('lore_voice_use', withOwner({ ...where, audio }, owner))
}
export const openLoreFolder = (folder: LoreFolder) => invoke<void>('lore_open', { folder })
/**
 * Saves a voice recorded in the app (`wav` in base64) as a new file in Lore,
 * in the assistant's own folder (`group`) and never over another one, and
 * makes it the sample she speaks or sings with.
 */
export const saveLoreVoice = (name: string, wav: string, singing = false, group?: string, owner?: string) =>
  invoke<PlumaReference>('lore_voice_save', withOwner(group ? { singing, group, name, audio: wav } : { singing, name, audio: wav }, owner))

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
