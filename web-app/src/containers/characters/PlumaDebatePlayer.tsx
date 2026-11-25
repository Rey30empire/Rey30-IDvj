import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FolderOpen, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { clonedVoices, useCharacterAudio } from '@/lib/characters/audio'
import { loreVoices } from '@/lib/characters/lore'
import { assignDebateVoices, debateScript, usePlumaDebate } from '@/lib/characters/pluma-debate'
import { loadDebateVoices, playDebate, playTrack, speakerAt } from '@/lib/characters/pluma-debate-player'
import { exportDebate, FULL_TRACK, openDebateFolder, readDebateTrack, saveDebate, savedDebate, SCRIPT_FILE, type SavedDebateInfo } from '@/lib/characters/pluma-debate-files'
import { useDebateStage } from '@/stores/useDebateStage'

const message = (cause: unknown) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo leer el debate.'

type Phase = 'idle' | 'preparing' | 'playing' | 'saving'
type PlayerState = { phase: Phase; current?: string; note?: string; error?: string }
type Running = { stop: () => void }

/**
 * Under an answer that is a debate script. The first time it is heard, each
 * line is generated with its agent's voice and tone while the earlier ones
 * play, and the whole debate is recorded and saved in Lore (all together, each
 * voice apart, and the script). Later it plays from there: everything, or one
 * voice alone. While it plays, each agent has a small hologram at the top
 * right.
 */
export function PlumaDebatePlayer({ text }: { text: string }) {
  const agents = usePlumaDebate(state => state.agents)
  const script = useMemo(() => debateScript(text, { agents }), [text, agents])
  const [state, setState] = useState<PlayerState>({ phase: 'idle' })
  const [saved, setSaved] = useState<SavedDebateInfo>()
  const running = useRef<Running | undefined>(undefined)
  useEffect(() => () => running.current?.stop(), [])
  useEffect(() => {
    let current = true
    void savedDebate(text).then(info => { if (current) setSaved(info) })
    return () => { current = false }
  }, [text])
  if (!script || !clonedVoices()) return null
  const { cast, lines } = script

  const stop = () => {
    running.current?.stop()
    running.current = undefined
    setState({ phase: 'idle' })
  }
  /** Shows the cards and keeps them until `run` ends or is stopped. */
  const onStage = (people: { name: string; portrait: SavedDebateInfo['agents'][number]['portrait'] }[], level: () => number) => {
    const owner = Symbol('debate')
    useDebateStage.getState().show(owner, people, level)
    return owner
  }
  const generate = async () => {
    useCharacterAudio.getState().stop()
    setState({ phase: 'preparing' })
    let owner: symbol | undefined
    try {
      const lore = await loreVoices(false).then(list => Array.isArray(list?.voices) ? list.voices : []).catch(() => [])
      const { voices, shared } = assignDebateVoices(cast, lore)
      const note = shared.length ? `En Lore faltan voces: ${shared.join(', ')} comparte${shared.length > 1 ? 'n' : ''} voz con otro agente. Añade más en Lore › voces › mujer u hombre.` : undefined
      const references = await loadDebateVoices(voices, cast.map(agent => agent.name))
      const run = playDebate(lines, cast, references, index => {
        useDebateStage.getState().speak(owner!, lines[index].agent)
        setState({ phase: 'playing', note, current: `Habla ${lines[index].name} (${index + 1} de ${lines.length}).` })
      })
      owner = onStage(cast, run.level)
      running.current = { stop: run.stop }
      const recording = await run.done
      if (running.current?.stop !== run.stop) return
      running.current = undefined
      useDebateStage.getState().hide(owner)
      if (!recording) { setState({ phase: 'idle' }); return }
      setState({ phase: 'saving', note })
      const info = await saveDebate(text, lines, cast, recording)
      setSaved(info)
      setState({ phase: 'idle', note: `Guardado en Lore › debates › ${info.folder}.` })
    } catch (cause) {
      running.current?.stop()
      running.current = undefined
      setState({ phase: 'idle', error: message(cause) })
    } finally {
      if (owner) useDebateStage.getState().hide(owner)
    }
  }
  /** Plays the saved debate, or with `only` one agent's voice. */
  const replay = async (info: SavedDebateInfo, only?: number) => {
    useCharacterAudio.getState().stop()
    setState({ phase: 'preparing' })
    let owner: symbol | undefined
    let follow: ReturnType<typeof setInterval> | undefined
    try {
      const file = only === undefined ? FULL_TRACK : info.agents[only].file
      const run = playTrack(await readDebateTrack(info.folder, file))
      running.current = { stop: run.stop }
      owner = onStage(only === undefined ? info.agents : [info.agents[only]], run.level)
      const stage = owner
      useDebateStage.getState().speak(stage, only === undefined ? null : 0)
      setState({ phase: 'playing', current: only === undefined ? 'Debate completo.' : `Solo ${info.agents[only].name}.` })
      if (only === undefined) {
        follow = setInterval(() => {
          const line = speakerAt(info.timing, run.position())
          useDebateStage.getState().speak(stage, line >= 0 ? info.timing[line].agent : null)
        }, 100)
      }
      await run.done
      if (running.current?.stop === run.stop) { running.current = undefined; setState({ phase: 'idle' }) }
    } catch (cause) {
      running.current?.stop()
      running.current = undefined
      setState({ phase: 'idle', error: message(cause) })
    } finally {
      if (follow) clearInterval(follow)
      if (owner) useDebateStage.getState().hide(owner)
    }
  }
  const exportFile = async (info: SavedDebateInfo, file?: string) => {
    try {
      const where = await exportDebate(info.folder, file)
      if (where) toast.success(`Guardado en ${where}`)
    } catch (cause) {
      toast.error(message(cause))
    }
  }

  const busy = state.phase !== 'idle'
  const speakers = cast.map(agent => agent.name).join(', ')
  return <div data-testid="pluma-debate-player" className="mt-3 space-y-1.5 rounded-md border px-3 py-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">Debate · {lines.length} intervenciones · {speakers}</span>
      {busy
        ? <Button type="button" size="sm" variant="outline" disabled={state.phase === 'saving'} onClick={stop}><Square className="size-3.5" aria-hidden="true" />Detener</Button>
        : <Button type="button" size="sm" variant="outline" onClick={() => void (saved ? replay(saved) : generate())}><Play className="size-3.5" aria-hidden="true" />Escuchar debate</Button>}
    </div>
    {saved && !busy && <div className="flex flex-wrap items-center gap-1.5" data-testid="pluma-debate-saved">
      {saved.agents.map((agent, index) => <Button key={agent.file} type="button" size="sm" variant="ghost" onClick={() => void replay(saved, index)}>Solo {agent.name}</Button>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => void openDebateFolder(saved.folder).catch(cause => toast.error(message(cause)))}><FolderOpen className="size-3.5" aria-hidden="true" />Abrir carpeta</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost"><Download className="size-3.5" aria-hidden="true" />Descargar</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void exportFile(saved)}>Todo (carpeta con cada archivo)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportFile(saved, FULL_TRACK)}>Debate completo (WAV)</DropdownMenuItem>
          {saved.agents.map(agent => <DropdownMenuItem key={agent.file} onSelect={() => void exportFile(saved, agent.file)}>Solo {agent.name} (WAV)</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void exportFile(saved, SCRIPT_FILE)}>Guion (texto)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" size="sm" variant="ghost" title="Vuelve a generar las voces, por ejemplo después de cambiar las de los agentes" onClick={() => { setSaved(undefined); void generate() }}>Generar de nuevo</Button>
    </div>}
    <p role="status" className="text-xs text-muted-foreground">
      {state.phase === 'preparing' ? 'Preparando las voces… la primera vez tarda unos segundos.' : state.phase === 'saving' ? 'Guardando el debate en Lore…' : state.current ?? ''}
    </p>
    {state.note && <p className="text-xs text-muted-foreground">{state.note}</p>}
    {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
  </div>
}
