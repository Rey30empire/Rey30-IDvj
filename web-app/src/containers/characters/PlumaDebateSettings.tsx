import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { loreVoiceKey, loreVoices, type LoreVoice } from '@/lib/characters/lore'
import {
  assignDebateVoices, DEBATE_LENGTH_LABELS, DEBATE_PORTRAIT_LABELS, debateAgents, MAX_AGENT_LIST, MAX_DEBATE_AGENTS, usePlumaDebate,
  type DebateAgent, type DebateGender, type DebateLength, type DebatePortrait,
} from '@/lib/characters/pluma-debate'
import { PLUMA_EMOTIONS, type PlumaEmotion } from '@/lib/characters/pluma-voice-style'

const field = 'w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'
const area = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'

/** Every voice in Lore, by folder, for the agents to speak with. */
function useLoreVoices(open = true) {
  const [voices, setVoices] = useState<LoreVoice[]>([])
  useEffect(() => {
    if (!open) return
    let current = true
    void (async () => {
      try {
        const list = await loreVoices(false)
        if (current) setVoices(Array.isArray(list?.voices) ? list.voices : [])
      } catch {
        if (current) setVoices([])
      }
    })()
    return () => { current = false }
  }, [open])
  return voices
}

const voiceValue = (voice: DebateAgent['voice']) => voice === 'auto' || voice === 'pluma' ? voice : loreVoiceKey(voice)

function AgentEditor({ agent, voices, onRemove }: { agent: DebateAgent; voices: LoreVoice[]; onRemove?: () => void }) {
  const setAgent = usePlumaDebate(state => state.setAgent)
  const set = (next: Partial<DebateAgent>) => setAgent(agent.id, next)
  const groups = [...new Set(voices.map(voice => voice.group ?? ''))]
  const value = voiceValue(agent.voice)
  return <div className="grid gap-2 pt-2 sm:grid-cols-2">
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Nombre
      <Input aria-label={`Nombre de ${agent.name}`} value={agent.name} maxLength={40} onChange={event => set({ name: event.target.value })} />
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Género
      <select aria-label={`Género de ${agent.name}`} className={field} value={agent.gender} onChange={event => set({ gender: event.target.value as DebateGender })}>
        <option value="mujer">Mujer</option>
        <option value="hombre">Hombre</option>
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">Papel en el debate
      <textarea aria-label={`Papel de ${agent.name}`} className={area} rows={2} maxLength={300} value={agent.role} placeholder="Vacío: se le da uno según su puesto" onChange={event => set({ role: event.target.value })} />
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">Personalidad
      <textarea aria-label={`Personalidad de ${agent.name}`} className={area} rows={2} maxLength={300} value={agent.personality} onChange={event => set({ personality: event.target.value })} />
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Tono
      <select aria-label={`Tono de ${agent.name}`} className={field} value={agent.tone} onChange={event => set({ tone: event.target.value as PlumaEmotion })}>
        {Object.entries(PLUMA_EMOTIONS).map(([id, emotion]) => <option key={id} value={id}>{emotion.label}</option>)}
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Voz
      <select aria-label={`Voz de ${agent.name}`} className={field} value={value} onChange={event => {
        const chosen = event.target.value
        if (chosen === 'auto' || chosen === 'pluma') { set({ voice: chosen }); return }
        const voice = voices.find(item => loreVoiceKey(item) === chosen)
        if (voice) set({ voice: { group: voice.group ?? '', file: voice.file } })
      }}>
        <option value="auto">Automática ({agent.gender === 'mujer' ? 'de mujer' : 'de hombre'})</option>
        <option value="pluma">Voz de Pluma</option>
        {typeof agent.voice === 'object' && !voices.some(item => loreVoiceKey(item) === value) && <option value={value}>{agent.voice.file} (no está en Lore)</option>}
        {groups.map(group => <optgroup key={group || '-'} label={group ? `Voces de ${group}` : 'Sin carpeta'}>
          {voices.filter(item => (item.group ?? '') === group).map(item => <option key={loreVoiceKey(item)} value={loreVoiceKey(item)}>{item.name}</option>)}
        </optgroup>)}
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Holograma
      <select aria-label={`Holograma de ${agent.name}`} className={field} value={agent.portrait} onChange={event => set({ portrait: event.target.value as DebatePortrait })}>
        {Object.entries(DEBATE_PORTRAIT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    {onRemove && <div className="flex items-end justify-end">
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 className="size-3.5" aria-hidden="true" />Quitar de la lista</Button>
    </div>}
  </div>
}

/** The agent list: who takes part (up to four) and how each one is. */
export function DebateAgentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const debate = usePlumaDebate()
  const voices = useLoreVoices(open)
  const [full, setFull] = useState(false)
  const cast = useMemo(() => debateAgents(debate), [debate])
  const { shared } = useMemo(() => assignDebateVoices(cast, voices), [cast, voices])
  const active = debate.agents.filter(agent => agent.active).length
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="debate-agents-dialog" className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl">
      <DialogHeader className="shrink-0">
        <DialogTitle>Agentes del debate</DialogTitle>
        <DialogDescription>Activa hasta {MAX_DEBATE_AGENTS}. Si no activas ninguno, debaten Pluma y el primer hombre de la lista. Cada uno habla con una voz de su género; ábrelo para cambiar su nombre, papel, personalidad, tono, voz u holograma.</DialogDescription>
      </DialogHeader>
      <p role="status" className="shrink-0 text-xs text-muted-foreground">
        Debaten: {cast.map(agent => agent.name).join(', ')}{active === 0 ? ' (por defecto)' : ''}.
        {shared.length > 0 && <span className="text-amber-600 dark:text-amber-400"> Faltan voces en Lore: {shared.join(', ')} comparte{shared.length > 1 ? 'n' : ''} voz. Añade grabaciones en Lore › voces › mujer u hombre.</span>}
      </p>
      {full && <p role="alert" className="shrink-0 text-xs text-destructive">Ya hay {MAX_DEBATE_AGENTS} agentes activos: desactiva uno antes de activar otro.</p>}
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {debate.agents.map(agent => <li key={agent.id} data-testid={`debate-agent-${agent.id}`} className="rounded-md border px-2 py-1.5">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <input type="checkbox" aria-label={`${agent.name} participa`} checked={agent.active} onClick={event => event.stopPropagation()} onChange={event => setFull(!debate.toggleAgent(agent.id, event.target.checked))} />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium">{agent.name || 'Sin nombre'}</span>
                <span className="ml-2 text-xs text-muted-foreground">{agent.gender === 'mujer' ? 'Mujer' : 'Hombre'}</span>
                <span className="block truncate text-xs text-muted-foreground">{agent.role || 'Papel automático'}</span>
              </span>
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </summary>
            <AgentEditor agent={agent} voices={voices} onRemove={debate.agents.length > 1 ? () => debate.removeAgent(agent.id) : undefined} />
          </details>
        </li>)}
      </ul>
      <DialogFooter className="shrink-0 flex-wrap gap-2 sm:justify-between">
        <Button type="button" size="sm" variant="ghost" onClick={() => debate.reset()}>Volver a los agentes predeterminados</Button>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={debate.agents.length >= MAX_AGENT_LIST} onClick={() => debate.addAgent()}><Plus className="size-3.5" aria-hidden="true" />Añadir agente</Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Listo</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

/**
 * Pluma's document debate in her editor: on or off, how long it runs, and
 * who takes part (the pencil opens the agent list).
 */
export function PlumaDebateSettings() {
  const debate = usePlumaDebate()
  const [editing, setEditing] = useState(false)
  const cast = debateAgents(debate)
  const active = debate.agents.some(agent => agent.active)
  return <section data-testid="pluma-debate-settings" className="space-y-3 rounded-md border p-3">
    <div>
      <p className="text-sm font-medium">Debate de documentos</p>
      <p className="text-xs text-muted-foreground">Adjunta un documento o una carpeta con «+» en el chat de Pluma y escribe «/debate»: sus agentes lo comentan como en un pódcast. El debate se escucha con la voz de cada uno y se guarda en Lore › debates, completo y por voces.</p>
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={debate.enabled} onChange={event => debate.set({ enabled: event.target.checked })} />
      <span>Modo debate<span className="block text-xs text-muted-foreground">Mientras está activado, Pluma solo hace debates: cada mensaje suyo se convierte en uno, sin escribir «/debate».</span></span>
    </label>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Duración
      <select aria-label="Duración del debate" className={field} value={debate.length} onChange={event => debate.set({ length: event.target.value as DebateLength })}>
        {Object.entries(DEBATE_LENGTH_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <div className="flex items-start justify-between gap-2 rounded-md border p-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">Agentes</p>
        <p data-testid="debate-cast" className="text-xs text-muted-foreground">{cast.map(agent => agent.name).join(', ')}{active ? '' : ' (por defecto)'} · {debate.agents.length} en la lista</p>
      </div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Editar agentes" title="Editar agentes" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden="true" /></Button>
    </div>
    <DebateAgentsDialog open={editing} onOpenChange={setEditing} />
  </section>
}
