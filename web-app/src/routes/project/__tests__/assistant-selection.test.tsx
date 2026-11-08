import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  project: {
    id: 'owned-project',
    name: 'Owned project',
    assistantId: 'character:beto' as string | undefined,
  },
  providers: [{}] as unknown[],
  selectedProvider: 'owned-provider',
  selectedModel: { id: 'owned-model' },
  updateFolder: vi.fn(),
  select: vi.fn(),
  clearThread: vi.fn(),
  selectModel: vi.fn(),
  dropdown: {} as {
    assistantId?: string
    onAssistantChange?: (id: string) => Promise<void>
  },
  chat: {} as { projectAssistantId?: string },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (configuration: unknown) => configuration,
  useParams: () => ({ projectId: 'owned-project' }),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    getFolderById: () => h.project,
    updateFolder: h.updateFolder,
  }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({ threads: {}, deleteAllThreadsByProject: vi.fn() }),
    { getState: () => ({ setCurrentThreadId: h.clearThread }) }
  ),
}))
vi.mock('@/hooks/useAvailableAssistants', () => ({
  useAvailableAssistants: () => [],
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        providers: h.providers,
        selectedProvider: h.selectedProvider,
        selectedModel: h.selectedModel,
      }),
    { getState: () => ({ selectModelProvider: h.selectModel }) }
  ),
}))
vi.mock('@/lib/characters/assistant-integration', () => ({
  selectIntegratedAssistant: h.select,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}))
vi.mock('@/containers/ChatInput', () => ({
  default: (props: typeof h.chat) => {
    h.chat = props
    return null
  },
}))
vi.mock('@/containers/DropdownModelProvider', () => ({
  default: (props: typeof h.dropdown) => {
    h.dropdown = props
    return null
  },
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/containers/ProjectFiles', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => null,
}))
vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}))
vi.mock('@/containers/dialogs/DeleteAllThreadsInProjectDialog', () => ({
  DeleteAllThreadsInProjectDialog: () => null,
}))
import { Route } from '../$projectId'
const Component = Route.component as React.ComponentType

describe('asistente del proyecto y cabecera controlada', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.updateFolder.mockResolvedValue(undefined)
    h.select.mockResolvedValue(undefined)
    h.project = {
      id: 'owned-project',
      name: 'Owned project',
      assistantId: 'character:beto',
    }
    h.providers = [{}]
    h.selectedProvider = 'owned-provider'
    h.selectedModel = { id: 'owned-model' }
  })
  it('deriva cabecera, chat y selección inicial del mismo asistente del proyecto, sin conservar otro hilo activo', async () => {
    render(<Component />)
    await waitFor(() => expect(h.select).toHaveBeenCalledWith('character:beto'))
    expect(h.clearThread).toHaveBeenCalledWith(undefined)
    expect(h.dropdown.assistantId).toBe('character:beto')
    expect(h.chat.projectAssistantId).toBe('character:beto')
    expect(h.updateFolder).not.toHaveBeenCalled()
  })
  it('mantiene el proyecto sin asistente como selección explícita vacía, sin heredar la selección global', async () => {
    h.project.assistantId = undefined
    render(<Component />)
    await waitFor(() => expect(h.select).toHaveBeenCalledWith(''))
    expect(h.dropdown.assistantId).toBe('')
    expect(h.chat.projectAssistantId).toBeUndefined()
  })
  it('persiste un cambio del selector en el proyecto que usarán las conversaciones futuras', async () => {
    render(<Component />)
    await waitFor(() => expect(h.select).toHaveBeenCalled())
    await act(async () => {
      await h.dropdown.onAssistantChange?.('character:nara')
    })
    expect(h.updateFolder).toHaveBeenCalledWith(
      'owned-project',
      'Owned project',
      'character:nara'
    )
    await act(async () => {
      await h.dropdown.onAssistantChange?.('')
    })
    expect(h.updateFolder).toHaveBeenLastCalledWith(
      'owned-project',
      'Owned project',
      undefined
    )
  })
  it('recupera asistente y modelo previos si el cambio de proyecto no se guarda y deja el error al selector', async () => {
    render(<Component />)
    await waitFor(() => expect(h.select).toHaveBeenCalled())
    h.updateFolder.mockRejectedValueOnce(
      new Error('owned-project-write-failed')
    )
    await act(async () => {
      await expect(
        h.dropdown.onAssistantChange?.('character:nara')
      ).rejects.toThrow('owned-project-write-failed')
    })
    expect(h.select).toHaveBeenLastCalledWith('character:beto')
    expect(h.selectModel).toHaveBeenCalledWith('owned-provider', 'owned-model')
  })
  it('espera a que los proveedores estén disponibles antes de resolver un binding al entrar', async () => {
    h.providers = []
    const view = render(<Component />)
    expect(h.select).not.toHaveBeenCalled()
    h.providers = [{}]
    view.rerender(<Component />)
    await waitFor(() => expect(h.select).toHaveBeenCalledWith('character:beto'))
  })
})
