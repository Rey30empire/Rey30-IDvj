import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { recordVoice, VOICE_SAMPLE_MAX_SECONDS, VOICE_SAMPLE_MIN_SECONDS, type VoiceRecorder } from '@/lib/characters/voice-recorder'

const SPEAKING_SCRIPT = '«Hola, soy yo. Esta es mi voz para que la uses cuando hablemos. Me gusta conversar, leer y aprender algo nuevo cada día, y contarte lo que voy descubriendo.»'
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo grabar tu voz.'

/**
 * Records the person's own voice from the microphone, saves it in Lore and
 * makes it the sample Pluma speaks (or sings) with.
 */
export function PlumaVoiceRecorder({ singing = false, disabled, onSave, beforeRecording, start = recordVoice }: {
  singing?: boolean
  disabled: boolean
  onSave: (name: string, wav: string) => Promise<void>
  /** Frees the microphone first, such as pausing a call that is listening. */
  beforeRecording?: () => void
  start?: () => Promise<VoiceRecorder>
}) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [name, setName] = useState(singing ? 'Mi voz cantando' : 'Mi voz')
  const [error, setError] = useState<string>()
  const recorder = useRef<VoiceRecorder>(null)
  const finishing = useRef(false)

  const save = async () => {
    const current = recorder.current
    if (!current || finishing.current) return
    finishing.current = true
    setPhase('saving')
    try {
      const wav = await current.finish()
      await onSave(name, wav)
    } catch (cause) {
      setError(message(cause))
    } finally {
      recorder.current = null
      finishing.current = false
      setPhase('idle')
    }
  }

  useEffect(() => {
    if (phase !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - started) / 1000
      setSeconds(elapsed)
      setLevel(recorder.current?.level() ?? 0)
      if (elapsed >= VOICE_SAMPLE_MAX_SECONDS) void save()
    }, 200)
    return () => window.clearInterval(timer)
    // `save` reads refs and the latest name; restarting the timer on each keystroke would reset the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Leaving the panel mid-take frees the microphone.
  useEffect(() => () => { if (!finishing.current) recorder.current?.cancel() }, [])

  const begin = async () => {
    beforeRecording?.()
    setError(undefined)
    setSeconds(0)
    setLevel(0)
    setPhase('starting')
    try {
      recorder.current = await start()
      setPhase('recording')
    } catch (cause) {
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Rey30 no tiene permiso para usar el micrófono.' : message(cause))
      setPhase('idle')
    }
  }

  const cancel = () => {
    recorder.current?.cancel()
    recorder.current = null
    setPhase('idle')
  }

  if (phase === 'idle' || phase === 'starting') return <div className="space-y-1">
    <Button type="button" size="sm" variant="outline" disabled={disabled || phase === 'starting'} onClick={() => void begin()}>
      <Mic className="size-4" aria-hidden="true" />{phase === 'starting' ? 'Abriendo micrófono…' : singing ? 'Grabarme cantando' : 'Grabar mi voz'}
    </Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>

  return <div role="group" aria-label={singing ? 'Grabación de canto' : 'Grabación de voz'} className="space-y-2 rounded-md border border-red-500/40 p-2">
    <p className="text-xs text-muted-foreground">
      {singing ? 'Canta una estrofa con calma, sin música de fondo.' : <>Lee en voz alta, con calma y cerca del micrófono: {SPEAKING_SCRIPT}</>}
    </p>
    <div className="flex items-center gap-2 text-xs">
      <span className={phase === 'recording' ? 'size-2 animate-pulse rounded-full bg-red-500' : 'size-2 rounded-full bg-muted-foreground'} aria-hidden="true" />
      <span role="timer" aria-label="Tiempo grabado" className="font-mono tabular-nums">{clock(seconds)} / {clock(VOICE_SAMPLE_MAX_SECONDS)}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-cyan-400 transition-[width] duration-150" style={{ width: `${Math.round(level * 100)}%` }} /></span>
    </div>
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Nombre en Lore
      <Input value={name} maxLength={60} disabled={phase === 'saving'} onChange={event => setName(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={phase === 'saving' || seconds < VOICE_SAMPLE_MIN_SECONDS} onClick={() => void save()}>
        {phase === 'saving' ? 'Guardando en Lore…' : seconds < VOICE_SAMPLE_MIN_SECONDS ? `Sigue hablando (${Math.ceil(VOICE_SAMPLE_MIN_SECONDS - seconds)} s)` : 'Terminar y usar esta voz'}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={phase === 'saving'} onClick={cancel}>Cancelar</Button>
    </div>
  </div>
}
