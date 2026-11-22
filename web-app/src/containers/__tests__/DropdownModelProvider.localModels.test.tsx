import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useActiveCharacter, useAvailableAssistants } from '@/hooks/useAvailableAssistants'

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

const updateCurrentThreadModel = vi.fn()
vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({ updateCurrentThreadModel })),
}))
vi.mock('@/hooks/useAvailableAssistants', () => ({
  useAvailableAssistants: vi.fn(() => []),
  useActiveCharacter: vi.fn(() => undefined),
}))
vi.mock('@/lib/characters/assistant-integration', () => ({
  assistantModelBinding: () => null,
  characterIdFromAssistantId: (id?: string) =>
    id?.startsWith('character:') ? id.slice(10) : undefined,
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
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))
vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({ favoriteModels: [] })),
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))
vi.mock('../ProvidersAvatar', () => ({ default: () => <div /> }))
vi.mock('../Capabilities', () => ({ default: () => <div /> }))
vi.mock('../ModelSetting', () => ({ ModelSetting: () => <div /> }))
vi.mock('../ModelSupportStatus', () => ({ ModelSupportStatus: () => <div /> }))

// The dialog itself is covered by its own tests; here only the wiring matters.
vi.mock('@/containers/dialogs/LocalModelsDialog', () => ({
  LocalModelsDialog: ({
    open,
    onModelLoaded,
  }: {
    open: boolean
    onModelLoaded?: (id: string) => void
  }) =>
    open ? (
      <div data-testid="local-models-dialog">
        <button onClick={() => onModelLoaded?.('phi-4')}>loaded</button>
      </div>
    ) : null,
}))

const llamacpp = (active = true): ModelProvider =>
  ({
    provider: 'llamacpp',
    active,
    settings: [],
    models: [
      { id: 'qwen', capabilities: [] },
      { id: 'phi-4', capabilities: [] },
    ],
  }) as unknown as ModelProvider

function mockProviders(providers: ModelProvider[]) {
  const selectModelProvider = vi.fn()
  const getProviderByName = (name: string) =>
    providers.find((provider) => provider.provider === name)
  vi.mocked(useModelProvider).mockReturnValue({
    providers,
    selectedProvider: 'llamacpp',
    selectedModel: { id: 'qwen' },
    getProviderByName,
    selectModelProvider,
    getModelBy: (id: string) => providers[0]?.models.find((m) => m.id === id),
    updateProvider: vi.fn(),
  } as never)
  Object.assign(useModelProvider, { getState: () => ({ getProviderByName }) })
  return { selectModelProvider }
}

describe('DropdownModelProvider - models on this PC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useThreads).mockReturnValue({ updateCurrentThreadModel } as never)
    vi.mocked(useAvailableAssistants).mockReturnValue([])
    vi.mocked(useActiveCharacter).mockReturnValue(undefined)
  })

  afterEach(() => cleanup())

  it('opens the scan from the model list and selects the model it loaded', () => {
    const { selectModelProvider } = mockProviders([llamacpp()])
    render(<DropdownModelProvider allowAssistants={false} />)

    expect(screen.queryByTestId('local-models-dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('local-models-open'))
    expect(screen.getByTestId('local-models-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByText('loaded'))
    expect(selectModelProvider).toHaveBeenCalledWith('llamacpp', 'phi-4')
    expect(updateCurrentThreadModel).toHaveBeenCalledWith({
      id: 'phi-4',
      provider: 'llamacpp',
    })
  })

  it("leaves an assistant's own model alone", () => {
    const { selectModelProvider } = mockProviders([llamacpp()])
    vi.mocked(useActiveCharacter).mockReturnValue({
      id: 'kairo',
      name: 'Kairo',
      modelBinding: { providerId: 'llamacpp', modelId: 'qwen' },
    } as never)
    render(<DropdownModelProvider />)
    fireEvent.click(screen.getByTestId('model-selector-tab'))
    fireEvent.click(screen.getByTestId('local-models-open'))

    fireEvent.click(screen.getByText('loaded'))

    expect(selectModelProvider).not.toHaveBeenCalledWith('llamacpp', 'phi-4')
  })

  it('hides the button when llama.cpp is turned off', () => {
    mockProviders([llamacpp(false)])
    render(<DropdownModelProvider allowAssistants={false} />)

    expect(screen.queryByTestId('local-models-open')).not.toBeInTheDocument()
  })
})
