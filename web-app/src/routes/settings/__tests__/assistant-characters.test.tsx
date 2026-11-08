import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultCharacterData } from '@/lib/characters/profiles'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
const h = vi.hoisted(() => ({ setDefault: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), defaultId: 'character:nara' }))
vi.mock('@/hooks/useAssistant', () => ({ useAssistant: () => ({ assistants: [{ id: 'rey30', name: 'Rey30 IDvj', description: 'Asistente habitual', created_at: 1, instructions: '', parameters: {} }], defaultAssistantId: h.defaultId, setDefaultAssistant: h.setDefault, addAssistant: h.add, updateAssistant: h.update, deleteAssistant: h.remove }) }))
vi.mock('@/hooks/useAvailableAssistants', async () => {
  const { useCharacterStore } = await import('@/stores/useCharacterStore')
  const { mergeAvailableAssistants } = await import('@/lib/characters/assistant-integration')
  return { useAvailableAssistants: () => mergeAvailableAssistants([{ id: 'rey30', name: 'Rey30 IDvj', created_at: 1, instructions: '', parameters: {} }], useCharacterStore(state => state.profiles)) }
})
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => <nav aria-label="Ajustes" /> }))
vi.mock('@/containers/dialogs/AddEditAssistant', () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="normal-assistant-editor" /> : null }))
vi.mock('@/containers/dialogs', () => ({ DeleteAssistantDialog: () => null }))
vi.mock('@/containers/characters/CharacterPanel', () => ({ CharacterEditorDialog: ({ open, characterId, onOpenChange }: { open: boolean; characterId?: string; onOpenChange: (next: boolean) => void }) => open ? <div role="dialog" data-testid="character-editor-fixture" data-character-id={characterId}><button onClick={() => onOpenChange(false)}>Cerrar editor</button></div> : null }))
import { AssistantContent } from '../assistant'
import { useCharacterStore } from '@/stores/useCharacterStore'
const mount = () => render(<AssistantContent />, { wrapper: ({ children }) => <TranslationContext.Provider value={{ t: i18n.t, i18n }}>{children}</TranslationContext.Provider> })
beforeEach(() => { vi.clearAllMocks(); h.defaultId = 'character:nara'; useCharacterStore.setState({ ...createDefaultCharacterData(), loaded: true, saving: false, error: null }); i18n.changeLanguage('es') })
describe('personajes como filas de la página existente de asistentes', () => {
  it('shows ten editable profiles and the existing normal assistant without an active chat panel', () => {
    mount(); const rows = screen.getAllByTestId('assistant-character-row'); expect(rows).toHaveLength(10)
    for (const profile of useCharacterStore.getState().profiles) {
      const row = rows.find(item => item.dataset.characterId === profile.id)!
      expect(within(row).getByText(`Rey30-IDvj ${profile.name}`)).toBeVisible(); expect(within(row).getByRole('button', { name: `Editar ${profile.name}` })).toBeVisible()
    }
    expect(screen.getByText('Asistente habitual')).toBeVisible(); expect(screen.queryByTestId('voice-orb-dock')).toBeNull(); expect(document.querySelector('svg[data-character-id],canvas')).toBeNull()
  })
  it('opens the requested editor without selecting an assistant or changing the default', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Editar Forja' })); expect(screen.getByTestId('character-editor-fixture')).toHaveAttribute('data-character-id', 'beto'); expect(h.setDefault).not.toHaveBeenCalled(); expect(useCharacterStore.getState()).toMatchObject({ enabled: false, activeCharacterId: 'kairo' }); fireEvent.click(screen.getByRole('button', { name: 'Cerrar editor' })); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('includes real character IDs in the default assistant choices and preserves normal creation', () => {
    mount(); fireEvent.keyDown(screen.getByTestId('default-assistant-trigger'), { key: 'Enter' }); fireEvent.click(screen.getByRole('menuitem', { name: 'Rey30-IDvj Forja' })); expect(h.setDefault).toHaveBeenCalledWith('character:beto'); fireEvent.click(screen.getByRole('button', { name: i18n.t('assistants:addAssistant') })); expect(screen.getByTestId('normal-assistant-editor')).toBeInTheDocument(); expect(screen.queryByTestId('character-editor-fixture')).toBeNull()
  })
})
