import { useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { usePrompt } from '@/hooks/usePrompt'
import { useCharacterAudio } from '@/lib/characters/audio'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'

const owner = 'composer-dictation'

/**
 * Speaking instead of typing, where there is no voice call (the workspace):
 * what is said is written into the box, to read over before sending.
 */
export function ComposerDictation({ disabled = false }: { disabled?: boolean }) {
  const status = useCharacterAudio(state => state.owner === owner ? state.status : 'idle')
  const [starting, setStarting] = useState(false)
  const listening = status === 'listening'
  const busy = starting || status === 'preparing' || status === 'transcribing'

  const start = async () => {
    setStarting(true)
    try {
      // A voice call holds the microphone; dictation is a separate, short turn.
      const call = useAvatarVoiceSession.getState()
      if (call.active) call.pause()
      await useCharacterAudio.getState().loadCatalog()
      if (!useCharacterAudio.getState().dictation) {
        toast.error('Falta el dictado local en español. Puedes escribir mientras tanto.')
        return
      }
      await useCharacterAudio.getState().startDictation(text => {
        const current = usePrompt.getState().prompt
        usePrompt.getState().setPrompt(current.trim() ? `${current.trimEnd()} ${text}` : text)
      }, { autoFinish: true, owner })
      const after = useCharacterAudio.getState()
      if (after.owner === owner && after.status === 'error') toast.error(after.error ?? 'No se pudo usar el micrófono.')
    } finally {
      setStarting(false)
    }
  }

  return <Button
    type="button"
    variant={listening ? 'destructive' : 'ghost'}
    size="icon-sm"
    data-testid="composer-dictation"
    aria-pressed={listening}
    aria-label={listening ? 'Terminar dictado' : busy ? 'Preparando el dictado' : 'Dictar por voz'}
    title={listening ? 'Terminar dictado' : 'Dictar por voz'}
    disabled={disabled || busy}
    className="rounded-full mb-1"
    onClick={() => { if (listening) void useCharacterAudio.getState().finishDictation(); else void start() }}
  >
    {listening ? <Square className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
  </Button>
}
