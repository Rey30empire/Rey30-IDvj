import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { clonedVoices, useCharacterAudio } from '@/lib/characters/audio'
import { debateAgents, parseDebate, usePlumaDebate } from '@/lib/characters/pluma-debate'
import { loadDebateVoices, playDebate, type DebatePlayback } from '@/lib/characters/pluma-debate-player'

const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo leer el debate.'

type PlayerState = { phase: 'idle' | 'preparing' | 'playing'; current?: number; error?: string }

/**
 * Under an answer that is a debate script: reads it aloud with each
 * participant's voice and tone, and says who is speaking.
 */
export function PlumaDebatePlayer({ text }: { text: string }) {
  const count = usePlumaDebate(state => state.count)
  const stored = usePlumaDebate(state => state.agents)
  const agents = useMemo(() => debateAgents({ count, agents: stored }), [count, stored])
  const lines = useMemo(() => parseDebate(text, agents), [text, agents])
  const [state, setState] = useState<PlayerState>({ phase: 'idle' })
  const playback = useRef<DebatePlayback | undefined>(undefined)
  useEffect(() => () => playback.current?.stop(), [])
  if (!lines || !clonedVoices()) return null

  const stop = () => {
    playback.current?.stop()
    playback.current = undefined
    setState({ phase: 'idle' })
  }
  const start = async () => {
    useCharacterAudio.getState().stop()
    setState({ phase: 'preparing' })
    try {
      const voices = await loadDebateVoices(agents)
      const run = playDebate(lines, agents, voices, index => setState({ phase: 'playing', current: index }))
      playback.current = run
      await run.done
      if (playback.current === run) setState({ phase: 'idle' })
    } catch (cause) {
      if (playback.current) playback.current.stop()
      playback.current = undefined
      setState({ phase: 'idle', error: message(cause) })
    }
  }
  const speakers = [...new Set(lines.map(line => line.name))].join(', ')
  const current = state.current !== undefined ? lines[state.current] : undefined
  return <div data-testid="pluma-debate-player" className="mt-3 space-y-1 rounded-md border px-3 py-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">Debate · {lines.length} intervenciones · {speakers}</span>
      {state.phase === 'idle'
        ? <Button type="button" size="sm" variant="outline" onClick={() => void start()}>Escuchar debate</Button>
        : <Button type="button" size="sm" variant="outline" onClick={stop}>Detener</Button>}
    </div>
    <p role="status" className="text-xs text-muted-foreground">
      {state.phase === 'preparing' ? 'Preparando las voces… la primera vez tarda unos segundos.' : state.phase === 'playing' && current ? `Habla ${current.name} (${(state.current ?? 0) + 1} de ${lines.length}).` : ''}
    </p>
    {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
  </div>
}
