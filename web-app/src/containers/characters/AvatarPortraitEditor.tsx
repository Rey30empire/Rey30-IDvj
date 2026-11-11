import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { avatarImageData, chooseAvatarImage, deleteAvatarImage, portraitProblem } from '@/lib/characters/avatar-image'
import type { AvatarPoint, CustomPortrait } from '@/lib/characters/types'

const steps = [
  'Toca el ojo que queda a la izquierda en la foto.',
  'Ahora el ojo de la derecha.',
  'Ahora el centro de la boca, entre los labios.',
]
const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo abrir la imagen.'

/**
 * The hologram's picture: the character's own or one the person chooses. The
 * hologram moves the eyes and lips, so a new picture needs where they are:
 * three taps on the picture.
 */
export function AvatarPortraitEditor({ value, builtInSrc, onChange }: {
  value?: CustomPortrait
  /** The character's own picture, if it has one. */
  builtInSrc?: string
  onChange: (portrait?: CustomPortrait) => void
}) {
  const [current, setCurrent] = useState<string>()
  const [marking, setMarking] = useState<{ file: string; src: string }>()
  const [marks, setMarks] = useState<AvatarPoint[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const image = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let live = true
    setCurrent(undefined)
    if (value) avatarImageData(value.file).then(src => { if (live) setCurrent(src) }, () => undefined)
    return () => { live = false }
  }, [value])

  const choose = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const file = await chooseAvatarImage()
      if (!file) return
      setMarking({ file, src: await avatarImageData(file) })
      setMarks([])
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  const mark = (event: MouseEvent<HTMLImageElement>) => {
    const target = image.current
    if (!target || marks.length >= 3) return
    const box = target.getBoundingClientRect()
    if (!box.width || !box.height) return
    const x = Math.round((event.clientX - box.left) * target.naturalWidth / box.width)
    const y = Math.round((event.clientY - box.top) * target.naturalHeight / box.height)
    setMarks([...marks, [x, y]])
  }
  const cancel = () => {
    if (marking) void deleteAvatarImage(marking.file)
    setMarking(undefined)
    setMarks([])
  }
  const problem = marks.length === 3 ? portraitProblem(marks) : undefined
  const accept = () => {
    if (!marking || marks.length !== 3 || problem) return
    onChange({ file: marking.file, leftEye: marks[0], rightEye: marks[1], mouth: marks[2] })
    setMarking(undefined)
    setMarks([])
  }

  if (marking) {
    const width = image.current?.naturalWidth || 1
    const height = image.current?.naturalHeight || 1
    return <div data-testid="avatar-portrait-marking" className="space-y-2 rounded-md border px-3 py-2">
      <p className="text-sm font-medium">Imagen del holograma</p>
      <p role="status" className="text-sm">{marks.length < 3 ? steps[marks.length] : problem ?? 'Listo. Usa esta imagen o vuelve a marcar.'}</p>
      <div className="relative inline-block max-w-full">
        <img ref={image} src={marking.src} alt="Imagen elegida para el holograma" onClick={mark} className="block max-h-72 max-w-full cursor-crosshair rounded-md" />
        {marks.map(([x, y], index) => <span key={index} aria-hidden="true" className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow" style={{ left: `${x / width * 100}%`, top: `${y / height * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={marks.length !== 3 || !!problem} onClick={accept}>Usar esta imagen</Button>
        <Button type="button" size="sm" variant="outline" disabled={!marks.length} onClick={() => setMarks([])}>Volver a marcar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancelar</Button>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    </div>
  }

  const shown = value ? current : builtInSrc
  return <div data-testid="avatar-portrait" className="space-y-2 rounded-md border px-3 py-2">
    <p className="text-sm font-medium">Imagen del holograma</p>
    <div className="flex items-center gap-3">
      {shown ? <img src={shown} alt="Imagen actual del holograma" className="size-16 rounded-md object-cover" /> : <span className="flex size-16 items-center justify-center rounded-md border text-xs text-muted-foreground">Sin imagen</span>}
      <p className="text-xs text-muted-foreground">{value ? 'Imagen elegida por ti.' : builtInSrc ? 'Imagen original del asistente.' : 'Este asistente se muestra como esfera. Con una imagen aparece como holograma.'} PNG, JPG o WebP de una cara de frente.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void choose()}>{busy ? 'Abriendo…' : 'Cambiar imagen'}</Button>
      {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(undefined)}>{builtInSrc ? 'Volver a la original' : 'Quitar imagen'}</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
