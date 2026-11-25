import { getServiceHub } from '@/hooks/useServiceHub'
import { usePlumaReading } from '@/stores/usePlumaReading'
import type { Attachment } from '@/types/attachment'

export type PlumaReadingSection = { title: string; text: string }
export type PlumaBook = { title: string; chunks: string[] }
export type PlumaReadingProgress = { title: string; percent: number }
/** What a call needs from reading mode. */
export type PlumaReader = {
  /** The loaded book and how far she has read it; undefined without one. */
  current(): PlumaReadingProgress | undefined
  load(): Promise<PlumaBook>
  /** The passage to continue from. */
  position(): number
  save(position: number, total: number): void
}

const invoke = <T>(command: string, args: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)
const maxPassage = 420

export const readingPercent = (position: number, total: number) => Math.min(100, Math.max(0, Math.round(position / Math.max(1, total) * 100)))

/** A sentence longer than a passage is cut at a comma or, failing that, between words. */
function pieces(paragraph: string, max: number): string[] {
  return paragraph.split(/(?<=[.!?…»”"])\s+/u).flatMap(sentence => {
    if (sentence.length <= max) return [sentence]
    const parts: string[] = []
    let current = ''
    for (const word of sentence.split(/(?<=[,;:])\s+|\s+/u)) {
      if (current && current.length + 1 + word.length > max) { parts.push(current); current = '' }
      current = current ? `${current} ${word}` : word.slice(0, max)
    }
    if (current) parts.push(current)
    return parts
  })
}

/**
 * Splits a book into passages she reads one after another: whole sentences,
 * never across a paragraph or a file, and without page numbers or other lines
 * that have no words. PDF line breaks inside a paragraph and hyphenated words
 * are joined.
 */
export function plumaReadingChunks(sections: PlumaReadingSection[], max = maxPassage): string[] {
  const chunks: string[] = []
  for (const section of sections) {
    const text = section.text.replace(/\r\n?/g, '\n').replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
    for (const paragraph of text.split(/\n\s*\n/)) {
      const flat = paragraph.replace(/\s+/g, ' ').trim()
      if (!/\p{L}/u.test(flat)) continue
      let current = ''
      for (const piece of pieces(flat, max)) {
        if (current && current.length + 1 + piece.length > max) { chunks.push(current); current = '' }
        current = current ? `${current} ${piece}` : piece
      }
      if (current) chunks.push(current)
    }
  }
  return chunks
}

// One book at a time: its passages, so asking to continue does not read the file again.
let cached: { path: string; book: Promise<PlumaBook> } | undefined

export function loadPlumaBook(path: string, fresh = false): Promise<PlumaBook> {
  if (cached?.path === path && !fresh) return cached.book
  const book = invoke<{ title: string; sections: PlumaReadingSection[] }>('pluma_reading_open', { path })
    .then(({ title, sections }) => {
      const chunks = plumaReadingChunks(sections)
      if (!chunks.length) throw new Error('No encontré texto para leer en ese archivo.')
      return { title, chunks }
    })
  cached = { path, book }
  book.catch(() => { if (cached?.book === book) cached = undefined })
  return book
}

/** Resolves null when the person closes the dialog. */
export const choosePlumaReading = (folder: boolean) => invoke<string | null>('pluma_reading_choose', { folder })

/** How much of a document goes into one message: about 85,000 tokens, more than a local model's window usually holds. */
export const MAX_DOCUMENT_TEXT = 300_000

export type PlumaDocument = { title: string; text: string; cut: boolean }

/** A document or a folder of them as one text: each file under its name, cut at `MAX_DOCUMENT_TEXT`. */
export function documentText(title: string, sections: PlumaReadingSection[], max = MAX_DOCUMENT_TEXT): PlumaDocument {
  const parts = sections
    .map(section => ({ title: section.title.trim(), text: section.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }))
    .filter(section => /\p{L}/u.test(section.text))
  if (!parts.length) throw new Error(`No encontré texto en «${title}».`)
  const whole = parts.length === 1 ? parts[0].text : parts.map(part => `## ${part.title}\n\n${part.text}`).join('\n\n')
  return { title, text: whole.slice(0, max), cut: whole.length > max }
}

/** Reads a document or a folder with Pluma's reader (txt, md, pdf, docx, epub, html). */
export async function readPlumaDocument(path: string): Promise<PlumaDocument> {
  const { title, sections } = await invoke<{ title: string; sections: PlumaReadingSection[] }>('pluma_reading_open', { path: path.trim() })
  return documentText(title, sections)
}

/** The chat attachment for a document read whole: already processed and sent inside the message. */
export function plumaDocumentAttachment(path: string, document: PlumaDocument, folder: boolean): Attachment {
  const extension = folder ? 'carpeta' : path.split('.').pop()?.toLowerCase()
  return {
    name: document.title,
    type: 'document',
    path,
    fileType: extension,
    size: new TextEncoder().encode(document.text).length,
    parseMode: 'inline',
    processed: true,
    injectionMode: 'inline',
    inlineContent: document.text,
  }
}

/** Loads the book first, so a path that cannot be read never replaces the current one. */
export async function openPlumaBook(path: string) {
  const book = await loadPlumaBook(path.trim(), true)
  usePlumaReading.getState().open({ path: path.trim(), title: book.title, total: book.chunks.length })
  return book
}

export const plumaReader: PlumaReader = {
  current() {
    const { book, positions } = usePlumaReading.getState()
    return book ? { title: book.title, percent: readingPercent(positions[book.path] ?? 0, book.total) } : undefined
  },
  load() {
    const { book } = usePlumaReading.getState()
    return book ? loadPlumaBook(book.path) : Promise.reject(new Error('No hay ningún libro cargado en el modo lectura.'))
  },
  position() {
    const { book, positions } = usePlumaReading.getState()
    return book ? positions[book.path] ?? 0 : 0
  },
  save(position, total) {
    const state = usePlumaReading.getState()
    if (!state.book) return
    state.save(state.book.path, position)
    if (state.book.total !== total) state.open({ ...state.book, total })
  },
}
