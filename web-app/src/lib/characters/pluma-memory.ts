import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * What Pluma learns across calls: short notes about the person (name, tastes,
 * projects, how they like to be answered) that she saves with the `recordar`
 * tool and reads at the start of every call. The model's weights never change;
 * this is the memory that makes each conversation build on the previous ones.
 */
export const PLUMA_MEMORY_KEY = 'rey30-pluma-memory-v1'
export const MAX_PLUMA_NOTES = 200
/** How many notes go into one prompt: the relevant ones plus the most recent. */
export const PLUMA_NOTES_PER_PROMPT = 30
/** Kinds of note that always reach the prompt, whatever the topic. */
const ALWAYS_RECALLED = [/^se llama\b/i, /^corrección:/i, /^gusto musical:/i, /^prefiere\b/i]
export const MAX_PLUMA_NOTE_LENGTH = 200

export type PlumaMemoryStorage = { read(): Promise<string | null>; write(value: string): Promise<void> }

const native = () => isPlatformTauri() && typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export const plumaMemoryStorage: PlumaMemoryStorage = {
  async read() {
    if (!native()) return localStorage.getItem(PLUMA_MEMORY_KEY)
    return await getServiceHub().core().invoke<string | null>('settings_get', { key: PLUMA_MEMORY_KEY })
  },
  async write(value) {
    if (!native()) { localStorage.setItem(PLUMA_MEMORY_KEY, value); return }
    const core = getServiceHub().core()
    await core.invoke('settings_set', { key: PLUMA_MEMORY_KEY, value })
    await core.invoke('settings_commit')
  },
}

// Things Pluma must not keep even if asked in passing: secrets and payment or
// identity numbers. Health, beliefs and similar stay out unless the person
// explicitly asks her to remember them (the tool description says so).
const secret = /\b(?:contrase(?:ñ|n)a|password|clave (?:de|del) (?:banco|wifi|acceso)|pin\b|cvv|token|api[ -]?key)\b|\b(?:\d[ -]?){12,19}\b/iu

const comparable = (note: string) => note.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function normalizePlumaNote(note: string): string | undefined {
  const clean = note.replace(/\s+/g, ' ').trim().replace(/^[-•*]\s*/, '')
  if (clean.length < 3 || clean.length > MAX_PLUMA_NOTE_LENGTH || secret.test(clean)) return undefined
  return clean
}

function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as { notes?: unknown }
    return Array.isArray(value.notes)
      ? value.notes.filter((note): note is string => typeof note === 'string' && !!normalizePlumaNote(note))
      : []
  } catch {
    return []
  }
}

/** Adds a note. A note that repeats or extends an older one replaces it. */
export function withPlumaNote(notes: string[], note: string): string[] {
  const clean = normalizePlumaNote(note)
  if (!clean) return notes
  const key = comparable(clean)
  const kept = notes.filter(old => {
    const previous = comparable(old)
    return previous !== key && !key.includes(previous) && !previous.includes(key)
  })
  return [...kept, clean].slice(-MAX_PLUMA_NOTES)
}

/** Removes every note that mentions all the words of `topic`. */
export function withoutPlumaNotes(notes: string[], topic: string): string[] {
  const words = comparable(topic).split(' ').filter(word => word.length > 2)
  if (!words.length) return notes
  return notes.filter(note => {
    const text = comparable(note)
    return !words.every(word => text.includes(word))
  })
}

export async function loadPlumaMemory(storage = plumaMemoryStorage): Promise<string[]> {
  try {
    return parse(await storage.read())
  } catch {
    return []
  }
}

async function update(change: (notes: string[]) => string[], storage: PlumaMemoryStorage) {
  const notes = change(await loadPlumaMemory(storage))
  await storage.write(JSON.stringify({ notes }))
  return notes
}

export const rememberForPluma = (note: string, storage = plumaMemoryStorage) =>
  update(notes => withPlumaNote(notes, note), storage)

export const forgetForPluma = (topic: string, storage = plumaMemoryStorage) =>
  update(notes => withoutPlumaNotes(notes, topic), storage)

export const clearPlumaMemory = (storage = plumaMemoryStorage) => update(() => [], storage)

/** Removes exactly this note, as shown in settings. */
export const forgetPlumaNote = (note: string, storage = plumaMemoryStorage) =>
  update(notes => notes.filter(item => item !== note), storage)

/**
 * The notes worth putting in front of the model for `query`: the ones that
 * always matter (name, corrections, preferences, music taste), the ones that
 * share words with what the person just said, then the most recent, up to
 * `limit`, kept in the order they were learned.
 */
export function selectPlumaMemory(notes: string[], query = '', limit = PLUMA_NOTES_PER_PROMPT): string[] {
  if (notes.length <= limit) return notes
  const words = new Set(comparable(query).split(' ').filter(word => word.length > 3))
  const scored = notes.map((note, index) => {
    const always = ALWAYS_RECALLED.some(pattern => pattern.test(note))
    const overlap = comparable(note).split(' ').filter(word => words.has(word)).length
    // Recency breaks ties, so a fresh note beats an old one on the same topic.
    return { index, score: (always ? 1_000 : 0) + overlap * 10 + index / notes.length }
  })
  const chosen = new Set(scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ index }) => index))
  return notes.filter((_, index) => chosen.has(index))
}

/** The memory as a block for the system prompt, or '' when empty. */
export function plumaMemoryPrompt(notes: string[], query = ''): string {
  const selected = selectPlumaMemory(notes, query)
  if (!selected.length) return ''
  return [
    'Lo que has aprendido de la persona en conversaciones anteriores. Úsalo con naturalidad, sin recitarlo ni decir que lo tienes guardado. Las correcciones guardadas mandan sobre lo que creías antes:',
    ...selected.map(note => `- ${note}`),
  ].join('\n')
}
