import { Button } from '@/components/ui/button'
import type { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'

export function PlumaCloneReference({ controls, active }: {
  controls: ReturnType<typeof usePlumaCloneReference>
  active: boolean
}) {
  const { reference, busy, error, choose, clear } = controls
  return <div className="space-y-2 border-t pt-2" data-testid="pluma-clone-reference">
    <p className="text-sm font-medium">Muestra de voz</p>
    <p role="status" className="text-xs text-muted-foreground">
      {busy ? 'Comprobando muestra…' : reference?.ready ? `Muestra ${reference.format?.toUpperCase() ?? 'de voz'} guardada en este equipo.` : 'Selecciona un WAV o MP3 con una sola voz clara.'}
    </p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || active} onClick={() => void choose()}>
        {reference?.ready ? 'Cambiar muestra' : 'Elegir WAV o MP3'}
      </Button>
      {reference?.ready && <Button type="button" size="sm" variant="ghost" disabled={busy || active} onClick={() => void clear()}>Quitar muestra</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
