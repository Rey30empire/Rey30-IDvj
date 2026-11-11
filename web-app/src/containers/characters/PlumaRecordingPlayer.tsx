import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deletePlumaRecording, downloadPlumaRecording, plumaRecordingUrl, type PlumaRecording, type PlumaRecordingKind } from '@/lib/characters/pluma-recording'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'

const downloadPrefix: Record<PlumaRecordingKind, string> = { user: 'Mi voz', voice: 'Voz de Pluma', song: 'Cancion de Pluma' }
const deleteLabel: Record<PlumaRecordingKind, string> = { user: 'Eliminar audio', voice: 'Eliminar audio', song: 'Eliminar canción' }

function suggestedName(kind: PlumaRecordingKind, createdAt: number) {
  const date = new Date(Number.isFinite(createdAt) ? createdAt : Date.now())
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${downloadPrefix[kind]} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`
}

export function PlumaRecordingPlayer({ recording, messageId, createdAt, align }: {
  recording: PlumaRecording
  messageId: string
  createdAt: number
  align: 'start' | 'end'
}) {
  const [url, setUrl] = useState<string>()
  const [missing, setMissing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    setUrl(undefined)
    setMissing(false)
    plumaRecordingUrl(recording)
      .then(value => { if (current) setUrl(value) })
      .catch(() => { if (current) setMissing(true) })
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.threadId, recording.file])

  // The open microphone would hear this playback as the person talking.
  const pauseCall = () => {
    const session = useAvatarVoiceSession.getState()
    if (session.active) session.pause()
  }
  const download = () => {
    setBusy(true)
    downloadPlumaRecording(recording, suggestedName(recording.kind, createdAt))
      .then(saved => { if (saved) toast.success('Audio guardado.') })
      .catch(() => toast.error('No se pudo guardar el audio.'))
      .finally(() => setBusy(false))
  }
  const remove = () => {
    setBusy(true)
    deletePlumaRecording(recording, messageId)
      .catch(() => { toast.error('No se pudo eliminar el audio.'); setBusy(false); setConfirming(false) })
  }

  if (missing) return <p data-testid="pluma-recording-missing" className={cn('mt-1 text-xs text-muted-foreground', align === 'end' && 'text-right')}>Este audio ya no está disponible.</p>
  return <div data-testid="pluma-recording" data-kind={recording.kind} className={cn('mt-1 flex flex-wrap items-center gap-1', align === 'end' ? 'justify-end' : 'justify-start')}>
    {url && <audio controls controlsList="nodownload" preload="none" src={url} onPlay={pauseCall} className="h-9 max-w-full" aria-label={recording.kind === 'song' ? 'Escuchar canción' : 'Escuchar audio'} />}
    {confirming
      ? <>
        <span className="px-1 text-xs text-muted-foreground">¿Eliminar este audio?</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>Sí, eliminar</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>No</Button>
      </>
      : <>
        <Button size="sm" variant="ghost" disabled={busy || !url} onClick={download}><Download className="size-4" aria-hidden="true" />Descargar</Button>
        <Button size="sm" variant="ghost" disabled={busy} aria-label={deleteLabel[recording.kind]} onClick={() => setConfirming(true)}><Trash2 className="size-4" aria-hidden="true" />Eliminar</Button>
      </>}
  </div>
}
