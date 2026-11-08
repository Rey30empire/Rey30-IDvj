import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * What Pluma learns across calls: short notes about the person (name, tastes,
 * projects, how they like to be answered) that she saves with the `recordar`
 * tool and reads at the start of every call. The model's weights never change;
 * this is the memory that makes each conversation build on the previous ones.
 */
export const PLUMA_MEMORY_KEY = 'rey30-pluma-memory-v1'
export const MAX_PLUMA_NOTES = 40
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

/** The memory as a block for Gemma's system prompt, or '' when empty. */
export function plumaMemoryPrompt(notes: string[]): string {
  if (!notes.length) return ''
  return [
    'Lo que has aprendido de la persona en llamadas anteriores. Úsalo con naturalidad, sin recitarlo ni decir que lo tienes guardado:',
    ...notes.map(note => `- ${note}`),
  ].join('\n')
}
