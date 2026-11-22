import { Button } from '@/components/ui/button'
import type { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'

const handPicked = ''

/**
 * The speaking sample, or with `singing` the optional sample she sings with:
 * a voice from the project's Lore folder, or a WAV or MP3 chosen by hand.
 */
export function PlumaCloneReference({ controls, active, singing = false }: {
  controls: ReturnType<typeof usePlumaCloneReference>
  active: boolean
  singing?: boolean
}) {
  const { reference, lore, busy, error, choose, clear, pickLore, refreshLore, openLore } = controls
  const format = reference?.format?.toUpperCase()
  const voices = lore?.voices ?? []
  const selected = reference?.ready && reference.name ? lore?.selected ?? handPicked : handPicked
  const status = busy ? 'Comprobando muestra…'
    : reference?.ready && reference.name ? `${singing ? 'Canta' : 'Habla'} con la voz «${reference.name}» de Lore.`
      : singing
        ? reference?.ready ? `Muestra ${format ?? 'de canto'} de canto guardada. Canta con este timbre.` : 'Opcional: un WAV o MP3 de esa voz cantando. Sin ella, canta con la muestra de voz.'
        : reference?.ready ? `Muestra ${format ?? 'de voz'} guardada en este equipo.` : 'Selecciona un WAV o MP3 con una sola voz clara.'
  const folder = singing ? 'Lore\\voces\\cantar' : 'Lore\\voces\\hablar'
  return <div className="space-y-2 border-t pt-2" data-testid={singing ? 'pluma-song-reference' : 'pluma-clone-reference'}>
    <p className="text-sm font-medium">{singing ? 'Voz de canto' : 'Voz para hablar'}</p>
    {lore?.root && <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      Voces en {folder}
      <select
        data-testid={singing ? 'lore-song-voice' : 'lore-voice'}
        value={selected}
        disabled={busy || !voices.length}
        className="w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed"
        onChange={event => { if (event.target.value) void pickLore(event.target.value) }}
      >
        <option value={handPicked} disabled={!reference?.ready}>{voices.length ? reference?.ready ? 'Muestra elegida a mano' : 'Elige una voz…' : 'No hay voces todavía'}</option>
        {voices.map(voice => <option key={voice.file} value={voice.file}>{voice.name}</option>)}
      </select>
    </label>}
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void choose()}>
        {reference?.ready ? 'Otro archivo…' : 'Elegir WAV o MP3'}
      </Button>
      {reference?.ready && <Button type="button" size="sm" variant="ghost" disabled={busy || active} onClick={() => void clear()}>Quitar</Button>}
      {lore?.root && <>
        <Button type="button" size="sm" variant="ghost" onClick={() => void openLore()}>Abrir carpeta</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void refreshLore()}>Actualizar</Button>
      </>}
    </div>
    {active && !singing && <p className="text-xs text-muted-foreground">Puedes cambiar de voz sin colgar: la usa desde su próxima frase.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
