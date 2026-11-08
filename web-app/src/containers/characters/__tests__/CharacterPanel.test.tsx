import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { createDefaultCharacterData } from '@/lib/characters/profiles'
const h = vi.hoisted(() => ({ saved: null as string | null, activeId: 'kairo' as string | undefined, stop: vi.fn(), speak: vi.fn(), catalog: vi.fn(), selectModel: vi.fn(), setPrompt: vi.fn(), projectId: 'project-character-fixture', messages: [{ id: 'response-qa', role: 'assistant', parts: [{ type: 'text', text: 'Respuesta sintética de interfaz.' }] }] }))
vi.mock('@/lib/characters/persistence', async original => ({ ...(await original<typeof import('@/lib/characters/persistence')>()), characterStorage: { read: async () => h.saved, write: async (value: string) => { h.saved = value } } }))
vi.mock('../VoiceOrbDock', () => ({ default: () => null }))
vi.mock('@/hooks/useAvailableAssistants', async () => {
  const { useCharacterStore } = await import('@/stores/useCharacterStore')
  return { useActiveCharacter: () => useCharacterStore(state => state.profiles.find(profile => profile.id === h.activeId)) }
})
vi.mock('@/lib/characters/audio', async () => {
  const { create } = await import('zustand')
  const useCharacterAudio = create(() => ({ status: 'idle', amplitude: 0, error: null, voices: [], dictation: false, autoplayCancelled: false, loadCatalog: h.catalog, speak: h.speak, stop: () => { h.stop(); useCharacterAudio.setState({ status: 'idle', autoplayCancelled: true }) }, startDictation: vi.fn(), finishDictation: vi.fn() }))
  return { useCharacterAudio, defaultVoiceId: () => 'espeak:es+m1' }
})
vi.mock('@/hooks/useThreads', () => ({ useThreads: (select: (state: unknown) => unknown) => select({ currentThreadId: 'thread-qa', threads: { 'thread-qa': { metadata: { project: { id: h.projectId } } } } }) }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: Object.assign((select: (state: unknown) => unknown) => select({ providers: [{ provider: 'llamacpp', active: true, models: [{ id: 'small', name: 'Modelo QA' }, { id: 'embedding-qa', capabilities: ['embeddings'] }] }, { provider: 'off', active: false, models: [{ id: 'inactive' }] }] }), { getState: () => ({ selectModelProvider: h.selectModel }) }) }))
vi.mock('@/hooks/usePrompt', () => ({ usePrompt: { getState: () => ({ prompt: 'Borrador intacto', setPrompt: h.setPrompt }) } }))
vi.mock('@/stores/chat-session-store', () => ({ useChatSessions: { getState: () => ({ sessions: { 'thread-qa': { chat: { messages: h.messages } } } }) } }))
import CharacterPanel, { CharacterAudioRuntime, CharacterEditorDialog } from '../CharacterPanel'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useCharacterAudio } from '@/lib/characters/audio'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
const wrapper = ({ children }: { children: React.ReactNode }) => <TranslationContext.Provider value={{ t: i18n.t, i18n }}>{children}</TranslationContext.Provider>
const editor = (characterId = 'kairo') => render(<CharacterEditorDialog open onOpenChange={vi.fn()} characterId={characterId} />, { wrapper })
async function voice(id: string, enabled: boolean) { const profile = structuredClone(useCharacterStore.getState().profiles.find(p => p.id === id)!); await useCharacterStore.getState().updateProfile({ ...profile, voice: { ...profile.voice, enabled } }) }
beforeEach(async () => {
  vi.clearAllMocks(); h.saved = null; h.activeId = 'kairo'; h.catalog.mockResolvedValue(undefined); h.speak.mockResolvedValue(undefined)
  useCharacterStore.setState({ ...createDefaultCharacterData(), loaded: false, saving: false, error: null }); useCharacterAudio.setState({ status: 'idle', error: null, autoplayCancelled: false }); useAvatarVoiceSession.getState().close(); i18n.changeLanguage('es'); await useCharacterStore.getState().load()
})
describe('editor sin selección implícita', () => {
  it('keeps the chat clear until options are opened', async () => {
    render(<CharacterPanel />, { wrapper }); expect(screen.queryByTestId('character-avatar')).toBeNull(); expect(screen.queryByText('Blaster')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Opciones del asistente' })); expect(await screen.findByTestId('character-options-popover')).toBeVisible(); expect(h.speak).not.toHaveBeenCalled(); expect(h.setPrompt).not.toHaveBeenCalled()
  })
  it('edits another profile without selecting, interrupting or changing model', async () => {
    editor('beto'); const dialog = await screen.findByTestId('characters-dialog'); expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Don Chispa')
    fireEvent.click(within(dialog).getByRole('button', { name: /Luna/ })); fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nara personalizada' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); await screen.findByText('Cambios guardados en este equipo.')
    expect(useCharacterStore.getState()).toMatchObject({ activeCharacterId: 'literatura', enabled: false }); expect(useCharacterStore.getState().profiles.find(p => p.id === 'nara')?.name).toBe('Nara personalizada'); expect(h.stop).not.toHaveBeenCalled(); expect(h.speak).not.toHaveBeenCalled(); expect(h.selectModel).not.toHaveBeenCalled()
  })
  it('persists independent voice avatar and animation controls', async () => {
    editor(); fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar indicador de voz' })); fireEvent.change(screen.getByLabelText('Animación del aro · 1'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: 'Voz', exact: true })); fireEvent.change(screen.getByLabelText('Volumen · 0.80'), { target: { value: '0.5' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); await screen.findByText('Cambios guardados en este equipo.')
    expect(JSON.parse(h.saved!).profiles[0]).toMatchObject({ voice: { enabled: false, volume: 0.5 }, avatar: { enabled: false, motion: 0 } }); expect(h.speak).not.toHaveBeenCalled()
  })
  it('retains unavailable binding and excludes inactive and embedding models', async () => {
    const p = structuredClone(useCharacterStore.getState().profiles[0]); p.modelBinding = { providerId: 'old', modelId: 'missing' }; await useCharacterStore.getState().updateProfile(p); editor(); const select = screen.getByLabelText('Modelo del personaje')
    expect(select).toHaveValue(JSON.stringify(p.modelBinding)); expect(within(select).getByRole('option', { name: /No disponible/ })).toBeInTheDocument(); expect(within(select).queryByRole('option', { name: /embedding-qa|inactive/ })).toBeNull(); expect(within(select).getByRole('option', { name: /Modelo QA/ })).toBeInTheDocument()
  })
  it('persists shared memory only for the actual project', async () => {
    editor('beto'); fireEvent.click(screen.getByRole('button', { name: 'Memoria' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Compartir estas notas con los personajes de este proyecto' })); fireEvent.change(screen.getByLabelText('Notas del proyecto'), { target: { value: 'Explicar paso a paso.' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); await screen.findByText('Cambios guardados en este equipo.')
    expect(JSON.parse(h.saved!).sharedMemory[h.projectId]).toEqual({ enabled: true, notes: 'Explicar paso a paso.' }); expect(useCharacterStore.getState().getMemory('kairo', 'other').shared.enabled).toBe(false); expect(useCharacterStore.getState().getMemory('kairo').individual.enabled).toBe(false)
  })
  it('preserves unsaved personality when clearing memory', async () => {
    await useCharacterStore.getState().setIndividualMemory('kairo', { enabled: true, notes: 'Nota QA.' }); editor(); fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Kairo sin guardar' } }); fireEvent.click(screen.getByRole('button', { name: 'Memoria' })); fireEvent.click(screen.getByRole('button', { name: 'Borrar memoria individual' })); await waitFor(() => expect(useCharacterStore.getState().getMemory('kairo').individual.notes).toBe('')); fireEvent.click(screen.getByRole('button', { name: 'Personalidad y aspecto' })); expect(screen.getByLabelText('Nombre')).toHaveValue('Kairo sin guardar')
  })
  it('pauses a live voice session before explicit sample playback and before stopping audio', async () => {
    useCharacterAudio.setState({ voices: [{ id: 'espeak:es-419+m1', name: 'Voz local QA', language: 'es', provider: 'espeak', gender: 'male' }] })
    useAvatarVoiceSession.getState().openFor('kairo', 'thread-qa'); useAvatarVoiceSession.getState().start(); useAvatarVoiceSession.setState({ phase: 'listening' })
    editor(); fireEvent.click(screen.getByRole('button', { name: 'Voz', exact: true })); fireEvent.click(screen.getByRole('button', { name: 'Escuchar muestra' }))
    expect(useAvatarVoiceSession.getState()).toMatchObject({ active: false, phase: 'paused' }); expect(h.speak).toHaveBeenCalledTimes(1)
    act(() => { useAvatarVoiceSession.getState().start(); useAvatarVoiceSession.setState({ phase: 'listening' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Detener audio' })); expect(useAvatarVoiceSession.getState()).toMatchObject({ active: false, phase: 'paused' }); expect(h.stop).toHaveBeenCalled()
  })
})
describe('audio vinculado al asistente real', () => {
  it('never inherits global character into a normal assistant', async () => {
    await useCharacterStore.getState().selectCharacter('kairo'); await voice('kairo', true); h.activeId = undefined; const view = render(<CharacterAudioRuntime />, { wrapper }); view.rerender(<CharacterAudioRuntime busy />); view.rerender(<CharacterAudioRuntime busy={false} />); expect(h.speak).not.toHaveBeenCalled()
  })
  it('never autoplays text replies even with a persisted voice preference', async () => {
    await voice('kairo', true); await voice('nara', true); const view = render(<CharacterAudioRuntime busy />, { wrapper }); h.activeId = 'nara'; view.rerender(<CharacterAudioRuntime busy />); view.rerender(<CharacterAudioRuntime busy={false} />); expect(h.speak).not.toHaveBeenCalled(); view.rerender(<CharacterAudioRuntime busy />); view.rerender(<CharacterAudioRuntime busy={false} />); expect(h.speak).not.toHaveBeenCalled()
  })
  it('does not autoplay partial turn after voice off and on while busy', async () => {
    await voice('kairo', true); const view = render(<CharacterAudioRuntime busy />, { wrapper }); await act(() => voice('kairo', false)); await act(() => voice('kairo', true)); view.rerender(<CharacterAudioRuntime busy={false} />); expect(h.speak).not.toHaveBeenCalled()
  })
  it('leaves fullscreen TTS ownership exclusive', async () => {
    await voice('kairo', true); useAvatarVoiceSession.getState().openFor('kairo', 'thread-qa'); const view = render(<CharacterAudioRuntime />, { wrapper }); view.rerender(<CharacterAudioRuntime busy />); view.rerender(<CharacterAudioRuntime busy={false} />); expect(h.speak).not.toHaveBeenCalled()
  })
})
