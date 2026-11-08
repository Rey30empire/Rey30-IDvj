import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import ChatSkillsMenu from '../ChatSkillsMenu'
import { MASTER_PREFERENCE_KEY, useMasterOrchestrator } from '@/lib/masterOrchestrator'

const state = vi.hoisted(() => ({ skills: [] as { name: string; description: string; user_invocable: boolean }[], setPrompt: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))
vi.mock('@/hooks/useSkills', () => ({ useSkills: () => ({ skills: state.skills }) }))
vi.mock('@/hooks/usePrompt', () => ({ usePrompt: (selector: (value: unknown) => unknown) => selector({ prompt: 'argumento existente', setPrompt: state.setPrompt }) }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/containers/dialogs/SkillsManagerDialog', () => ({ default: ({ open, folderOverride }: { open: boolean; folderOverride?: string | null }) => open ? <div data-testid="global-skill-manager">{folderOverride === null ? 'global' : 'wrong-scope'}</div> : null }))
vi.mock('@/containers/PrivacyControl', () => ({ default: () => <span>Privacidad</span> }))

async function menu() {
  const user = userEvent.setup()
  screen.getByRole('button', { name: 'master:skills' }).focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('menu')
  return user
}

describe('classic chat automatic skills control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.skills = []
    useMasterOrchestrator.setState({ automatic: true, loaded: true, saving: false, preferenceError: false, error: null, last: null })
    vi.mocked(invoke).mockResolvedValue(null)
  })

  it('offers the persisted automatic preference even before any manual skills exist', async () => {
    render(<ChatSkillsMenu />)
    const user = await menu()
    const automatic = screen.getByRole('menuitemcheckbox', { name: 'master:automatic' })
    expect(automatic).toHaveAttribute('aria-checked', 'true')
    await user.click(automatic)
    await waitFor(() => expect(useMasterOrchestrator.getState().automatic).toBe(false))
    expect(invoke).toHaveBeenCalledWith('settings_set', { key: MASTER_PREFERENCE_KEY, value: '{"automatic":false}' })
    expect(invoke).toHaveBeenCalledWith('settings_commit')
  })

  it('retains a visible error without showing backend details and preserves manual selection', async () => {
    state.skills = [{ name: 'review', description: 'Revisión', user_invocable: true }]
    useMasterOrchestrator.setState({ error: 'read', last: { mode: 'error', skills: [] } })
    render(<ChatSkillsMenu />)
    const user = await menu()
    expect(screen.getByRole('alert')).toHaveTextContent('master:errors.read')
    await user.click(screen.getByRole('menuitem', { name: /review/ }))
    expect(state.setPrompt).toHaveBeenCalledWith('/skill:review argumento existente')
  })

  it('reads actual pack status and opens the existing global skill editor', async () => {
    vi.mocked(invoke).mockResolvedValue({ version: '1', items: [{ id: 'guide', label: 'Guía local', kind: 'framework-guide', origin: 'integration-guide', source: 'Documento local', license: 'MIT', requires: ['Programa externo'], aliases: [], triggers: [], skillNames: ['guide'], agentName: 'reviewer', status: 'modified' }], warnings: ['Aviso real'] })
    render(<ChatSkillsMenu />)
    const user = await menu()
    await user.click(screen.getByRole('menuitem', { name: 'master:manage' }))
    await screen.findByText('Guía local')
    expect(invoke).toHaveBeenCalledWith('rey30_skill_pack_status')
    expect(screen.getByText('Aviso real')).toBeVisible()
    expect(screen.getByText(/Programa externo/)).toBeVisible()
    expect(screen.getByText('master:modified')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'master:editSkills' }))
    expect(await screen.findByTestId('global-skill-manager')).toHaveTextContent('global')
  })
})
