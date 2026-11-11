import { Button } from '@/components/ui/button'
import type { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'

/** The speaking sample, or with `singing` the optional sample she sings with. */
export function PlumaCloneReference({ controls, active, singing = false }: {
  controls: ReturnType<typeof usePlumaCloneReference>
  active: boolean
  singing?: boolean
}) {
  const { reference, busy, error, choose, clear } = controls
  const format = reference?.format?.toUpperCase()
  const status = busy ? 'Comprobando muestra…'
    : singing
      ? reference?.ready ? `Muestra ${format ?? 'de canto'} de canto guardada. Canta con este timbre.` : 'Opcional: un WAV o MP3 de esa voz cantando. Sin ella, canta con la muestra de voz.'
      : reference?.ready ? `Muestra ${format ?? 'de voz'} guardada en este equipo.` : 'Selecciona un WAV o MP3 con una sola voz clara.'
  return <div className="space-y-2 border-t pt-2" data-testid={singing ? 'pluma-song-reference' : 'pluma-clone-reference'}>
    <p className="text-sm font-medium">{singing ? 'Muestra de canto' : 'Muestra de voz'}</p>
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || active} onClick={() => void choose()}>
        {reference?.ready ? 'Cambiar muestra' : 'Elegir WAV o MP3'}
      </Button>
      {reference?.ready && <Button type="button" size="sm" variant="ghost" disabled={busy || active} onClick={() => void clear()}>Quitar muestra</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
