import { Button } from '@/components/ui/button'
import { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'
import { loreVoiceKey, loreVoiceGroups, type LoreVoice, type LoreVoiceGroups } from '@/lib/characters/lore'
import { voiceOwner } from '@/lib/characters/pluma-clone'
import type { CharacterProfile } from '@/lib/characters/types'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { PlumaVoiceRecorder } from './PlumaVoiceRecorder'

const handPicked = ''

/** What the list calls a voice folder. */
function groupLabel(group: string, groups: LoreVoiceGroups | undefined, singing: boolean) {
  if (!group) return `Sin carpeta (voces\\${singing ? 'cantar' : 'hablar'})`
  if (group.toLowerCase() === 'mujer' || group.toLowerCase() === 'hombre') return `Voces de ${group.toLowerCase()}`
  return `Voces de ${groups && group.toLowerCase() === groups.own.toLowerCase() ? groups.own : group}`
}

/** The voices in list order, one section per folder. */
function sections(voices: LoreVoice[]) {
  const byGroup = new Map<string, LoreVoice[]>()
  for (const voice of voices) byGroup.set(voice.group ?? '', [...(byGroup.get(voice.group ?? '') ?? []), voice])
  return [...byGroup]
}

/**
 * The speaking sample, or with `singing` the optional sample she sings with:
 * a voice from the assistant's Lore folders (its own and its gender's), one
 * recorded here (saved into its own folder), or a WAV or MP3 chosen by hand.
 */
export function PlumaCloneReference({ controls, active, singing = false }: {
  controls: ReturnType<typeof usePlumaCloneReference>
  active: boolean
  singing?: boolean
}) {
  const { reference, lore, groups, busy, error, choose, clear, pickLore, saveRecording, refreshLore, openLore } = controls
  const format = reference?.format?.toUpperCase()
  const voices = lore?.voices ?? []
  const selected = reference?.ready && reference.name ? lore?.selected ?? handPicked : handPicked
  const status = busy ? 'Comprobando muestra…'
    : reference?.ready && reference.name ? `${singing ? 'Canta' : 'Habla'} con la voz «${reference.name}» de Lore.`
      : singing
        ? reference?.ready ? `Muestra ${format ?? 'de canto'} de canto guardada. Canta con este timbre.` : 'Opcional: un WAV o MP3 de esa voz cantando. Sin ella, canta con la muestra de voz.'
        : reference?.ready ? `Muestra ${format ?? 'de voz'} guardada en este equipo.` : 'Selecciona un WAV o MP3 con una sola voz clara.'
  const kind = singing ? 'cantar' : 'hablar'
  const folder = groups ? `Lore\\voces\\${groups.own}\\${kind} y Lore\\voces\\${groups.gender}\\${kind}` : `Lore\\voces\\${kind}`
  return <div className="space-y-2 border-t pt-2" data-testid={singing ? 'pluma-song-reference' : 'pluma-clone-reference'}>
    <p className="text-sm font-medium">{singing ? 'Voz de canto' : 'Voz para hablar'}</p>
    {lore?.root && <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      Voces en {folder}
      <select
        data-testid={singing ? 'lore-song-voice' : 'lore-voice'}
        value={selected}
        disabled={busy || !voices.length}
        className="w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed"
        onChange={event => {
          const voice = voices.find(item => loreVoiceKey(item) === event.target.value)
          if (voice) void pickLore(voice)
        }}
      >
        <option value={handPicked} disabled={!reference?.ready}>{voices.length ? reference?.ready ? 'Muestra elegida a mano' : 'Elige una voz…' : 'No hay voces todavía'}</option>
        {sections(voices).map(([group, items]) => <optgroup key={group || '-'} label={groupLabel(group, groups, singing)}>
          {items.map(voice => <option key={loreVoiceKey(voice)} value={loreVoiceKey(voice)}>{voice.name}</option>)}
        </optgroup>)}
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
    {lore?.root && <PlumaVoiceRecorder singing={singing} disabled={busy} onSave={saveRecording} beforeRecording={active ? () => useAvatarVoiceSession.getState().pause() : undefined} />}
    {lore?.root && groups && <p className="text-xs text-muted-foreground">Lo que grabes se guarda en Lore\voces\{groups.own}\{kind}.</p>}
    {active && !singing && <p className="text-xs text-muted-foreground">Puedes cambiar de voz sin colgar: la usa desde su próxima frase. Al grabar tu voz, la llamada se pausa.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}

/**
 * The assistant's samples as its voice settings show them: the speaking one,
 * and for Pluma (who sings) the singing one too. Each assistant keeps its own.
 */
export function PlumaCloneSamples({ profile }: { profile: Pick<CharacterProfile, 'id' | 'name' | 'baseId' | 'voice'> }) {
  const active = useAvatarVoiceSession(state => state.active)
  const groups = loreVoiceGroups(profile)
  const owner = voiceOwner(profile)
  const speaking = usePlumaCloneReference(true, false, groups, owner)
  const singing = usePlumaCloneReference(!owner, true, groups, owner)
  return <div data-testid="pluma-clone-samples" className="space-y-2">
    <PlumaCloneReference controls={speaking} active={active && !owner} />
    {!owner && <PlumaCloneReference controls={singing} active={active} singing />}
  </div>
}
