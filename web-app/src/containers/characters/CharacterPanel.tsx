import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { HOLOGRAM_PORTRAITS, usesHologram } from './HologramAvatar'
import { useCharacterAudio, defaultVoiceId } from '@/lib/characters/audio'
import { plumaDirectVoice, supportsPlumaCall, usesPlumaCall } from '@/lib/characters/pluma-realtime'
import { plumaCloneVoice, plumaReferenceStatus, usesPlumaClone } from '@/lib/characters/pluma-clone'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useActiveCharacter } from '@/hooks/useAvailableAssistants'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { CharacterProfile, CharacterMode, Intensity } from '@/lib/characters/types'
import { getCharacterChatRole, isVoiceOnlyCharacter } from '@/lib/characters/profiles'
import { isLiteraryModelProvider, loadLiteraryLibraryStatus, setLiteraryLibraryRoot, type LiteraryLibraryStatus } from '@/lib/literaryLibrary'
import { clearPlumaMemory, forgetPlumaNote, loadPlumaMemory, MAX_PLUMA_NOTES } from '@/lib/characters/pluma-memory'
import { loadPlumaProject, pickPlumaProjectFolder, savePlumaProject, type PlumaProject } from '@/lib/characters/pluma-project'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'
const statusLabels = { idle: 'Listo', preparing: 'Preparando audio local…', speaking: 'Hablando', listening: 'Escuchando · máximo 30 segundos', transcribing: 'Transcribiendo en el equipo…', error: 'Audio detenido' }
const modeLabels: Record<CharacterMode, string> = { charla: 'Charla', trabajo: 'Trabajo', serio: 'Serio' }
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{label}{children}</label>
}
function Download({ text, filename, children }: { text: () => string; filename: string; children: ReactNode }) {
  return <Button type="button" variant="outline" size="sm" onClick={() => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }}>{children}</Button>
}
function CharacterInitials({ profile }: { profile: CharacterProfile }) {
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-studio text-sm font-medium">{profile.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</span>
}

function LiteraryLibrarySettings() {
  const [status, setStatus] = useState<LiteraryLibraryStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('')
  useEffect(() => {
    let live = true
    void loadLiteraryLibraryStatus().then(value => { if (live) { setStatus(value); setFolder(value.root) } }).catch(() => {})
    return () => { live = false }
  }, [])
  async function run(action: () => Promise<LiteraryLibraryStatus>) {
    setBusy(true)
    setError('')
    try {
      const value = await action()
      setStatus(value)
      setFolder(value.root)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const refresh = () => run(() => loadLiteraryLibraryStatus(true))
  const changed = !!status && folder.trim() !== '' && folder.trim() !== status.root
  return (
    <section className="space-y-2 rounded-md border px-3 py-2 text-sm" aria-label="Biblioteca literaria">
      <p className="font-medium">Biblioteca local · {status?.root ?? 'D:\\Libreria General'}</p>
      <p className="text-muted-foreground">Pluma consulta fragmentos de esta carpeta en chat y voz con un modelo local. Solo ella puede leerla.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Carpeta de la biblioteca">
          <Input value={folder} onChange={event => setFolder(event.target.value)} placeholder="D:\Libreria General" spellCheck={false} />
        </Field>
        <Button type="button" size="sm" disabled={busy || !changed} onClick={() => void run(() => setLiteraryLibraryRoot(folder))}>Usar esta carpeta</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => setLiteraryLibraryRoot(null))}>Restablecer</Button>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? 'Indexando…' : 'Actualizar índice'}</Button>
      {busy && <p role="status">Leyendo los documentos de la biblioteca.</p>}
      {!busy && status && (
        <p role="status">{status.indexedFiles.toLocaleString('es')} archivos indexados · {status.skippedFiles.toLocaleString('es')} omitidos{status.limitReached ? ' · Se alcanzó el límite de indexación.' : ''}</p>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
  )
}

/** The project folder Pluma may edit during a voice call, off by default. */
function PlumaProjectSettings() {
  const [project, setProject] = useState<PlumaProject>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void loadPlumaProject().then(value => { if (live) setProject(value) })
    return () => { live = false }
  }, [])
  async function save(next: PlumaProject) {
    setError('')
    try {
      setProject(await savePlumaProject(next))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  async function choose() {
    setError('')
    try {
      const folder = await pickPlumaProjectFolder()
      if (folder) await save({ folder, canEdit: project?.canEdit ?? false })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="space-y-2 rounded-md border px-3 py-2 text-sm" aria-label="Proyecto de Plumita">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Editar un proyecto por voz</p>
        <Switch aria-label="Permitir que Plumita edite el proyecto" checked={!!project?.canEdit} disabled={!project?.folder} onCheckedChange={canEdit => { if (project) void save({ ...project, canEdit }) }} />
      </div>
      <p className="text-muted-foreground">Con la voz clonada, Plumita puede leer, buscar, crear y cambiar archivos de esta carpeta. No puede borrar archivos ni ejecutar comandos. Se aplica desde la siguiente llamada.</p>
      <p className="break-all">{project?.folder ?? 'Ninguna carpeta elegida'}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void choose()}>Elegir carpeta</Button>
        {project?.folder && <Button type="button" size="sm" variant="ghost" onClick={() => void save({ folder: null, canEdit: false })}>Quitar</Button>}
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
  )
}

/** What Pluma has learned in her conversations, one note per line, each removable. */
function PlumaLearnedMemory() {
  const [notes, setNotes] = useState<string[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void loadPlumaMemory().then(value => { if (live) setNotes(value) })
    return () => { live = false }
  }, [])
  async function change(action: () => Promise<string[]>) {
    setError('')
    try {
      setNotes(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="space-y-2 rounded-md border px-3 py-2 text-sm" aria-label="Lo que Plumita aprendió">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Lo que Plumita aprendió{notes ? ` · ${notes.length}/${MAX_PLUMA_NOTES}` : ''}</p>
        {!!notes?.length && <Button type="button" size="sm" variant="outline" onClick={() => { if (window.confirm('¿Borrar todo lo que Plumita aprendió? No se puede deshacer.')) void change(() => clearPlumaMemory()) }}>Borrar todo</Button>}
      </div>
      <p className="text-muted-foreground">Correcciones, gustos y temas que guardó al hablar contigo. Los usa en llamadas y en el chat.</p>
      {notes === undefined && <p role="status">Cargando…</p>}
      {notes?.length === 0 && <p className="text-muted-foreground">Todavía no ha guardado nada.</p>}
      {!!notes?.length && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {notes.map(note => (
            <li key={note} className="flex items-start justify-between gap-2 rounded bg-muted/40 px-2 py-1">
              <span className="min-w-0 break-words">{note}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={`Olvidar: ${note}`} onClick={() => void change(() => forgetPlumaNote(note))}>Olvidar</Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
  )
}

export function CharacterAudioRuntime({ busy = false }: { busy?: boolean; onInterrupt?: () => void }) {
  const profile = useActiveCharacter()
  const activeId = profile?.id
  const threadId = useThreads(state => state.currentThreadId)
  useEffect(() => {
    if (!useAvatarVoiceSession.getState().open) useCharacterAudio.getState().stop()
    return () => { if (!useAvatarVoiceSession.getState().open) useCharacterAudio.getState().stop() }
  }, [activeId, threadId, busy])
  return null
}

export type CharacterPanelProps = {
  busy?: boolean
  onInterrupt?: () => void
  onVoiceMessage?: (text: string, generation: number) => Promise<void> | void
  presentation?: 'compact' | 'toolbar' | 'editor'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  characterId?: string
}
export default function CharacterPanel({ busy = false, onVoiceMessage, presentation = 'compact', open: controlledOpen, onOpenChange, characterId }: CharacterPanelProps) {
  const profiles = useCharacterStore((state) => state.profiles)
  const activeId = useCharacterStore((state) => state.activeCharacterId)
  const activeProfile = useActiveCharacter()
  const loaded = useCharacterStore((state) => state.loaded)
  const saving = useCharacterStore((state) => state.saving)
  const storageError = useCharacterStore((state) => state.error)
  const audioStatus = useCharacterAudio((state) => state.status)
  const audioError = useCharacterAudio((state) => state.error)
  const voices = useCharacterAudio((state) => state.voices)
  const dictation = useCharacterAudio((state) => state.dictation)
  const providers = useModelProvider((state) => state.providers)
  const threadId = useThreads((state) => state.currentThreadId)
  const projectId = useThreads((state) => state.currentThreadId ? state.threads[state.currentThreadId]?.metadata?.project?.id : undefined)
  const [editingId, setEditingId] = useState(characterId ?? activeProfile?.id ?? activeId)
  const profile = profiles.find((item) => item.id === editingId) ?? profiles[0]
  const [internalOpen, setInternalOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next) }
  const [tab, setTab] = useState<'perfil' | 'voz' | 'memoria'>('perfil')
  const [draft, setDraft] = useState(profile)
  const chatRole = getCharacterChatRole(draft)
  const [individual, setIndividual] = useState({ enabled: false, notes: '' })
  const [shared, setShared] = useState({ enabled: false, notes: '' })
  const [notice, setNotice] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const run = (operation: Promise<unknown>) => { setLocalError(null); void operation.catch((error: unknown) => setLocalError(error instanceof Error ? error.message : 'No se pudo aplicar el cambio.')) }

  useEffect(() => { void useCharacterStore.getState().load().catch(() => {}) }, [])
  useEffect(() => { if (open || optionsOpen) void useCharacterAudio.getState().loadCatalog() }, [open, optionsOpen])
  useEffect(() => { if (open && characterId) setEditingId(characterId) }, [open, characterId])
  useEffect(() => {
    if (open) {
      const selected = useCharacterStore.getState().profiles.find((item) => item.id === editingId)
      if (!selected) return
      setDraft(selected)
      const memory = useCharacterStore.getState().getMemory(selected.id, projectId)
      setIndividual(memory.individual); setShared({ enabled: memory.shared.enabled, notes: memory.shared.notes }); setNotice(null)
    }
  }, [open, editingId, projectId])

  const update = (next: CharacterProfile) => run(useCharacterStore.getState().updateProfile(next))
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setLocalError(null); setNotice(null)
    try {
      await useCharacterStore.getState().updateProfile(draft)
      await useCharacterStore.getState().setIndividualMemory(profile.id, individual)
      if (projectId) await useCharacterStore.getState().setSharedMemory(projectId, shared)
      setNotice('Cambios guardados en este equipo.')
    } catch (error) { setLocalError(error instanceof Error ? error.message : 'No se pudieron guardar todos los cambios. Revisa los ajustes antes de continuar.') }
  }
  const errors = localError || storageError || audioError
  const isLiterary = draft.id === 'literatura'
  const draftPluma = supportsPlumaCall(draft.id)
  const draftClone = usesPlumaClone(draft)
  const draftDirect = !draftClone && usesPlumaCall(draft)
  const activeLocalCall = usesPlumaCall(activeProfile) || usesPlumaClone(activeProfile)
  const availableModels = providers
    .filter(provider => provider.active !== false && (!isLiterary || isLiteraryModelProvider(provider)))
    .flatMap(provider => provider.models
      .filter(model => !model.capabilities?.includes('embeddings'))
      .map(model => ({ providerId: provider.provider, modelId: model.id, label: `${provider.provider} · ${model.name ?? model.id}` })))
  const bindingAvailable = !draft.modelBinding || availableModels.some(model => model.providerId === draft.modelBinding?.providerId && model.modelId === draft.modelBinding.modelId)
  return <>
    {presentation !== 'editor' && <>
    {activeProfile && <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
      <PopoverTrigger asChild><Button data-testid="character-options-trigger" type="button" size="sm" variant="ghost" aria-label="Opciones del asistente">Opciones del asistente</Button></PopoverTrigger>
      <PopoverContent data-testid="character-options-popover" align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3">
        <div className="flex items-center gap-3"><CharacterInitials profile={activeProfile} /><span className="text-sm font-medium">{activeProfile.name}</span></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Modo del personaje" className={cn(fieldClass, 'w-auto py-1 text-xs')} disabled={saving} value={activeProfile.settings.mode} onChange={(e) => update({ ...activeProfile, settings: { ...activeProfile.settings, mode: e.target.value as CharacterMode } })}>{Object.entries(modeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <Button type="button" size="sm" variant="ghost" aria-pressed={activeProfile.avatar.enabled} disabled={saving} onClick={() => { if (activeProfile.avatar.enabled) { useCharacterAudio.getState().stop(); useAvatarVoiceSession.getState().close() } update({ ...activeProfile, avatar: { ...activeProfile.avatar, enabled: !activeProfile.avatar.enabled } }) }}>Indicador {activeProfile.avatar.enabled ? 'visible' : 'oculto'}</Button>
          <Button type="button" size="sm" variant="ghost" aria-pressed={activeProfile.avatar.motion > 0} disabled={saving || !activeProfile.avatar.enabled} onClick={() => update({ ...activeProfile, avatar: { ...activeProfile.avatar, motion: activeProfile.avatar.motion > 0 ? 0 : 1 } })}>Animación {activeProfile.avatar.motion > 0 ? 'activada' : 'desactivada'}</Button>
          {activeProfile.baseId in HOLOGRAM_PORTRAITS && <Button data-testid="avatar-display-toggle" type="button" size="sm" variant="ghost" disabled={saving || !activeProfile.avatar.enabled} onClick={() => update({ ...activeProfile, avatar: { ...activeProfile.avatar, display: usesHologram(activeProfile) ? 'sphere' : 'hologram' } })}>Vista: {usesHologram(activeProfile) ? 'holograma' : 'esfera'}</Button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="voice-orb-open" type="button" size="sm" disabled={saving || (!onVoiceMessage && !activeLocalCall) || busy} onClick={() => {
            useCharacterAudio.getState().stop(); setOptionsOpen(false)
            const session = useAvatarVoiceSession.getState(); session.openFor(activeProfile.id, threadId ?? null)
            const nonce = useAvatarVoiceSession.getState().generation
            const cloned = usesPlumaClone(activeProfile)
            run(Promise.all([useCharacterStore.getState().updateProfile({ ...activeProfile, voice: { ...activeProfile.voice, enabled: true }, avatar: { ...activeProfile.avatar, enabled: true } }), activeLocalCall ? Promise.resolve() : useCharacterAudio.getState().loadCatalog()]).then(async () => {
              const cloneReady = !cloned || (await plumaReferenceStatus()).ready
              const current = useAvatarVoiceSession.getState()
              if (current.open && current.generation === nonce) {
                if (!cloneReady) current.pause('Elige una muestra WAV o MP3 en Opciones de voz de la esfera.')
                else if (!activeLocalCall && (!useCharacterAudio.getState().catalogLoaded || !useCharacterAudio.getState().dictation)) current.pause('El dictado local no está disponible. Revisa el audio del asistente; puedes continuar por texto.')
                else current.start()
              }
            }))
          }}>{activeLocalCall ? 'Llamar a Pluma' : 'Activar voz'}</Button>
          <Button data-testid="characters-open" type="button" size="sm" variant="outline" onClick={() => { setEditingId(activeProfile.id); setOptionsOpen(false); setOpen(true) }}>Configurar personaje</Button>
        </div>
        {errors && <p className="text-sm text-destructive" role="alert">{errors}</p>}
      </PopoverContent>
    </Popover>}
    </>}

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="characters-dialog" className="flex max-h-[90dvh] max-w-[min(1100px,calc(100%-2rem))] flex-col gap-3 overflow-hidden sm:max-w-[min(1100px,calc(100%-2rem))]">
        <DialogHeader><DialogTitle>Configurar personaje</DialogTitle><DialogDescription>Edita personalidad, voz, apariencia y memoria. Abrir o guardar este editor no cambia el asistente ni el modelo del chat.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(180px,0.75fr)_minmax(0,2fr)]">
          <div className="space-y-2" aria-label="Editar personaje">
            {profiles.map((item) => <button type="button" key={item.id} aria-pressed={editingId === item.id} disabled={saving || !loaded} onClick={() => setEditingId(item.id)} className={cn('flex w-full items-center gap-2 rounded-lg border p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground', editingId === item.id && 'border-foreground bg-muted')}>
              <CharacterInitials profile={item} /><span className="min-w-0"><span className="block text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.description}</span></span>
            </button>)}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => importInput.current?.click()}>Importar perfil</Button>
              <input ref={importInput} type="file" accept="application/json,.json" className="hidden" aria-label="Archivo de personaje" onChange={(e) => {
                const file = e.target.files?.[0]; e.target.value = ''
                if (!file) return
                if (file.size > 64000) { setLocalError('El perfil admite hasta 64 KB.'); return }
                run(file.text().then((json) => useCharacterStore.getState().importProfile(json)).then((id) => setEditingId(id)))
              }} />
            </div>
          </div>
          <form onSubmit={(event) => void save(event)} className="min-w-0 space-y-3 pb-1">
            <fieldset disabled={saving || !loaded} className="min-w-0 space-y-3">
            <div className="flex items-center gap-3"><CharacterInitials profile={draft} /><div><h2 className="font-studio text-lg font-medium">{draft.name}</h2><p className="text-xs text-muted-foreground">{draft.biography}</p></div></div>
            <div className="flex gap-2" aria-label="Secciones del personaje">{(['perfil', 'voz', 'memoria'] as const).map((id) => <Button key={id} type="button" size="sm" variant={tab === id ? 'secondary' : 'ghost'} aria-pressed={tab === id} onClick={() => setTab(id)}>{id === 'perfil' ? 'Personalidad y aspecto' : id === 'voz' ? 'Voz' : 'Memoria'}</Button>)}</div>
            {tab === 'perfil' && <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.avatar.enabled} onChange={(e) => setDraft({ ...draft, avatar: { ...draft.avatar, enabled: e.target.checked } })} />Mostrar indicador de voz</label>
              <Field label="Nombre"><Input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Descripción"><Input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              <div className="rounded-md border px-3 py-2 text-sm">
                <p className="font-medium">{isVoiceOnlyCharacter(draft) ? 'Solo voz' : `Chat · ${chatRole.label}`}</p>
                <p className="text-muted-foreground">{chatRole.description}</p>
              </div>
              <Field label="Personalidad de voz"><textarea className={fieldClass} rows={4} maxLength={6000} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                {(['humor', 'energy', 'profanity', 'flirtation'] as const).map((key) => <Field key={key} label={`${({ humor: 'Humor', energy: 'Energía', profanity: 'Groserías', flirtation: 'Coqueteo' })[key]} · ${draft.settings[key]}`}><input type="range" min={0} max={3} step={1} value={draft.settings[key]} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, [key]: Number(e.target.value) as Intensity } })} /></Field>)}
              </div>
              <p className="text-xs text-muted-foreground">Ajustes de voz. 0 desactivado · 1 suave · 2 habitual · 3 intenso. En conversación hablada puedes decir «háblame en serio» o «vamos a trabajar».</p>
              <Field label="Apodo que prefieres"><Input value={draft.settings.userNickname} maxLength={40} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, userNickname: e.target.value } })} /></Field>
              <Field label="Longitud habitual"><select className={fieldClass} value={draft.settings.responseLength} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, responseLength: e.target.value as CharacterProfile['settings']['responseLength'] } })}><option value="breve">Breve</option><option value="equilibrada">Equilibrada</option><option value="detallada">Detallada</option></select></Field>
              <Field label="Modelo del personaje"><select className={fieldClass} value={draft.modelBinding ? JSON.stringify(draft.modelBinding) : ''} onChange={(e) => setDraft({ ...draft, modelBinding: e.target.value ? JSON.parse(e.target.value) : null })}><option value="">Asignar automáticamente un modelo local pequeño</option>{!bindingAvailable && draft.modelBinding && <option value={JSON.stringify(draft.modelBinding)}>No disponible: {draft.modelBinding.providerId} · {draft.modelBinding.modelId}</option>}{availableModels.map(model => <option key={`${model.providerId}/${model.modelId}`} value={JSON.stringify({ providerId: model.providerId, modelId: model.modelId })}>{model.label}</option>)}</select></Field>
              {!bindingAvailable && <p className="text-sm text-destructive" role="status">El modelo guardado no está disponible. Elige otro modelo para utilizar este asistente.</p>}
              {isLiterary && open && <LiteraryLibrarySettings />}
              {isLiterary && open && <PlumaProjectSettings />}
              {isLiterary && open && <PlumaLearnedMemory />}
              <div className="flex flex-wrap gap-3">{(['primary', 'secondary', 'accent'] as const).map((key) => <Field key={key} label={({ primary: 'Esfera', secondary: 'Aro', accent: 'Detalles' })[key]}><input type="color" value={draft.avatar[key]} onChange={(e) => setDraft({ ...draft, avatar: { ...draft.avatar, [key]: e.target.value } })} /></Field>)}</div>
              <Field label={`Animación del aro · ${draft.avatar.motion}`}><input type="range" min={0} max={3} step={1} value={draft.avatar.motion} onChange={(e) => setDraft({ ...draft, avatar: { ...draft.avatar, motion: Number(e.target.value) as Intensity } })} /></Field>
              <details><summary className="cursor-pointer text-sm">Ejemplos de su estilo</summary>{draft.examples.map((example, index) => <div key={index} className="mt-2 text-xs"><p className="font-medium">{example.situation}</p><p>{example.response}</p></div>)}</details>
            </div>}
            {tab === 'voz' && <div className="space-y-3">
              <p className="text-sm">{draftClone ? 'Qwen usa una muestra de voz guardada en este equipo. Guarda la elección y abre Opciones de voz en la esfera para elegir la muestra.' : 'Voz sintética local en español. Inicia la conversación hablada desde la esfera o Activar voz.'}</p>
              <Field label={draftPluma ? 'Voz de Pluma' : 'Voz instalada'}><select className={fieldClass} value={draftClone ? plumaCloneVoice : draftDirect ? plumaDirectVoice : draft.voice.voiceURI ?? defaultVoiceId(draft)} onChange={(e) => {
                const id = e.target.value
                const selected = voices.find(voice => voice.id === id)
                const voice = { ...draft.voice, ...(selected ? { voiceURI: id } : {}), ...(draftPluma ? { plumaDirect: id === plumaDirectVoice, plumaClone: id === plumaCloneVoice, lang: selected?.language ?? draft.voice.lang } : {}) }
                setDraft({ ...draft, voice })
              }}>
                {draftPluma && <><option value={plumaDirectVoice}>LFM3 · voz directa</option><option value={plumaCloneVoice}>Gemma 4 · voz clonada</option></>}
                {voices.filter(voice => !draftPluma || /^es(?:-|$)/i.test(voice.language)).map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.language} · {voice.provider}</option>)}
              </select></Field>
              {!voices.length && <p role="status" className="text-sm">No hay voces locales disponibles. El chat funciona sin audio.</p>}
              {!voices.length && <Button type="button" size="sm" variant="outline" onClick={() => void useCharacterAudio.getState().loadCatalog()}>Volver a consultar voces</Button>}
              {(['rate', 'pitch', 'volume'] as const).map((key) => <Field key={key} label={`${({ rate: 'Velocidad', pitch: 'Tono', volume: 'Volumen' })[key]} · ${draft.voice[key].toFixed(2)}`}><input type="range" min={key === 'volume' ? 0 : 0.5} max={key === 'volume' ? 1 : key === 'rate' ? 1.8 : 2} step="any" disabled={key === 'pitch' && draft.voice.voiceURI?.startsWith('windows:')} value={draft.voice[key]} onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, [key]: Number(e.target.value) } })} /></Field>)}
              <p className="text-xs text-muted-foreground">El tono independiente está disponible en eSpeak NG. La esfera cambia con el estado del audio y la amplitud de la voz. Su animación puede desactivarse sin silenciarla.</p>
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!voices.length || draftDirect || draftClone} onClick={() => { if (useAvatarVoiceSession.getState().open) useAvatarVoiceSession.getState().pause(); void useCharacterAudio.getState().speak(draft.examples[0]?.response ?? `Hola, soy ${draft.name}.`, draft) }}>Escuchar muestra</Button><Button type="button" variant="outline" onClick={() => { if (useAvatarVoiceSession.getState().open) useAvatarVoiceSession.getState().pause(); useCharacterAudio.getState().stop() }}>Detener audio</Button></div>
              {(draftDirect || draftClone) && <p className="text-xs text-muted-foreground">Escucha esta voz en la llamada. Los ajustes de velocidad y tono se aplican a las voces instaladas.</p>}
              <p className="text-xs" role="status">{statusLabels[audioStatus]} · {dictation ? 'Dictado español instalado' : 'Dictado local no disponible'}</p>
            </div>}
            {tab === 'memoria' && <div className="space-y-3">
              <p className="text-sm">Solo se añaden al modelo las notas que escribas y habilites. No se guardan recuerdos automáticamente ni se comparten entre proyectos. Un proveedor remoto recibirá las notas incluidas en su petición.</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={individual.enabled} onChange={(e) => setIndividual({ ...individual, enabled: e.target.checked })} />Usar memoria individual de {profile.name}</label>
              <Field label="Notas individuales"><textarea className={fieldClass} rows={4} maxLength={4000} value={individual.notes} onChange={(e) => setIndividual({ ...individual, notes: e.target.value })} /></Field>
              <Button type="button" variant="outline" size="sm" onClick={() => { setIndividual({ enabled: false, notes: '' }); run(useCharacterStore.getState().clearIndividualMemory(profile.id)) }}>Borrar memoria individual</Button>
              {projectId ? <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared.enabled} onChange={(e) => setShared({ ...shared, enabled: e.target.checked })} />Compartir estas notas con los personajes de este proyecto</label><Field label="Notas del proyecto"><textarea className={fieldClass} rows={4} maxLength={4000} value={shared.notes} onChange={(e) => setShared({ ...shared, notes: e.target.value })} /></Field><Button type="button" size="sm" variant="outline" onClick={() => { setShared({ enabled: false, notes: '' }); run(useCharacterStore.getState().clearSharedMemory(projectId)) }}>Borrar memoria del proyecto</Button></> : <p className="text-xs text-muted-foreground">Abre un chat de proyecto para gestionar su memoria compartida.</p>}
              <Download text={() => useCharacterStore.getState().exportMemory(profile.id, projectId)} filename={`memoria-${profile.id}.json`}>Exportar memoria guardada</Download>
            </div>}
            {errors && <p role="alert" className="text-sm text-destructive">{errors}</p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button type="submit" disabled={saving || !loaded}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
              <Download text={() => useCharacterStore.getState().exportProfile(profile.id)} filename={`personaje-${profile.id}.json`}>Exportar perfil guardado</Download>
              <Button type="button" variant="outline" disabled={saving} onClick={() => run(useCharacterStore.getState().duplicateProfile(profile.id).then((id) => setEditingId(id)))}>Duplicar</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => run(useCharacterStore.getState().resetProfile(profile.id).then(() => { const restored = useCharacterStore.getState().profiles.find((item) => item.id === profile.id); if (restored) setDraft(restored) }))}>Restaurar este perfil</Button>
            </div>
            </fieldset>
          </form>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cerrar editor</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function CharacterEditorDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; characterId?: string }) {
  return <CharacterPanel presentation="editor" {...props} />
}
