import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { UIMessage } from 'ai'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Mic, MoreHorizontal } from 'lucide-react'
import { useActiveCharacter } from '@/hooks/useAvailableAssistants'
import { useThreads } from '@/hooks/useThreads'
import { defaultVoiceId, useCharacterAudio } from '@/lib/characters/audio'
import { plumaDirectVoice, startPlumaCall, supportsPlumaCall, usesPlumaCall, type PlumaCallPhase, type PlumaCallTiming } from '@/lib/characters/pluma-realtime'
import { plumaCloneVoice, startPlumaClone, usesPlumaClone } from '@/lib/characters/pluma-clone'
import { normalizePlumaSpeech } from '@/lib/characters/pluma-text'
import { usePlumaCloneReference } from '@/hooks/usePlumaCloneReference'
import { PlumaCloneReference } from './PlumaCloneReference'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { useChatSessions } from '@/stores/chat-session-store'
import { toast } from 'sonner'
import { HologramAvatar, HOLOGRAM_PORTRAITS, HOLOGRAM_STAGE_ID, usesHologram } from './HologramAvatar'
import './VoiceOrbDock.css'

const micSilenceMs = 6000
let mountedViews = 0
/** The character whose call the person paused: it must not reopen by itself on the next screen. */
let autoListenDeclined: string | null = null
let orphanTimer: ReturnType<typeof setTimeout> | undefined
let orphanRouteCheck: ReturnType<typeof setInterval> | undefined
const noMessages: UIMessage[] = []
const plumaStatus: Record<PlumaCallPhase, string> = {
  connecting: 'Preparando LFM3 en este equipo…',
  listening: 'Te escucho. Habla y haz una pausa al terminar.',
  transcribing: 'Reconociendo tu frase en este equipo…',
  thinking: 'Preparando respuesta…',
  consulting: 'Consultando la biblioteca local con Qwen3.5-9B…',
  speaking: 'Hablando',
  composing: 'Generando canción…',
  singing: 'Cantando',
}
function clearOrphanWatch() { clearTimeout(orphanTimer); clearInterval(orphanRouteCheck) }

function lastAssistant(threadId: string | null) {
  const messages = threadId ? useChatSessions.getState().sessions[threadId]?.chat.messages : undefined
  return messages?.filter(message => message.role === 'assistant').at(-1)
}
function isCurrentThread() {
  return (useThreads.getState().currentThreadId ?? null) === useAvatarVoiceSession.getState().threadId
}

export default function VoiceOrbDock({ busy = false, onVoiceMessage }: {
  busy?: boolean
  onVoiceMessage?: (text: string, generation: number) => Promise<void> | void
  onInterrupt?: () => void
}) {
  const session = useAvatarVoiceSession()
  const activeProfile = useActiveCharacter()
  const profiles = useCharacterStore(state => state.profiles)
  const saving = useCharacterStore(state => state.saving)
  const profile = session.open ? profiles.find(item => item.id === session.characterId) : activeProfile
  const cloneCall = usesPlumaClone(profile)
  const directCall = !cloneCall && usesPlumaCall(profile)
  const localCall = cloneCall || directCall
  const cloneVolume = cloneCall ? profile?.voice.volume ?? 0.8 : 1
  const plumaSelector = supportsPlumaCall(profile?.id)
  const reference = usePlumaCloneReference(cloneCall)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [stage, setStage] = useState<HTMLElement | null>(null)
  const [micSilent, setMicSilent] = useState(false)
  const lastSound = useRef(0)
  const startCall = useRef<() => void>(undefined)
  const nativeVoices = useCharacterAudio(state => state.voices)
  const [callPhase, setCallPhase] = useState<PlumaCallPhase>('connecting')
  const [callLevel, setCallLevel] = useState(0)
  const [callTiming, setCallTiming] = useState<PlumaCallTiming>()
  const [canSing, setCanSing] = useState(false)
  const plumaCall = useRef<ReturnType<typeof startPlumaCall> | null>(null)
  const threadId = useThreads(state => state.currentThreadId)
  const hasThread = useThreads(state => Boolean(state.currentThreadId && state.threads[state.currentThreadId]))
  const audioStatus = useCharacterAudio(state => state.status)
  const audioError = useCharacterAudio(state => state.error)
  const amplitude = useCharacterAudio(state => state.amplitude)
  const dictation = useCharacterAudio(state => state.dictation)
  const catalogLoaded = useCharacterAudio(state => state.catalogLoaded)
  const chat = useChatSessions(state => session.threadId ? state.sessions[session.threadId]?.chat : undefined)
  const subscribeMessages = useCallback((notify: () => void) => chat?.['~registerMessagesCallback'](notify) ?? (() => {}), [chat])
  const subscribeStatus = useCallback((notify: () => void) => chat?.['~registerStatusCallback'](notify) ?? (() => {}), [chat])
  const messages = useSyncExternalStore(subscribeMessages, () => chat?.messages ?? noMessages)
  const chatStatus = useSyncExternalStore(subscribeStatus, () => chat?.status ?? 'ready')
  const processing = busy || chatStatus === 'submitted' || chatStatus === 'streaming'
  const callback = useRef(onVoiceMessage)
  callback.current = onVoiceMessage
  const busyRef = useRef(busy)
  busyRef.current = processing
  const stop = (close = false) => {
    if (close && profile) autoListenDeclined = profile.id
    plumaCall.current?.stop()
    useCharacterAudio.getState().stop()
    if (close) useAvatarVoiceSession.getState().close()
    else useAvatarVoiceSession.getState().pause()
    if (close && profile?.voice.enabled) {
      void useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, enabled: false } }).catch(() => toast.error('Se detuvo el audio, pero no se pudo guardar Voz desactivada. Revisa las opciones del asistente.'))
    }
  }

  useEffect(() => {
    mountedViews += 1
    clearOrphanWatch()
    return () => {
      mountedViews -= 1
      const current = useAvatarVoiceSession.getState()
      if (!current.open) return
      const generation = current.generation
      useCharacterAudio.getState().stop(`avatar:${generation}`)
      const route = window.location.pathname
      const match = /^\/threads\/([^/]+)\/?$/.exec(route)
      const waitingHandoff = current.active && current.phase === 'waiting' && match && (!current.threadId || encodeURIComponent(current.threadId) === match[1])
      const closeOrphan = () => {
        clearOrphanWatch()
        if (!mountedViews && useAvatarVoiceSession.getState().generation === generation) {
          useCharacterAudio.getState().stop(`avatar:${generation}`); useAvatarVoiceSession.getState().close()
        }
      }
      // Only a submitted voice turn may bridge lazy loading of its new thread, never an open microphone.
      orphanTimer = setTimeout(closeOrphan, waitingHandoff ? 5000 : 0)
      if (waitingHandoff) orphanRouteCheck = setInterval(() => { if (window.location.pathname !== route) closeOrphan() }, 50)
    }
  }, [])

  useEffect(() => { if (profile?.avatar.enabled) void useCharacterAudio.getState().loadCatalog() }, [profile?.id, profile?.avatar.enabled])

  useEffect(() => { setStage(document.getElementById(HOLOGRAM_STAGE_ID)) }, [threadId])

  useEffect(() => {
    if (callLevel > 0) { lastSound.current = Date.now(); setMicSilent(false) }
  }, [callLevel])

  // A working microphone always carries some noise: a level of exactly zero
  // means it is muted or off, and otherwise the call would just seem deaf.
  useEffect(() => {
    if (!localCall || !session.active || callPhase !== 'listening') { setMicSilent(false); return }
    lastSound.current = Date.now()
    const timer = setInterval(() => setMicSilent(Date.now() - lastSound.current > micSilenceMs), 1000)
    return () => clearInterval(timer)
  }, [localCall, session.active, callPhase])

  // A local call listens as soon as its character is on screen. «Solo chat» holds
  // the microphone closed even if turning the voice off could not be saved, and
  // pausing holds until the character changes. Once the voice is really off the
  // profile remembers it, so switching it back on listens again.
  useEffect(() => {
    if (autoListenDeclined && autoListenDeclined !== activeProfile?.id) autoListenDeclined = null
    if (autoListenDeclined && autoListenDeclined === profile?.id && !profile.voice.enabled && !saving) autoListenDeclined = null
    if (!localCall || session.open || saving || processing || !profile?.voice.enabled || !profile.avatar.enabled) return
    if (activeProfile?.id !== profile.id || autoListenDeclined === profile.id) return
    if (cloneCall && (!reference.reference?.ready || reference.busy)) return
    startCall.current?.()
  }, [localCall, cloneCall, session.open, saving, processing, profile?.id, profile?.voice.enabled, profile?.avatar.enabled, activeProfile?.id, reference.reference?.ready, reference.busy])

  useEffect(() => {
    if (!session.open) return
    void useCharacterAudio.getState().loadCatalog()
    if (!profile || (activeProfile?.id !== session.characterId && (activeProfile || hasThread || !threadId))) {
      useCharacterAudio.getState().stop(); useAvatarVoiceSession.getState().close(); return
    }
    if ((threadId ?? null) !== session.threadId) {
      if (!threadId || !useAvatarVoiceSession.getState().adoptThread(threadId)) {
        useCharacterAudio.getState().stop(); useAvatarVoiceSession.getState().close()
      }
    }
  }, [session.open, session.characterId, session.threadId, activeProfile, profile, hasThread, threadId])

  useEffect(() => {
    if (!localCall || !session.open || !session.active || !profile?.avatar.enabled || !profile.voice.enabled || activeProfile?.id !== session.characterId) return
    const generation = session.generation
    const isCurrent = () => {
      const current = useAvatarVoiceSession.getState()
      return current.open && current.active && current.generation === generation && isCurrentThread()
    }
    setCallPhase('connecting')
    setCallLevel(0)
    setCallTiming(undefined)
    setCanSing(false)
    const callbacks = {
      isCurrent,
      onPhase: setCallPhase,
      onAmplitude: setCallLevel,
      onFirstAudio: setCallTiming,
      onSongCapability: setCanSing,
      onError: (message: string) => { if (isCurrent()) useAvatarVoiceSession.getState().pause(message) },
    }
    const call = cloneCall ? startPlumaClone(callbacks, cloneVolume) : startPlumaCall(callbacks)
    plumaCall.current = call
    call.setMuted(useAvatarVoiceSession.getState().muted)
    return () => { call.stop(); plumaCall.current = null }
  }, [localCall, cloneCall, cloneVolume, session.open, session.active, session.generation, session.characterId, activeProfile?.id, profile?.avatar.enabled, profile?.voice.enabled, threadId])

  useEffect(() => {
    if (localCall || !session.open || !session.active || session.phase !== 'ready' || processing || activeProfile?.id !== session.characterId || !callback.current) return
    const generation = session.generation
    if (!useAvatarVoiceSession.getState().claim(generation, 'ready', 'listening')) return
    void useCharacterAudio.getState().startDictation(text => {
      const current = useAvatarVoiceSession.getState()
      if (!current.open || !current.active || current.generation !== generation || current.phase !== 'listening' || !isCurrentThread()) return
      useAvatarVoiceSession.setState({ phase: 'waiting', heardText: text, baselineMessageId: lastAssistant(current.threadId)?.id ?? null, submittedMessageId: null, sawBusy: false, waitingSince: Date.now(), error: null })
      Promise.resolve().then(() => {
        const pending = useAvatarVoiceSession.getState()
        if (pending.open && pending.active && pending.generation === generation && pending.phase === 'waiting' && isCurrentThread()) return callback.current?.(text, generation)
      }).catch(() => {
        if (useAvatarVoiceSession.getState().generation === generation) {
          useCharacterAudio.getState().stop(); useAvatarVoiceSession.getState().pause('No se pudo enviar el mensaje. Revisa el chat antes de continuar.')
        }
      })
    }, { autoFinish: true, owner: `avatar:${generation}`, isCurrent: () => {
      const current = useAvatarVoiceSession.getState()
      return current.open && current.active && current.generation === generation && current.phase === 'listening' && isCurrentThread()
    } }).then(() => {
      if (useAvatarVoiceSession.getState().generation === generation && useCharacterAudio.getState().status === 'error') {
        useAvatarVoiceSession.getState().pause(useCharacterAudio.getState().error ?? 'No se pudo iniciar el dictado local.')
      }
    })
  }, [localCall, session.open, session.active, session.phase, session.generation, session.characterId, processing, activeProfile?.id])

  useEffect(() => {
    if (localCall || !session.open || !session.active || session.phase !== 'waiting' || !profile) return
    if (processing) { if (!session.sawBusy) useAvatarVoiceSession.setState({ sawBusy: true }); return }
    let last: UIMessage | undefined
    let latestUserId: string | undefined
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'user') {
        latestUserId = message.id
        break
      }
      if (!last && message.role === 'assistant') last = message
    }
    const text = last?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
    const generation = session.generation
    if (session.submittedMessageId === latestUserId && last && text && last.id !== session.baselineMessageId && last.id !== session.spokenMessageId) {
      if (!useAvatarVoiceSession.getState().claim(generation, 'waiting', 'speaking')) return
      useAvatarVoiceSession.setState({ spokenMessageId: last.id })
      const finished = () => {
        const current = useAvatarVoiceSession.getState()
        if (!current.open || !current.active || current.generation !== generation || current.phase !== 'speaking' || current.spokenMessageId !== last.id) return
        if (useCharacterAudio.getState().status === 'error') current.pause(useCharacterAudio.getState().error ?? 'La reproducción local se interrumpió.')
        else useAvatarVoiceSession.setState({ phase: 'ready' })
      }
      if (session.muted) finished()
      else void useCharacterAudio.getState().speak(profile.id === 'literatura' ? normalizePlumaSpeech(text) : text, profile, { owner: `avatar:${generation}`, isCurrent: () => {
        const current = useAvatarVoiceSession.getState()
        return current.open && current.active && current.generation === generation && current.phase === 'speaking' && current.spokenMessageId === last.id && isCurrentThread()
      } }).then(finished)
      return
    }
    const timer = setTimeout(() => {
      const current = useAvatarVoiceSession.getState()
      if (current.generation === generation && current.phase === 'waiting' && !busyRef.current) {
        useCharacterAudio.getState().stop()
        current.pause('No llegó una respuesta nueva. Revisa el modelo y el estado del chat antes de continuar.')
      }
    }, Math.max(session.sawBusy ? 1000 : 0, 15000 - (Date.now() - session.waitingSince)))
    return () => clearTimeout(timer)
  }, [localCall, session.open, session.active, session.phase, session.threadId, session.generation, session.baselineMessageId, session.submittedMessageId, session.spokenMessageId, session.muted, session.sawBusy, session.waitingSince, profile, processing, messages])

  useEffect(() => {
    if (!localCall && session.open && session.active && audioStatus === 'error') useAvatarVoiceSession.getState().pause(audioError ?? 'El audio local se detuvo.')
  }, [localCall, audioStatus, audioError, session.open, session.active])

  useEffect(() => {
    if (session.open && session.active && profile && (!profile.voice.enabled || !profile.avatar.enabled)) {
      useCharacterAudio.getState().stop(); useAvatarVoiceSession.getState().pause()
    }
  }, [session.open, session.active, profile?.voice.enabled, profile?.avatar.enabled, profile])

  if (!profile?.avatar.enabled) return null
  const cloneNeedsReference = cloneCall && !reference.reference?.ready
  const localStatus = cloneCall && callPhase === 'connecting' ? 'Preparando Gemma y la voz de Qwen en este equipo…' : plumaStatus[callPhase]
  const status = localCall ? session.active ? localStatus : cloneNeedsReference ? 'Elige una muestra de voz' : 'Micrófono apagado' : processing ? 'Preparando respuesta…' : audioStatus === 'speaking' ? 'Hablando' : audioStatus === 'preparing' ? 'Preparando audio local…' : audioStatus === 'transcribing' ? 'Transcribiendo en este equipo…' : session.phase === 'listening' ? 'Te escucho. Termina tu frase y espera un momento.' : session.phase === 'waiting' ? 'Esperando la respuesta del chat…' : session.active ? 'Conversación en curso' : 'Micrófono apagado'
  const callState = callPhase === 'singing' ? 'speaking' : callPhase === 'speaking' || callPhase === 'listening' ? callPhase : 'thinking'
  const state = localCall ? session.error ? 'error' : session.active ? callState : 'idle' : session.error || audioError ? 'error' : audioStatus === 'speaking' ? 'speaking' : audioStatus === 'listening' ? 'listening' : processing || ['preparing', 'transcribing'].includes(audioStatus) || session.phase === 'waiting' ? 'thinking' : 'idle'
  const start = () => {
    if (cloneNeedsReference || (cloneCall && reference.busy)) { setOptionsOpen(true); return }
    useCharacterAudio.getState().stop()
    useAvatarVoiceSession.getState().openFor(profile.id, threadId ?? null)
    const nonce = useAvatarVoiceSession.getState().generation
    void useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, enabled: true } }).then(() => {
      const current = useAvatarVoiceSession.getState()
      if (current.open && current.generation === nonce) current.start()
    }).catch(() => {
      if (useAvatarVoiceSession.getState().generation === nonce) useAvatarVoiceSession.getState().pause('No se pudo guardar la activación de voz. Revisa la configuración antes de continuar.')
    })
  }
  startCall.current = start
  const inputLevel = localCall ? callLevel : amplitude
  const level = Number.isFinite(inputLevel) ? Math.max(0, Math.min(1, inputLevel)) : 0
  const color = (value: string) => /^#[a-f\d]{6}$/i.test(value) ? value : '#45404A'
  const spanishVoices = nativeVoices.filter(voice => /^es(?:-|$)/i.test(voice.language))
  const selectedVoice = !plumaSelector ? undefined : cloneCall ? plumaCloneVoice : directCall ? plumaDirectVoice : profile.voice.voiceURI ?? defaultVoiceId(profile)
  const error = session.error || (!localCall && audioError)
  const hologram = usesHologram(profile)
  const notice = error || (micSilent ? 'Tu micrófono no envía sonido. Revisa que el headset esté encendido y sin silenciar.' : undefined)
  const hologramAt = (size: 'stage' | 'call' | 'corner') => <HologramAvatar portrait={HOLOGRAM_PORTRAITS[profile.baseId]} state={state} level={level} color="#5CE1E6" label={`Holograma de ${profile.name} · ${status}`} size={size} />
  return <aside data-view={hologram ? 'hologram' : 'sphere'} data-testid="voice-orb-dock" aria-label={`Voz de ${profile.name}`} className="voice-orb-dock fixed top-16 right-4 z-40 flex items-center gap-1" data-state={state} data-motion={profile.avatar.motion} data-pluma-phase={localCall && session.active ? callPhase : undefined} data-pluma-first-audio-ms={localCall ? callTiming?.fromSpeechMs : undefined} data-pluma-commit-to-audio-ms={localCall ? callTiming?.fromCommitMs : undefined} style={{ '--voice-level': level, '--voice-sphere': color(profile.avatar.primary), '--voice-ring': color(profile.avatar.secondary), '--voice-detail': color(profile.avatar.accent) } as CSSProperties}>
    <button data-testid="voice-orb-toggle" type="button" title={`${profile.name} · ${status}`} aria-label={session.active ? 'Pausar voz' : cloneNeedsReference ? 'Configurar muestra de voz' : 'Iniciar voz'} aria-pressed={session.active} disabled={!session.active && (saving || processing || (!localCall && (!onVoiceMessage || !catalogLoaded || !dictation)))} className="voice-orb focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { if (session.active) { autoListenDeclined = profile.id; stop() } else { autoListenDeclined = null; start() } }}>{hologram ? <Mic className="size-5" aria-hidden="true" /> : <span className="voice-orb-core" />}<span className="sr-only">{profile.name} · {status}</span></button>
    <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
      <PopoverTrigger asChild><Button data-testid="voice-orb-options" aria-label="Opciones de voz" type="button" size="icon-sm" variant="ghost"><MoreHorizontal className="size-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-2">
        <p className="text-sm font-medium">{profile.name}</p>
        <p data-testid="voice-orb-status" role="status" className="text-sm">{status}</p>
        <p className="text-xs text-muted-foreground">{cloneCall ? 'Gemma 4 escucha tu frase. Qwen reproduce la respuesta con tu muestra de voz.' : directCall ? 'LFM3 escucha y responde en este equipo. Pluma consulta Qwen3.5-9B y la biblioteca local cuando la petición lo necesita.' : 'Iniciar voz autoriza el micrófono durante esta sesión. Dictado y voz locales; el mensaje usa el modelo y los permisos del chat.'}</p>
        {cloneCall && session.active && canSing && <p className="text-xs text-muted-foreground">Prueba «canta una canción sobre la lluvia». El canto usa la voz del motor musical.</p>}
        {plumaSelector && <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Voz de Pluma
            <select value={selectedVoice} disabled={saving || session.active} className="w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed" onChange={event => {
              const value = event.target.value
              const nativeVoice = spanishVoices.find(voice => voice.id === value)
              if (value !== plumaDirectVoice && value !== plumaCloneVoice && !nativeVoice) return
              useAvatarVoiceSession.getState().pause()
              const voice = { ...profile.voice, plumaDirect: value === plumaDirectVoice, plumaClone: value === plumaCloneVoice, ...(nativeVoice ? { voiceURI: nativeVoice.id, lang: nativeVoice.language } : {}) }
              void useCharacterStore.getState().updateProfile({ ...profile, voice }).catch(() => toast.error('No se pudo guardar la voz de Pluma.'))
            }}>
              <option value={plumaDirectVoice}>LFM3 · voz directa</option>
              <option value={plumaCloneVoice}>Gemma 4 · voz clonada</option>
              {!localCall && !spanishVoices.some(voice => voice.id === selectedVoice) && <option value={selectedVoice} disabled>Voz instalada no disponible</option>}
              {spanishVoices.length > 0 && <optgroup label="Voces instaladas · por chat">{spanishVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.language}</option>)}</optgroup>}
            </select>
          </label>
          {session.active && <p className="text-xs text-muted-foreground">Pausa la llamada para cambiar de voz.</p>}
        </>}
        {cloneCall && <PlumaCloneReference controls={reference} active={session.active} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" aria-pressed={!session.muted} onClick={() => {
            const muted = !session.muted
            useAvatarVoiceSession.setState({ muted })
            if (localCall) plumaCall.current?.setMuted(muted)
            else if (muted && session.phase === 'speaking') { useCharacterAudio.getState().stop(); useAvatarVoiceSession.setState({ phase: 'ready' }) }
          }}>Voz {session.muted ? 'silenciada' : 'activada'}</Button>
          {(localCall ? session.active && callPhase === 'listening' : audioStatus === 'listening') && <Button size="sm" variant="outline" onClick={() => { if (localCall) plumaCall.current?.finishTurn(); else void useCharacterAudio.getState().finishDictation() }}>Terminar frase</Button>}
          <Button data-testid="voice-orb-exit" size="sm" variant="outline" onClick={() => stop(true)}>Solo chat</Button>
          <Button size="sm" variant="ghost" onClick={() => { stop(true); void useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, enabled: false }, avatar: { ...profile.avatar, enabled: false } }).catch(() => toast.error('No se pudo ocultar el indicador. El audio ya está detenido.')) }}>Ocultar indicador</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!localCall && catalogLoaded && !dictation && <p className="text-sm text-destructive">Falta el dictado local. Puedes continuar escribiendo en el chat.</p>}
        {!catalogLoaded && audioError && <Button size="sm" variant="outline" onClick={() => void useCharacterAudio.getState().loadCatalog()}>Consultar audio local</Button>}
      </PopoverContent>
    </Popover>
    {hologram && (stage
      ? createPortal(<div className="absolute inset-x-3 inset-y-2 flex items-center justify-center overflow-hidden rounded-2xl bg-[#040810] sm:inset-x-6">{hologramAt('stage')}<p data-testid="hologram-caption" role="status" className={cn('pointer-events-none absolute inset-x-4 bottom-3 text-center text-sm font-medium', notice ? 'text-amber-300' : 'text-cyan-100/80')}>{notice ?? status}</p></div>, stage)
      : <div className="absolute right-0 top-full mt-2 flex w-[240px] flex-col items-end gap-1">{hologramAt(session.open ? 'call' : 'corner')}{notice && <p role="status" className="rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-destructive">{notice}</p>}</div>)}
  </aside>
}
