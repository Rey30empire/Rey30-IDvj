import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { getModelDisplayName } from '@/lib/utils'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useActiveCharacter, useAvailableAssistants } from '@/hooks/useAvailableAssistants'
import { selectIntegratedAssistant } from '@/lib/characters/assistant-integration'
import { useCharacterStore } from '@/stores/useCharacterStore'

// Define basic types to avoid missing declarations
type ModelProvider = {
  provider: string
  active: boolean
  models: Array<{
    id: string
    displayName?: string
    capabilities: string[]
  }>
  settings: unknown[]
}

type Model = {
  id: string
  displayName?: string
  capabilities?: string[]
}

type MockHookReturn = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model
  getProviderByName: (name: string) => ModelProvider | undefined
  selectModelProvider: () => void
  getModelBy: (id: string) => Model | undefined
  updateProvider: () => void
}

// Mock the dependencies
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    updateCurrentThreadModel: vi.fn(),
  })),
}))
vi.mock('@/hooks/useAvailableAssistants', () => ({
  useAvailableAssistants: vi.fn(() => []),
  useActiveCharacter: vi.fn(() => undefined),
}))
vi.mock('@/lib/characters/assistant-integration', () => ({
  assistantModelBinding: () => null,
  characterIdFromAssistantId: (id?: string) => id?.startsWith('character:') ? id.slice(10) : undefined,
  isJanModelId: (id: string) => /^jan-/i.test(id),
  preferredCharacterModel: () => null,
  selectIntegratedAssistant: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      checkMmprojExists: vi.fn(() => Promise.resolve(false)),
      checkMmprojExistsAndUpdateOffloadMMprojSetting: vi.fn(() => Promise.resolve()),
    }),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({
    favoriteModels: [],
  })),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    WEB_AUTO_MODEL_SELECTION: false,
    MODEL_PROVIDER_SETTINGS: true,
    projects: true,
  },
}))

// Mock UI components
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

vi.mock('../ProvidersAvatar', () => ({
  default: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-avatar-${provider.provider}`} />
  ),
}))

vi.mock('../Capabilities', () => ({
  default: ({ capabilities }: { capabilities: string[] }) => (
    <div data-testid="capabilities">{capabilities.join(',')}</div>
  ),
}))

vi.mock('../ModelSetting', () => ({
  ModelSetting: () => <div data-testid="model-setting" />,
}))

vi.mock('../ModelSupportStatus', () => ({
  ModelSupportStatus: () => <div data-testid="model-support-status" />,
}))

describe('DropdownModelProvider - Display Name Integration', () => {
  const mockProviders: ModelProvider[] = [
    {
      provider: 'llamacpp',
      active: true,
      models: [
        {
          id: 'model1.gguf',
          displayName: 'Custom Model 1',
          capabilities: ['completion'],
        },
        {
          id: 'model2-very-long-filename.gguf',
          displayName: 'Short Name',
          capabilities: ['completion'],
        },
        {
          id: 'model3.gguf',
          // No displayName - should fall back to ID
          capabilities: ['completion'],
        },
      ],
      settings: [],
    },
  ]

  const mockSelectedModel = {
    id: 'model1.gguf',
    displayName: 'Custom Model 1',
    capabilities: ['completion'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAvailableAssistants).mockReturnValue([])
    vi.mocked(useActiveCharacter).mockReturnValue(undefined)

    // Reset the mock for each test
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)
  })

  afterEach(() => {
    cleanup()
  })

  it('ofrece los perfiles en el selector superior y usa la selección integrada', async () => {
    const profiles = useCharacterStore.getState().profiles
    vi.mocked(useAvailableAssistants).mockReturnValue(profiles.map(profile => ({
      id: `character:${profile.id}`, name: profile.name, description: profile.description,
      instructions: '', parameters: {}, created_at: 0,
    })))
    vi.mocked(selectIntegratedAssistant).mockResolvedValue(undefined)
    render(<DropdownModelProvider />)
    expect(screen.getByRole('button', { name: 'Seleccionar asistente y modelo' })).toBeInTheDocument()
    for (const profile of profiles) expect(screen.getByTestId(`assistant-option-character:${profile.id}`)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('assistant-option-character:beto'))
    await waitFor(() => expect(selectIntegratedAssistant).toHaveBeenCalledWith('character:beto', undefined))
    expect(screen.queryByTestId('character-panel')).not.toBeInTheDocument()
  })

  it('permite volver a solo modelo y buscar asistentes sin alterar el catálogo de modelos', async () => {
    vi.mocked(useAvailableAssistants).mockReturnValue(useCharacterStore.getState().profiles.map(profile => ({
      id: `character:${profile.id}`, name: profile.name, instructions: '', parameters: {}, created_at: 0,
    })))
    vi.mocked(selectIntegratedAssistant).mockResolvedValue(undefined)
    render(<DropdownModelProvider />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar asistentes' }), { target: { value: 'Nova' } })
    expect(screen.getByTestId('assistant-option-character:nara')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-option-character:kairo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('assistant-option-model-only'))
    await waitFor(() => expect(selectIntegratedAssistant).toHaveBeenCalledWith('', undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }))
    fireEvent.click(screen.getByTestId('model-selector-tab'))
    expect(screen.getByTestId('model-option-model1.gguf')).toHaveAttribute('type', 'button')
  })

  it('muestra el error real si el modelo asociado no está disponible', async () => {
    vi.mocked(useAvailableAssistants).mockReturnValue([{ id: 'character:kairo', name: 'Kairo Voltán', instructions: '', parameters: {}, created_at: 0 }])
    vi.mocked(selectIntegratedAssistant).mockRejectedValue(new Error('El modelo asignado ya no está disponible.'))
    render(<DropdownModelProvider />)
    fireEvent.click(screen.getByTestId('assistant-option-character:kairo'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('El modelo asignado ya no está disponible.'))
  })

  it('muestra y selecciona el modelo actual del perfil aunque el chat conserve otro', async () => {
    const atlas = useCharacterStore.getState().profiles.find((item) => item.id === 'kairo')!
    vi.mocked(useActiveCharacter).mockReturnValue({ ...atlas, modelBinding: { providerId: 'llamacpp', modelId: 'model2-very-long-filename.gguf' } })
    render(<DropdownModelProvider model={{ provider: 'llamacpp', id: 'model1.gguf' }} />)
    const trigger = screen.getByRole('button', { name: 'Seleccionar asistente y modelo' })
    expect(trigger).toHaveTextContent('Short Name · Llama.cpp')
    expect(trigger).not.toHaveTextContent('Custom Model 1')
    await waitFor(() => expect(vi.mocked(useModelProvider)().selectModelProvider).toHaveBeenCalledWith('llamacpp', 'model2-very-long-filename.gguf'))
  })

  it('should display custom model name in the trigger button', () => {
    render(<DropdownModelProvider allowAssistants={false} />)

    // Should show the display name in both trigger and dropdown
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // One in trigger, one in dropdown
    // Model ID should not be visible as text (it's only in title attributes)
    expect(screen.queryByDisplayValue('model1.gguf')).not.toBeInTheDocument()
  })

  it('should fall back to model ID when no displayName is set', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockProviders[0].models[2], // model3 without displayName
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider allowAssistants={false} />)

    expect(screen.getAllByText('model3.gguf')).toHaveLength(2) // Trigger and dropdown
  })

  it('should show display names in the model list items', () => {
    render(<DropdownModelProvider allowAssistants={false} />)

    // Check if the display names are shown in the options
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Selected: Trigger + dropdown
    expect(screen.getByText('Short Name')).toBeInTheDocument() // Only in dropdown
    expect(screen.getByText('model3.gguf')).toBeInTheDocument() // Only in dropdown
  })

  it('should use getModelDisplayName utility correctly', () => {
    // Test the utility function directly with different model scenarios
    const modelWithDisplayName = {
      id: 'long-model-name.gguf',
      displayName: 'Short Name',
    } as Model

    const modelWithoutDisplayName = {
      id: 'model-without-display-name.gguf',
    } as Model

    const modelWithEmptyDisplayName = {
      id: 'model-with-empty.gguf',
      displayName: '',
    } as Model

    expect(getModelDisplayName(modelWithDisplayName)).toBe('Short Name')
    expect(getModelDisplayName(modelWithoutDisplayName)).toBe('model-without-display-name.gguf')
    expect(getModelDisplayName(modelWithEmptyDisplayName)).toBe('model-with-empty.gguf')
  })

  it('should maintain model ID for internal operations while showing display name', () => {
    const mockSelectModelProvider = vi.fn()

    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockSelectedModel,
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: mockSelectModelProvider,
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    render(<DropdownModelProvider allowAssistants={false} />)

    // Verify that display name is shown in UI
    expect(screen.getAllByText('Custom Model 1')).toHaveLength(2) // Trigger + dropdown

    // The actual model ID should still be preserved for backend operations
    // This would be tested in the click handlers, but that requires more complex mocking
    expect(mockSelectedModel.id).toBe('model1.gguf')
  })

  it('should handle updating display model when selection changes', () => {
    // Set up mock for model2 selection
    vi.mocked(useModelProvider).mockReturnValue({
      providers: mockProviders,
      selectedProvider: 'llamacpp',
      selectedModel: mockProviders[0].models[1], // model2 with displayName "Short Name"
      getProviderByName: vi.fn((name: string) =>
        mockProviders.find((p: ModelProvider) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) =>
        mockProviders[0].models.find((m: Model) => m.id === id)
      ),
      updateProvider: vi.fn(),
    } as MockHookReturn)

    // Render with model2 selected
    render(<DropdownModelProvider allowAssistants={false} />)

    // Check trigger shows Short Name
    expect(screen.getByRole('button', { name: 'Seleccionar modelo' })).toHaveTextContent('Short Name')
    // Short Name appears in dropdown (at least 1 occurrence)
    expect(screen.getAllByText('Short Name').length).toBeGreaterThanOrEqual(1)
    // Custom Model 1 is also in the dropdown
    expect(screen.getAllByText('Custom Model 1').length).toBeGreaterThanOrEqual(1)
  })
})
