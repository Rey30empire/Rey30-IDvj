import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { createDefaultCharacterData } from '@/lib/characters/profiles'
const h = vi.hoisted(() => ({ saved: null as string | null, failWrite: false, activeId: 'kairo', threadId: 'thread-qa' as string | undefined, notifyMessages: new Set<() => void>(), notifyStatus: new Set<() => void>(), chatStatus: 'ready', onText: undefined as ((text: string) => void) | undefined, resolveSpeech: undefined as (() => void) | undefined, listen: vi.fn(), speak: vi.fn(), stop: vi.fn(), catalog: vi.fn(), messages: [{ id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta anterior que nunca debe reproducirse al abrir.' }] }] }))
vi.mock('@/lib/characters/persistence', async original => ({ ...(await original<typeof import('@/lib/characters/persistence')>()), characterStorage: { read: async () => h.saved, write: async (value: string) => { if (h.failWrite) throw new Error('disco lleno'); h.saved = value } } }))

vi.mock('@/hooks/useAvailableAssistants', async () => { const { useCharacterStore } = await import('@/stores/useCharacterStore'); return { useActiveCharacter: () => useCharacterStore(state => state.profiles.find(profile => profile.id === h.activeId)) } })
vi.mock('@/hooks/useThreads', () => {
  const state = () => ({ currentThreadId: h.threadId, threads: h.threadId ? { [h.threadId]: { assistants: [{ id: `character:${h.activeId}` }] } } : {} })
  return { useThreads: Object.assign((select: (value: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }) }
})
vi.mock('@/stores/chat-session-store', () => {
  const chat = { get messages() { return h.messages }, get status() { return h.chatStatus }, '~registerMessagesCallback': (notify: () => void) => { h.notifyMessages.add(notify); return () => { h.notifyMessages.delete(notify) } }, '~registerStatusCallback': (notify: () => void) => { h.notifyStatus.add(notify); return () => { h.notifyStatus.delete(notify) } } }
  const state = () => ({ sessions: h.threadId ? { [h.threadId]: { chat } } : {} })
  return { useChatSessions: Object.assign((select: (value: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }) }
})
vi.mock('@/lib/characters/audio', async () => {
  const { create } = await import('zustand')
  const useCharacterAudio = create(() => ({ status: 'idle', amplitude: 0, error: null as string | null, voices: [], dictation: true, catalogLoaded: true, autoplayCancelled: false, loadCatalog: h.catalog, speak: h.speak, stop: () => { h.stop(); useCharacterAudio.setState({ status: 'idle', error: null, autoplayCancelled: true }) }, startDictation: h.listen, finishDictation: vi.fn() }))
  return { useCharacterAudio, defaultVoiceId: () => 'espeak:es-419+f3' }
})
const live = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), mute: vi.fn(), finish: vi.fn() }))
const clone = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), choose: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/characters/pluma-realtime', async original => {
  const module = await original<typeof import('@/lib/characters/pluma-realtime')>()
  return {
    ...module,
    supportsPlumaCall: (id: string) => id === 'literatura',
    usesPlumaCall: (profile: { id: string; voice: { plumaDirect?: boolean } } | undefined) => profile?.id === 'literatura' && profile.voice.plumaDirect !== false,
    startPlumaCall: live.start,
  }
})
vi.mock('@/lib/characters/pluma-clone', async original => {
  const module = await original<typeof import('@/lib/characters/pluma-clone')>()
  return { ...module, startPlumaClone: clone.start, plumaReferenceStatus: clone.status, choosePlumaReference: clone.choose, clearPlumaReference: clone.clear }
})
import VoiceOrbDock from '../VoiceOrbDock'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { useCharacterAudio } from '@/lib/characters/audio'
import { useCharacterStore } from '@/stores/useCharacterStore'
const wrapper = ({ children }: { children: React.ReactNode }) => <TranslationContext.Provider value={{ t: i18n.t, i18n }}>{children}</TranslationContext.Provider>
const mount = (send = vi.fn(), busy = false) => render(<VoiceOrbDock busy={busy} onVoiceMessage={send} />, { wrapper })
async function start() { fireEvent.click(screen.getByTestId('voice-orb-toggle')); await waitFor(() => expect(h.listen).toHaveBeenCalledTimes(1)) }
function submitVoiceTurn() {
  const { generation, markSubmitted } = useAvatarVoiceSession.getState()
  act(() => {
    expect(markSubmitted(generation, h.threadId!, 'voice-user')).toBe(true)
    h.messages = [...h.messages, { id: 'voice-user', role: 'user', parts: [{ type: 'text', text: 'Mensaje de prueba explícito.' }] }]
  })
}
async function transcribe() {
  await act(async () => h.onText?.('Mensaje de prueba explícito.'))
  if (h.threadId) submitVoiceTurn()
}
beforeEach(async () => {
  vi.clearAllMocks(); h.saved = null; h.failWrite = false; h.activeId = 'kairo'; h.threadId = 'thread-qa'; h.onText = undefined; h.resolveSpeech = undefined; h.chatStatus = 'ready'; h.notifyMessages.clear(); h.notifyStatus.clear(); window.history.replaceState({}, '', '/')
  h.messages = [{ id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta anterior que nunca debe reproducirse al abrir.' }] }]
  useCharacterStore.setState({ ...createDefaultCharacterData(), loaded: true, saving: false, error: null }); useCharacterAudio.setState({ status: 'idle', error: null, dictation: true, catalogLoaded: true })
  h.catalog.mockResolvedValue(undefined)
  clone.status.mockResolvedValue({ ready: false })
  h.listen.mockImplementation(async (cb: (text: string) => void) => { h.onText = cb; useCharacterAudio.setState({ status: 'listening' }) })
  h.speak.mockImplementation(() => { useCharacterAudio.setState({ status: 'speaking' }); return new Promise<void>(resolve => { h.resolveSpeech = () => { useCharacterAudio.setState({ status: 'idle' }); resolve() } }) })
  useAvatarVoiceSession.getState().close(); useAvatarVoiceSession.getState().openFor('kairo', h.threadId); i18n.changeLanguage('es')
})
afterEach(() => { vi.useRealTimers(); act(() => useAvatarVoiceSession.getState().close()) })
describe('avatar y voz con motores sustituidos por fixtures funcionales sin dispositivos', () => {
  const editPluma = (change: (profile: ReturnType<typeof useCharacterStore.getState>['profiles'][number]) => object) =>
    act(() => useCharacterStore.setState(state => ({ profiles: state.profiles.map(item => item.id === 'literatura' ? { ...item, ...change(item) } : item) })))
  it('muestra holograma o esfera, nunca los dos', () => {
    act(() => useAvatarVoiceSession.getState().close())
    h.activeId = 'literatura'
    const view = mount()
    expect(screen.getByTestId('hologram-avatar').className).toContain('w-[150px]')
    expect(document.querySelector('.voice-orb-core')).toBeNull()
    editPluma(item => ({ avatar: { ...item.avatar, display: 'sphere' } }))
    view.rerender(<VoiceOrbDock onVoiceMessage={vi.fn()} />)
    expect(screen.queryByTestId('hologram-avatar')).toBeNull()
    expect(document.querySelector('.voice-orb-core')).not.toBeNull()
  })
  it('lleva el holograma al escenario de la pantalla cuando existe', async () => {
    act(() => useAvatarVoiceSession.getState().close())
    h.activeId = 'literatura'
    const stage = document.createElement('div')
    stage.id = 'hologram-stage'
    document.body.append(stage)
    try {
      mount()
      await waitFor(() => expect(stage.querySelector('[data-testid="hologram-avatar"]')).not.toBeNull())
      expect(stage.querySelector('[data-testid="hologram-caption"]')?.textContent).toBeTruthy()
    } finally { stage.remove() }
  })
  it('escucha sola con la voz activada y no vuelve a abrirse tras pausar', async () => {
    act(() => useAvatarVoiceSession.getState().close())
    h.activeId = 'literatura'
    live.start.mockReturnValue({ stop: live.stop, setMuted: live.mute, finishTurn: live.finish })
    editPluma(item => ({ voice: { ...item.voice, enabled: true } }))
    mount()
    await waitFor(() => expect(live.start).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('voice-orb-toggle'))
    act(() => useAvatarVoiceSession.getState().close())
    await act(async () => { await Promise.resolve() })
    expect(useAvatarVoiceSession.getState().open).toBe(false)
    expect(live.start).toHaveBeenCalledTimes(1)
  })
  // Enters a local call that started by itself, with the options menu open.
  const callPluma = async () => {
    act(() => useAvatarVoiceSession.getState().close())
    h.activeId = 'nara'
    mount().unmount()
    h.activeId = 'literatura'
    live.start.mockReturnValue({ stop: live.stop, setMuted: live.mute, finishTurn: live.finish })
    editPluma(item => ({ voice: { ...item.voice, enabled: true } }))
    mount()
    await waitFor(() => expect(useAvatarVoiceSession.getState().active).toBe(true))
    expect(live.start).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('voice-orb-options'))
    return await screen.findByTestId('voice-orb-exit')
  }
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  const savedPluma = () => useCharacterStore.getState().profiles.find(item => item.id === 'literatura')!
  it('«Solo chat» apaga la llamada local y el micrófono no se vuelve a abrir', async () => {
    fireEvent.click(await callPluma())
    await waitFor(() => expect(savedPluma().voice.enabled).toBe(false))
    await settle()
    expect(live.start).toHaveBeenCalledTimes(1)
    expect(useAvatarVoiceSession.getState()).toMatchObject({ open: false, active: false })
  })
  it('«Solo chat» tampoco reabre el micrófono si no se pudo guardar', async () => {
    const exit = await callPluma()
    h.failWrite = true
    fireEvent.click(exit)
    await settle()
    expect(savedPluma().voice.enabled).toBe(true)
    expect(live.start).toHaveBeenCalledTimes(1)
    expect(useAvatarVoiceSession.getState()).toMatchObject({ open: false, active: false })
  })
  it('vuelve a escuchar sola cuando la voz se apaga con «Solo chat» y se enciende después', async () => {
    fireEvent.click(await callPluma())
    await waitFor(() => expect(savedPluma().voice.enabled).toBe(false))
    await settle()
    editPluma(item => ({ voice: { ...item.voice, enabled: true } }))
    await waitFor(() => expect(live.start).toHaveBeenCalledTimes(2))
  })
  it('no escucha sola con la voz apagada', async () => {
    act(() => useAvatarVoiceSession.getState().close())
    h.activeId = 'nara'
    mount()
    h.activeId = 'literatura'
    const view = mount()
    await act(async () => { await Promise.resolve() })
    expect(live.start).not.toHaveBeenCalled()
    view.unmount()
  })
  it('pide una muestra para Gemma y arranca la llamada clonada tras guardarla', async () => {
    h.activeId = 'literatura'
    useAvatarVoiceSession.getState().openFor(h.activeId, h.threadId!)
    const profile = useCharacterStore.getState().profiles.find(item => item.id === h.activeId)!
    await useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, plumaDirect: false, plumaClone: true } })
    clone.choose.mockResolvedValue({ ready: true, format: 'wav' })
    clone.start.mockReturnValue({ stop: live.stop, setMuted: live.mute, finishTurn: live.finish })
    mount()
    fireEvent.click(screen.getByTestId('voice-orb-toggle'))
    expect(await screen.findByText('Selecciona un WAV o MP3 con una sola voz clara.')).toBeVisible()
    expect(clone.start).not.toHaveBeenCalled()
    expect(live.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir WAV o MP3' }))
    expect(await screen.findByText('Muestra WAV guardada en este equipo.')).toBeVisible()
    fireEvent.click(screen.getByTestId('voice-orb-toggle'))
    await waitFor(() => expect(clone.start).toHaveBeenCalledTimes(1))
    expect(h.listen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cambiar muestra' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pausar voz' }))
    expect(live.stop).toHaveBeenCalled()
  })
  it('ofrece LFM3 y voces locales reales, y abre el modo elegido solo al iniciarlo', async () => {
    h.activeId = 'literatura'
    useAvatarVoiceSession.getState().openFor(h.activeId, h.threadId!)
    const voice = { id: 'espeak:es-419+f3', name: 'Voz local de prueba', language: 'es-419', provider: 'eSpeak', gender: 'female' }
    useCharacterAudio.setState({ voices: [voice], dictation: false })
    live.start.mockReturnValue({ stop: live.stop, setMuted: live.mute, finishTurn: live.finish })
    mount()
    fireEvent.click(screen.getByTestId('voice-orb-options'))
    const selector = screen.getByRole('combobox', { name: 'Voz de Pluma' })
    expect(selector).toHaveValue('lfm3:direct')
    expect(live.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('voice-orb-toggle'))
    await waitFor(() => expect(live.start).toHaveBeenCalledTimes(1))
    expect(h.listen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('voice-orb-toggle'))
    expect(live.stop).toHaveBeenCalled()
    if (!screen.queryByRole('combobox', { name: 'Voz de Pluma' })) fireEvent.click(screen.getByTestId('voice-orb-options'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Voz de Pluma' }), { target: { value: voice.id } })
    await waitFor(() => expect(useCharacterStore.getState().profiles.find(profile => profile.id === h.activeId)?.voice).toMatchObject({ plumaDirect: false, voiceURI: voice.id }))
    expect(screen.getByTestId('voice-orb-toggle')).toBeDisabled()
    expect(live.start).toHaveBeenCalledTimes(1)
  })
  it('mounts an idle orb without microphone, synthesis or text input and starts only after explicit action', async () => {
    const send = vi.fn(); mount(send)
    expect(screen.getByTestId('voice-orb-dock')).toBeVisible(); expect(screen.queryByRole('textbox')).toBeNull(); expect(h.listen).not.toHaveBeenCalled(); expect(h.speak).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
    await start(); expect(h.listen).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ autoFinish: true })); expect(h.speak).not.toHaveBeenCalled()
  })
  it('runs exactly STT then submission then a new complete reply then TTS then STT', async () => {
    const send = vi.fn(); const view = mount(send); await start(); await transcribe(); expect(send).toHaveBeenCalledWith('Mensaje de prueba explícito.', useAvatarVoiceSession.getState().generation); expect(h.speak).not.toHaveBeenCalled()
    view.rerender(<VoiceOrbDock busy onVoiceMessage={send} />)
    h.messages.push({ id: 'new', role: 'assistant', parts: [{ type: 'text', text: 'Nueva respuesta comprobable de la fixture.' }] })
    view.rerender(<VoiceOrbDock busy={false} onVoiceMessage={send} />)
    await waitFor(() => expect(h.speak).toHaveBeenCalledTimes(1)); expect(h.listen).toHaveBeenCalledTimes(1)
    expect(h.speak).toHaveBeenCalledWith('Nueva respuesta comprobable de la fixture.', expect.objectContaining({ id: 'kairo' }), expect.anything())
    await act(async () => h.resolveSpeech?.()); await waitFor(() => expect(h.listen).toHaveBeenCalledTimes(2))
  })
  it('cancels queued submission and stale transcription when returning to Solo chat, and persists voice off', async () => {
    const p = useCharacterStore.getState().profiles[0]; await useCharacterStore.getState().updateProfile({ ...p, voice: { ...p.voice, enabled: true } })
    const send = vi.fn(); mount(send); await start(); const late = h.onText
    fireEvent.click(screen.getByTestId('voice-orb-options'))
    await act(async () => { h.onText?.('No debe enviarse después de salir.'); fireEvent.click(screen.getByTestId('voice-orb-exit')) })
    await act(async () => late?.('Tampoco debe enviarse esta transcripción tardía.'))
    expect(send).not.toHaveBeenCalled(); expect(h.speak).not.toHaveBeenCalled(); expect(useAvatarVoiceSession.getState()).toMatchObject({ open: false, active: false })
    await waitFor(() => expect(useCharacterStore.getState().profiles[0].voice.enabled).toBe(false)); expect(JSON.parse(h.saved!).profiles[0].voice.enabled).toBe(false)
  })
  it('ignores completion from playback cancelled by pause', async () => {
    const send = vi.fn(); const view = mount(send); await start(); await transcribe(); view.rerender(<VoiceOrbDock busy onVoiceMessage={send} />); h.messages.push({ id: 'new', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta nueva.' }] }); view.rerender(<VoiceOrbDock onVoiceMessage={send} />); await waitFor(() => expect(h.speak).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Pausar voz' })); await act(async () => h.resolveSpeech?.()); expect(h.listen).toHaveBeenCalledTimes(1); expect(useAvatarVoiceSession.getState()).toMatchObject({ active: false, phase: 'paused' })
  })
  it('preserves authorized waiting across home to new-thread remount, without duplicating microphone or reply', async () => {
    h.threadId = undefined; useAvatarVoiceSession.getState().openFor('kairo', null); const send = vi.fn(); const old = mount(send); await start(); await transcribe()
    let next: ReturnType<typeof mount>
    act(() => { old.unmount(); h.threadId = 'created-thread-qa'; next = mount(send, true) })
    await waitFor(() => expect(useAvatarVoiceSession.getState().threadId).toBe('created-thread-qa')); expect(useAvatarVoiceSession.getState().active).toBe(true); expect(h.listen).toHaveBeenCalledTimes(1)
    submitVoiceTurn()
    h.messages = [...h.messages, { id: 'reply-new-thread', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta del nuevo hilo.' }] }]; next!.rerender(<VoiceOrbDock onVoiceMessage={send} />)
    await waitFor(() => expect(h.speak).toHaveBeenCalledTimes(1)); await act(async () => h.resolveSpeech?.()); await waitFor(() => expect(h.listen).toHaveBeenCalledTimes(2))
  })
  it('holds only a waiting submitted turn across a delayed lazy thread mount, with no microphone during the gap', async () => {
    h.threadId = undefined; useAvatarVoiceSession.getState().openFor('kairo', null); const send = vi.fn(); const old = mount(send); await start(); await transcribe()
    window.history.replaceState({}, '', '/threads/created-thread-qa')
    old.unmount()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(useAvatarVoiceSession.getState()).toMatchObject({ open: true, active: true, phase: 'waiting' }); expect(h.listen).toHaveBeenCalledTimes(1)
    h.threadId = 'created-thread-qa'; const next = mount(send, true)
    await waitFor(() => expect(useAvatarVoiceSession.getState().threadId).toBe('created-thread-qa'))
    submitVoiceTurn()
    h.messages = [...h.messages, { id: 'reply-lazy', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta tras carga diferida.' }] }]
    next.rerender(<VoiceOrbDock onVoiceMessage={send} />)
    await waitFor(() => expect(h.speak).toHaveBeenCalledTimes(1))
  })
  it('does not keep authorization when leaving for settings while waiting', async () => {
    const view = mount(); await start(); await transcribe(); window.history.replaceState({}, '', '/settings/general'); view.unmount(); await waitFor(() => expect(useAvatarVoiceSession.getState().open).toBe(false)); expect(h.listen).toHaveBeenCalledTimes(1)
  })
  it('observes late SDK messages and waits for SDK ready even when the parent busy prop never changes', async () => {
    const send = vi.fn(); mount(send); await start(); await transcribe()
    act(() => { h.chatStatus = 'streaming'; [...h.notifyStatus].forEach(notify => notify()) })
    act(() => { h.messages = [...h.messages, { id: 'late-sdk', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta parcial.' }] }]; [...h.notifyMessages].forEach(notify => notify()) })
    expect(h.speak).not.toHaveBeenCalled()
    act(() => { h.messages = [...h.messages.slice(0, -1), { id: 'late-sdk', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta final completa.' }] }]; [...h.notifyMessages].forEach(notify => notify()); h.chatStatus = 'ready'; [...h.notifyStatus].forEach(notify => notify()) })
    await waitFor(() => expect(h.speak).toHaveBeenCalledWith('Respuesta final completa.', expect.anything(), expect.anything()))
    expect(h.speak).toHaveBeenCalledTimes(1)
  })
  it('ends authorization on identity or unrelated thread change', async () => {
    const send = vi.fn(); const view = mount(send); await start(); const late = h.onText; h.activeId = 'nara'; view.rerender(<VoiceOrbDock onVoiceMessage={send} />); await act(async () => late?.('No enviar.')); expect(useAvatarVoiceSession.getState().open).toBe(false); expect(send).not.toHaveBeenCalled(); expect(h.speak).not.toHaveBeenCalled()
  })
  it('does not adopt a second unrelated thread', async () => {
    const view = mount(); await start(); await transcribe(); h.threadId = 'other-thread-qa'; view.rerender(<VoiceOrbDock onVoiceMessage={vi.fn()} />); expect(useAvatarVoiceSession.getState().open).toBe(false)
  })
  it('rejects a queued transcript if the live thread changes before React effects run', async () => {
    const send = vi.fn(); mount(send); await start()
    await act(async () => { h.onText?.('Mensaje que pertenece al hilo anterior.'); h.threadId = 'other-thread-before-effects' })
    expect(send).not.toHaveBeenCalled(); expect(h.speak).not.toHaveBeenCalled()
  })
  it('returns to Solo chat without cancelling the pending text response', async () => {
    const send = vi.fn(); let textStillRunning = true; const interrupt = vi.fn(() => { textStillRunning = false })
    const view = render(<VoiceOrbDock onVoiceMessage={send} onInterrupt={interrupt} />, { wrapper }); await start(); await transcribe()
    view.rerender(<VoiceOrbDock busy onVoiceMessage={send} onInterrupt={interrupt} />)
    fireEvent.click(screen.getByTestId('voice-orb-options')); fireEvent.click(screen.getByTestId('voice-orb-exit'))
    await waitFor(() => expect(useCharacterStore.getState().profiles[0].voice.enabled).toBe(false))
    expect(textStillRunning).toBe(true); expect(interrupt).not.toHaveBeenCalled(); expect(useAvatarVoiceSession.getState().active).toBe(false)
    h.messages = [...h.messages, { id: 'reply-kept-as-text', role: 'assistant', parts: [{ type: 'text', text: 'La generación de texto conserva su respuesta.' }] }]
    view.rerender(<VoiceOrbDock onVoiceMessage={send} onInterrupt={interrupt} />)
    expect(h.messages.at(-1)?.parts[0].text).toBe('La generación de texto conserva su respuesta.'); expect(h.speak).not.toHaveBeenCalled()
  })
  it('stops devices and authorization when the chat view is abandoned', async () => {
    const view = mount(); await start(); view.unmount(); await waitFor(() => expect(useAvatarVoiceSession.getState().open).toBe(false)); expect(h.stop).toHaveBeenCalled()
  })
  it('pauses visibly when submission fails, and cannot resubmit through old callback', async () => {
    const send = vi.fn().mockRejectedValue(new Error('fixture failure')); mount(send); await start(); const old = h.onText; await act(async () => h.onText?.('Error de envío.')); fireEvent.click(screen.getByTestId('voice-orb-options')); expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo enviar'); await act(async () => old?.('No reenviar.')); expect(send).toHaveBeenCalledTimes(1); expect(h.listen).toHaveBeenCalledTimes(1)
  })
  it('does not read a typed reply if the typed turn arrives while a voice turn is waiting', async () => {
    const send = vi.fn(); const view = mount(send); await start(); await transcribe()
    h.messages = [...h.messages, { id: 'typed-user', role: 'user', parts: [{ type: 'text', text: 'Mensaje escrito.' }] }, { id: 'typed-reply', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta a texto.' }] }]
    view.rerender(<VoiceOrbDock onVoiceMessage={send} />)
    expect(h.speak).not.toHaveBeenCalled()
  })
  it('does not open microphone when local dictation is unavailable', () => {
    useCharacterAudio.setState({ dictation: false }); mount(); expect(screen.getByTestId('voice-orb-toggle')).toBeDisabled(); expect(h.listen).not.toHaveBeenCalled()
  })
})
