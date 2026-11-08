import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NavAssistants } from '../NavAssistants'

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  select: vi.fn(),
  removeThread: vi.fn(),
  threads: {} as Record<string, Thread>,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, activeProps: _activeProps, ...props }: {
    to: string
    params?: { threadId: string }
    activeProps?: unknown
  }) => <a href={to.replace('$threadId', params?.threadId ?? '')} {...props} />,
  useNavigate: () => state.navigate,
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) => select({ pathname: '/threads/current' }),
}))
vi.mock('@/hooks/useAssistant', () => ({ useAssistant: () => undefined }))
vi.mock('@/hooks/useThreads', () => ({ useThreads: (select: (store: object) => unknown) => select({ threads: state.threads }) }))
vi.mock('@/hooks/useAgentMode', () => ({ useAgentMode: { getState: () => ({ removeThread: state.removeThread }) } }))
vi.mock('@/hooks/useAvailableAssistants', () => ({ useAvailableAssistants: () => [{ id: 'character:kairo', name: 'Atlas' }] }))
vi.mock('@/stores/useCharacterStore', () => ({
  useCharacterStore: (select: (store: object) => unknown) => select({
    loaded: true,
    profiles: [{ id: 'kairo', baseId: 'kairo' }],
  }),
}))
vi.mock('@/lib/characters/assistant-integration', () => ({
  characterIdFromAssistantId: (id: string) => id.split(':')[1],
  selectIntegratedAssistant: state.select,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function mount() {
  render(<SidebarProvider><NavAssistants /></SidebarProvider>)
}

function chat(id: string, updated: number, metadata?: Thread['metadata']): Thread {
  return {
    id,
    title: id,
    updated,
    metadata,
    assistants: [{ id: 'character:kairo', name: 'Atlas', instructions: '', parameters: {}, created_at: 0 }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.threads = {}
  state.select.mockResolvedValue(undefined)
})

it('selects a new assistant without reassigning the currently open thread', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: /Atlas/ }))
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith({ to: '/', search: {} }))
  expect(state.select).toHaveBeenCalledWith('character:kairo')
  expect(state.removeThread).toHaveBeenCalledTimes(1)
})

it('reopens the most recent standalone chat and excludes project and temporary chats', () => {
  state.threads = {
    old: chat('old', 1),
    recent: chat('recent', 2),
    private: chat('private', 3, { isTemporary: true }),
    project: chat('project', 4, { project: { id: 'p', name: 'P', updated_at: 4 } }),
  }
  mount()
  expect(screen.getByRole('link', { name: /Atlas/ })).toHaveAttribute('href', '/threads/recent')
  expect(screen.getByRole('link', { name: 'assistants:manage' })).toHaveAttribute('href', '/settings/assistant')
  fireEvent.click(screen.getByRole('button', { name: 'assistants:title' }))
  expect(screen.queryByRole('link', { name: /Atlas/ })).toBeNull()
  expect(state.select).not.toHaveBeenCalled()
})
