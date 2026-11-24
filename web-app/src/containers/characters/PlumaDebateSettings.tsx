import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loreVoiceKey, loreVoices, type LoreVoice } from '@/lib/characters/lore'
import { AUTO_ROLES, DEBATE_LENGTH_LABELS, MAX_DEBATE_AGENTS, usePlumaDebate, type DebateLength } from '@/lib/characters/pluma-debate'
import { PLUMA_EMOTIONS, type PlumaEmotion } from '@/lib/characters/pluma-voice-style'

const field = 'w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'

/** Every voice in Lore, by folder, for the participants to speak with. */
function useLoreVoices() {
  const [voices, setVoices] = useState<LoreVoice[]>([])
  useEffect(() => {
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
  }, [])
  return voices
}

/**
 * Pluma's document debate: on or off, how many take part, how long it runs,
 * and each participant's name, role, tone and voice. An empty role is filled
 * in automatically.
 */
export function PlumaDebateSettings() {
  const debate = usePlumaDebate()
  const voices = useLoreVoices()
  const groups = [...new Set(voices.map(voice => voice.group ?? ''))]
  return <section data-testid="pluma-debate-settings" className="space-y-3 rounded-md border p-3">
    <div>
      <p className="text-sm font-medium">Debate de documentos</p>
      <p className="text-xs text-muted-foreground">Comparte un documento con Pluma y escribe «/debate» al principio del mensaje: sus participantes lo comentan como en un pódcast, y puedes escucharlo con la voz de cada uno.</p>
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={debate.enabled} onChange={event => debate.set({ enabled: event.target.checked })} />
      <span>Modo debate<span className="block text-xs text-muted-foreground">Mientras está activado, Pluma solo hace debates: cada mensaje suyo se convierte en uno, sin escribir «/debate».</span></span>
    </label>
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Participantes
        <select aria-label="Participantes del debate" className={field} value={debate.count} onChange={event => debate.set({ count: Number(event.target.value) })}>
          {Array.from({ length: MAX_DEBATE_AGENTS }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Duración
        <select aria-label="Duración del debate" className={field} value={debate.length} onChange={event => debate.set({ length: event.target.value as DebateLength })}>
          {Object.entries(DEBATE_LENGTH_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
    </div>
    {debate.agents.slice(0, debate.count).map((agent, index) => {
      const number = index + 1
      const voice = agent.voice ? loreVoiceKey(agent.voice) : ''
      return <fieldset key={index} data-testid={`debate-agent-${number}`} className="space-y-1.5 rounded-md border p-2">
        <legend className="px-1 text-xs font-medium">Participante {number}</legend>
        <Input aria-label={`Nombre del participante ${number}`} value={agent.name} maxLength={40} onChange={event => debate.setAgent(index, { name: event.target.value })} />
        <Input aria-label={`Papel del participante ${number}`} value={agent.role} maxLength={300} placeholder={`Automático: ${AUTO_ROLES[debate.count - 1][index]}`} onChange={event => debate.setAgent(index, { role: event.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select aria-label={`Tono del participante ${number}`} className={field} value={agent.tone} onChange={event => debate.setAgent(index, { tone: event.target.value as PlumaEmotion })}>
            {Object.entries(PLUMA_EMOTIONS).map(([id, emotion]) => <option key={id} value={id}>{emotion.label}</option>)}
          </select>
          <select aria-label={`Voz del participante ${number}`} className={field} value={voice} onChange={event => {
            const chosen = voices.find(item => loreVoiceKey(item) === event.target.value)
            debate.setAgent(index, { voice: chosen ? { group: chosen.group ?? '', file: chosen.file } : null })
          }}>
            <option value="">Voz de Pluma</option>
            {agent.voice && !voices.some(item => loreVoiceKey(item) === voice) && <option value={voice}>{agent.voice.file} (no está en Lore)</option>}
            {groups.map(group => <optgroup key={group || '-'} label={group ? `Voces de ${group}` : 'Sin carpeta'}>
              {voices.filter(item => (item.group ?? '') === group).map(item => <option key={loreVoiceKey(item)} value={loreVoiceKey(item)}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </div>
      </fieldset>
    })}
    <p className="text-xs text-muted-foreground">Con la voz expresiva (VoxCPM2), el tono de cada participante también se oye. Deja el papel vacío y se asigna solo.</p>
    <Button type="button" size="sm" variant="ghost" onClick={() => debate.reset()}>Volver a lo predeterminado</Button>
  </section>
}
