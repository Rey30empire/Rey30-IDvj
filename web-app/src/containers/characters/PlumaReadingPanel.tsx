import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { choosePlumaReading, openPlumaBook, readingPercent, type PlumaReadingProgress } from '@/lib/characters/pluma-reading'
import { usePlumaReading } from '@/stores/usePlumaReading'

const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo abrir ese libro.'

/** Reading mode: load a book, text, PDF, Word, EPUB or folder, and have Pluma read it in order. */
export function PlumaReadingPanel({ reading, onRead, onStop }: {
  /** The book while she reads it aloud. */
  reading?: PlumaReadingProgress
  onRead: (fromStart: boolean) => void
  onStop: () => void
}) {
  const book = usePlumaReading(state => state.book)
  const position = usePlumaReading(state => state.book ? state.positions[state.book.path] ?? 0 : 0)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const open = async (target: Promise<string | null> | string) => {
    setBusy(true)
    setError(undefined)
    try {
      const chosen = await target
      if (chosen?.trim()) { await openPlumaBook(chosen); setPath('') }
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (path.trim()) void open(path) }
  const percent = reading?.percent ?? (book ? readingPercent(position, book.total) : 0)
  const finished = !!book && position >= book.total

  return <div className="space-y-2 border-t pt-2" data-testid="pluma-reading">
    <p className="text-sm font-medium">Modo lectura</p>
    <p role="status" className="text-xs text-muted-foreground">
      {busy ? 'Abriendo…' : book ? `«${book.title}» · ${percent} %${reading ? ' · leyendo' : finished ? ' · terminado' : ''}` : 'Carga un libro, texto, PDF, Word, EPUB o una carpeta, y pídele «léemelo».'}
    </p>
    {book && <div className="flex flex-wrap gap-2">
      {reading
        ? <Button type="button" size="sm" variant="outline" onClick={onStop}>Detener lectura</Button>
        : <>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onRead(finished)}>{position > 0 && !finished ? 'Seguir leyendo' : 'Leer'}</Button>
          {position > 0 && !finished && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRead(true)}>Desde el inicio</Button>}
        </>}
      <Button type="button" size="sm" variant="ghost" disabled={busy || !!reading} onClick={() => usePlumaReading.getState().clear()}>Quitar libro</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || !!reading} onClick={() => void open(choosePlumaReading(false))}>Elegir archivo</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !!reading} onClick={() => void open(choosePlumaReading(true))}>Elegir carpeta</Button>
    </div>
    <form className="flex gap-2" onSubmit={submit}>
      <input aria-label="Ruta del libro o carpeta" value={path} disabled={busy || !!reading} onChange={event => setPath(event.target.value)} placeholder="o pega una ruta" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !!reading || !path.trim()}>Abrir</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
