import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useDebateStage, type DebateStageAgent } from '@/stores/useDebateStage'
import type { DebatePortrait } from '@/lib/characters/pluma-debate'
import { HologramAvatar, HOLOGRAM_PORTRAITS, HOLOGRAM_STAGE_ID, HOLOGRAM_THREAD_STAGE_ID, type HologramPortrait } from './HologramAvatar'

const PORTRAITS: Record<Exclude<DebatePortrait, 'ninguna'>, HologramPortrait | undefined> = {
  pluma: HOLOGRAM_PORTRAITS.literatura,
  blaster: HOLOGRAM_PORTRAITS.kairo,
  coder: HOLOGRAM_PORTRAITS.coder,
}

/** The speaker's loudness, read from the player every frame. */
function useLevel(active: boolean) {
  const read = useDebateStage(state => state.level)
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!active) { setLevel(0); return }
    let frame = 0
    let last = 0
    const tick = (time: number) => {
      // About 30 updates a second is enough for the lips.
      if (time - last > 33) { last = time; setLevel(read()) }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, read])
  return level
}

function AgentCard({ agent, speaking, level, size, onToggle }: { agent: DebateStageAgent; speaking: boolean; level: number; size: 'stage' | 'corner'; onToggle: () => void }) {
  const portrait = agent.portrait === 'ninguna' ? undefined : PORTRAITS[agent.portrait]
  const label = `Holograma de ${agent.name}${speaking ? ' · hablando' : ''}`
  if (portrait) {
    return <HologramAvatar portrait={portrait} state={speaking ? 'speaking' : 'idle'} level={speaking ? level : 0} color={speaking ? '#5CE1E6' : '#3A8C99'} label={label} size={size} onToggleSize={onToggle} toggleHint={size === 'stage' ? 'hacerlo pequeño' : 'agrandarlo'} />
  }
  // Without a face: a plain card whose ring follows the voice.
  return <div role="button" tabIndex={0} aria-label={`${label}. Doble clic para ${size === 'stage' ? 'hacerlo pequeño' : 'agrandarlo'}.`} onDoubleClick={onToggle} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}
    className={cn('flex items-center justify-center rounded-2xl border border-cyan-400/20 bg-[#040810] text-cyan-100 shadow-[0_0_40px_rgba(92,225,230,0.18)]', size === 'stage' ? 'size-full' : 'h-[150px] w-[150px]')}>
    <span className="flex size-20 items-center justify-center rounded-full border-2 border-cyan-300/60 text-2xl font-semibold" style={{ boxShadow: `0 0 ${8 + level * 40}px rgba(92,225,230,${0.25 + level * 0.6})` }}>{agent.name.slice(0, 1).toUpperCase()}</span>
  </div>
}

/**
 * While a debate plays: a small hologram per agent at the top right, the one
 * speaking lit and named. Double click makes a card large, in the chat's
 * messages area or the home stage, and again makes it small.
 */
export function DebateHologramDock() {
  const agents = useDebateStage(state => state.agents)
  const speaking = useDebateStage(state => state.speaking)
  const large = useDebateStage(state => state.large)
  const toggleLarge = useDebateStage(state => state.toggleLarge)
  const level = useLevel(agents.length > 0)
  const [area, setArea] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!agents.length) return
    setArea(document.getElementById(HOLOGRAM_THREAD_STAGE_ID) ?? document.getElementById(HOLOGRAM_STAGE_ID))
  }, [agents.length])
  if (!agents.length) return null
  const shown = large !== null && agents[large] && area ? large : null
  return <>
    <aside data-testid="debate-hologram-dock" aria-label="Debate" className="fixed right-4 top-16 z-40 flex max-w-[calc(100vw-2rem)] flex-row-reverse flex-wrap items-start gap-2">
      {agents.map((agent, index) => index === shown ? null : <figure key={index} data-testid={`debate-hologram-${index}`} data-speaking={speaking === index} className={cn('m-0 flex flex-col items-center gap-1 transition-opacity', speaking !== null && speaking !== index && 'opacity-60')}>
        <AgentCard agent={agent} speaking={speaking === index} level={level} size="corner" onToggle={() => toggleLarge(index)} />
        <figcaption className={cn('rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium', speaking === index && 'text-primary')}>{agent.name}</figcaption>
      </figure>)}
    </aside>
    {shown !== null && area && createPortal(<div data-testid="debate-hologram-large" className="pointer-events-auto absolute inset-x-3 inset-y-2 z-10 flex items-center justify-center overflow-hidden rounded-2xl bg-[#040810] sm:inset-x-6">
      <AgentCard agent={agents[shown]} speaking={speaking === shown} level={level} size="stage" onToggle={() => toggleLarge(shown)} />
      <p role="status" className="pointer-events-none absolute inset-x-4 bottom-3 text-center text-sm font-medium text-cyan-100/80">{agents[shown].name}{speaking === shown ? ' · hablando' : speaking !== null ? ` · habla ${agents[speaking]?.name ?? ''}` : ''}</p>
    </div>, area)}
  </>
}
