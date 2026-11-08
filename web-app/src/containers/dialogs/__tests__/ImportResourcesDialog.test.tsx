import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportCandidate, ImportPlan } from '@/lib/resourceImport'

const api = vi.hoisted(() => ({
  scanResources: vi.fn(), commitResources: vi.fn(), githubStatus: vi.fn(), githubLogin: vi.fn(),
  githubPoll: vi.fn(), githubCancel: vi.fn(), githubRepos: vi.fn(), githubScan: vi.fn(),
  getMCPConfig: vi.fn(), updateMCPConfig: vi.fn(), activateMCPServer: vi.fn(), deactivateMCPServer: vi.fn(),
  getConnectedServers: vi.fn(), getTools: vi.fn(), openFolder: vi.fn(), refreshSubagents: vi.fn(), openExternalUrl: vi.fn(),
}))
vi.mock('@/lib/resourceImport', () => ({ ...api, RESOURCE_IMPORT_EVENT: 'rey30:resources-imported' }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/lib/coworkSubagentRegistry', () => ({ refreshSubagents: api.refreshSubagents }))
vi.mock('@/lib/externalLink', () => ({ openExternalUrl: api.openExternalUrl }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ mcp: () => api, dialog: () => ({ open: api.openFolder }) }),
  getServiceHub: () => ({ mcp: () => api }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => key + (values ? ':' + Object.values(values).join(',') : '') }),
}))
import ImportResourcesDialog from '../ImportResourcesDialog'
import { useMCPServers } from '@/hooks/useMCPServers'

const candidate = (id: string, kind: ImportCandidate['kind'], overrides: Partial<ImportCandidate> = {}): ImportCandidate => ({
  id, kind, name: id, description: 'Description ' + id, source: 'Editor', sourcePath: 'C:/editor/' + id,
  preview: '<script>source only</script>', warnings: [], conflict: false, importable: true, ...overrides,
})
const plan: ImportPlan = { id: 'plan-1', candidates: [candidate('Notes', 'mcp'), candidate('review', 'skill'), candidate('unsupported', 'instruction', { importable: false })], warnings: ['Read-only preview'] }
const server = { command: 'node', args: ['tool.js'], env: {}, active: false }
const renderDialog = (props = {}) => render(<ImportResourcesDialog open onOpenChange={vi.fn()} {...props} />)
const detect = async () => {
  fireEvent.click(screen.getByText('integrations:detect'))
  await screen.findByRole('checkbox', { name: 'integrations:selectNamed:Notes' })
}

describe('resource import review and commit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.scanResources.mockResolvedValue(plan)
    api.commitResources.mockResolvedValue({ installed: [{ id: 'Notes', kind: 'mcp', name: 'Notes', path: 'C:/data/mcp_config.json' }], warnings: [], errors: [] })
    api.getMCPConfig.mockResolvedValue({ mcpServers: { Existing: { ...server, active: true }, Notes: server } })
    api.updateMCPConfig.mockResolvedValue(undefined)
    api.activateMCPServer.mockResolvedValue(undefined)
    api.deactivateMCPServer.mockResolvedValue(undefined)
    api.getConnectedServers.mockResolvedValue(['Notes'])
    api.getTools.mockResolvedValue([{ name: 'read', server: 'Notes' }, { name: 'other', server: 'Existing' }])
    api.githubStatus.mockResolvedValue({ available: true, authenticated: false })
    api.githubRepos.mockResolvedValue({ repos: [{ fullName: 'rey30/REA', description: 'Repo', private: true, defaultBranch: 'main' }], page: 1, hasMore: true })
    api.githubCancel.mockResolvedValue(undefined)
    useMCPServers.setState({ mcpServers: { Existing: { ...server, active: true } } })
  })

  it('does not scan, select or install automatically and renders previews as plain text', async () => {
    renderDialog()
    expect(api.scanResources).not.toHaveBeenCalled()
    expect(api.commitResources).not.toHaveBeenCalled()
    await detect()
    expect(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'integrations:selectNamed:unsupported' })).toBeDisabled()
    expect(screen.getByLabelText('integrations:preview')).toHaveTextContent('<script>source only</script>')
    expect(document.querySelector('script')).toBeNull()
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('opens GitHub only when requested and does not reconnect it when reopening local resources', async () => {
    const view = renderDialog({ initialSource: 'github' })
    await screen.findByRole('button', { name: 'integrations:connect' })
    expect(api.githubStatus).toHaveBeenCalledTimes(1)
    view.rerender(<ImportResourcesDialog open={false} onOpenChange={vi.fn()} initialSource="github" />)
    api.githubStatus.mockClear()
    view.rerender(<ImportResourcesDialog open onOpenChange={vi.fn()} initialSource="local" />)
    await screen.findByRole('button', { name: 'integrations:detect' })
    expect(api.githubStatus).not.toHaveBeenCalled()
    expect(api.githubLogin).not.toHaveBeenCalled()
  })

  it('commits only the reviewed selection and refreshes saved MCP without connecting by default', async () => {
    const onImported = vi.fn()
    const imported = vi.fn()
    window.addEventListener('rey30:resources-imported', imported)
    renderDialog({ onImported })
    await detect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' }))
    expect(screen.getByRole('checkbox', { name: 'integrations:connectAfterImport' })).not.toBeChecked()
    fireEvent.click(screen.getByText('integrations:prepareSelected:1'))
    await screen.findByText('integrations:mcpInactive')
    expect(api.commitResources).toHaveBeenCalledWith('plan-1', ['Notes'])
    expect(api.getMCPConfig).toHaveBeenCalledTimes(1)
    expect(api.activateMCPServer).not.toHaveBeenCalled()
    expect(api.updateMCPConfig).not.toHaveBeenCalled()
    expect(useMCPServers.getState().mcpServers.Existing.active).toBe(true)
    expect(useMCPServers.getState().mcpServers.Notes.active).toBe(false)
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(imported).toHaveBeenCalledTimes(1)
    window.removeEventListener('rey30:resources-imported', imported)
  })

  it('connects only after explicit opt-in, verifies tools, and preserves other saved configurations', async () => {
    api.getMCPConfig.mockResolvedValueOnce({ mcpServers: { Existing: { ...server, active: true }, Notes: server } })
      .mockResolvedValueOnce({ mcpServers: { Existing: { ...server, active: true }, Notes: server } })
      .mockResolvedValueOnce({ mcpServers: { Existing: { ...server, args: ['updated.js'], active: true }, AddedInBackground: server, Notes: server } })
    renderDialog()
    await detect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:connectAfterImport' }))
    expect(api.activateMCPServer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('integrations:prepareAndConnect:1'))
    await screen.findByText('integrations:mcpConnected:Notes,1')
    expect(api.activateMCPServer).toHaveBeenCalledWith('Notes', { ...server, active: true })
    expect(api.getConnectedServers).toHaveBeenCalledTimes(1)
    expect(api.getTools).toHaveBeenCalledTimes(1)
    const persisted = JSON.parse(api.updateMCPConfig.mock.calls[0][0])
    expect(persisted.mcpServers.Existing).toEqual({ ...server, args: ['updated.js'], active: true })
    expect(persisted.mcpServers.AddedInBackground).toEqual(server)
    expect(persisted.mcpServers.Notes.active).toBe(true)
    expect(useMCPServers.getState().mcpServers.Notes.active).toBe(true)
  })

  it('does not report readiness when connection verification fails', async () => {
    api.getConnectedServers.mockResolvedValue([])
    renderDialog()
    await detect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:connectAfterImport' }))
    fireEvent.click(screen.getByText('integrations:prepareAndConnect:1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('integrations:notConnectedMCP:Notes')
    expect(api.deactivateMCPServer).toHaveBeenCalledWith('Notes')
    expect(api.updateMCPConfig).not.toHaveBeenCalled()
    expect(useMCPServers.getState().mcpServers.Notes.active).toBe(false)
    expect(screen.queryByText(/integrations:mcpConnected/)).not.toBeInTheDocument()
  })

  it('stops a checked server and leaves it disabled when persisting activation fails', async () => {
    api.updateMCPConfig.mockRejectedValue(new Error('disk full'))
    renderDialog()
    await detect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:connectAfterImport' }))
    fireEvent.click(screen.getByText('integrations:prepareAndConnect:1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(api.deactivateMCPServer).toHaveBeenCalledWith('Notes')
    expect(useMCPServers.getState().mcpServers.Notes.active).toBe(false)
    expect(screen.queryByText(/integrations:mcpConnected/)).not.toBeInTheDocument()
  })

  it('retains the review when commit fails and reports the backend error', async () => {
    api.commitResources.mockRejectedValue(new Error('source changed; scan again'))
    renderDialog()
    await detect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' }))
    fireEvent.click(screen.getByText('integrations:prepareSelected:1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('source changed; scan again')
    expect(screen.getByRole('checkbox', { name: 'integrations:selectNamed:Notes' })).toBeChecked()
    expect(api.getMCPConfig).not.toHaveBeenCalled()
  })

  it('ignores a scan response after the dialog closes', async () => {
    let finish!: (next: ImportPlan) => void
    api.scanResources.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = renderDialog()
    fireEvent.click(screen.getByText('integrations:detect'))
    view.rerender(<ImportResourcesDialog open={false} onOpenChange={vi.fn()} />)
    await act(async () => finish(plan))
    view.rerender(<ImportResourcesDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('scans a chosen folder without installing anything', async () => {
    api.openFolder.mockResolvedValue('C:/editor')
    renderDialog({ projectPath: 'C:/project' })
    fireEvent.click(screen.getByText('integrations:chooseFolder'))
    await waitFor(() => expect(api.scanResources).toHaveBeenCalledWith({ projectPath: 'C:/project', path: 'C:/editor' }))
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('analyzes the explicit local path only after submitting it', async () => {
    renderDialog({ projectPath: 'C:/project' })
    const analyze = screen.getByRole('button', { name: 'integrations:analyzePath' })
    expect(analyze).toBeDisabled()
    fireEvent.change(screen.getByLabelText('integrations:localPath'), { target: { value: '  C:/custom/SKILL.md  ' } })
    expect(api.scanResources).not.toHaveBeenCalled()
    fireEvent.click(analyze)
    await waitFor(() => expect(api.scanResources).toHaveBeenCalledWith({ path: 'C:/custom/SKILL.md' }))
    await screen.findByRole('checkbox', { name: 'integrations:selectNamed:Notes' })
    expect(api.openFolder).not.toHaveBeenCalled()
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('handles a cancelled file picker and scans a selected supported file without installing it', async () => {
    api.openFolder.mockResolvedValueOnce(null).mockResolvedValueOnce('C:/custom/mcp.json')
    renderDialog()
    const chooseFile = screen.getByRole('button', { name: 'integrations:chooseFile' })
    fireEvent.click(chooseFile)
    await waitFor(() => expect(chooseFile).not.toBeDisabled())
    expect(api.scanResources).not.toHaveBeenCalled()
    fireEvent.click(chooseFile)
    await waitFor(() => expect(api.scanResources).toHaveBeenCalledWith({ projectPath: undefined, path: 'C:/custom/mcp.json' }))
    expect(api.openFolder).toHaveBeenCalledWith({ directory: false, multiple: false, filters: [{ name: 'integrations:resourceFiles', extensions: ['md', 'mdc', 'json', 'toml'] }] })
    expect(screen.getByLabelText('integrations:localPath')).toHaveValue('C:/custom/mcp.json')
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('lists account repositories, paginates and inspects the selected repository before committing', async () => {
    api.githubStatus.mockResolvedValue({ available: true, authenticated: true, login: 'rey30' })
    api.githubScan.mockResolvedValue(plan)
    renderDialog()
    fireEvent.click(screen.getByText('GitHub'))
    await screen.findByText('rey30/REA')
    expect(api.githubRepos).toHaveBeenCalledWith(1)
    api.githubRepos.mockResolvedValue({ repos: [{ fullName: 'rey30/second', description: '', private: false, defaultBranch: 'main' }], page: 2, hasMore: false })
    fireEvent.click(screen.getByText('integrations:loadMore'))
    await screen.findByText('rey30/second')
    expect(api.githubRepos).toHaveBeenLastCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'integrations:reviewNamedRepo:rey30/REA' }))
    await screen.findByRole('checkbox', { name: 'integrations:selectNamed:Notes' })
    expect(api.githubScan).toHaveBeenCalledWith('rey30/REA')
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('shows the real device code and cancels the native authorization session on close', async () => {
    api.githubLogin.mockResolvedValue({ id: 'auth-1', status: 'pending', code: 'ABCD-EFGH', url: 'https://github.com/login/device' })
    const view = renderDialog()
    fireEvent.click(screen.getByText('GitHub'))
    fireEvent.click(await screen.findByText('integrations:connect'))
    await screen.findByText('ABCD-EFGH')
    fireEvent.click(screen.getByText('integrations:openAuthorization'))
    expect(api.openExternalUrl).toHaveBeenCalledWith('https://github.com/login/device')
    view.rerender(<ImportResourcesDialog open={false} onOpenChange={vi.fn()} />)
    await waitFor(() => expect(api.githubCancel).toHaveBeenCalledWith('auth-1'))
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('loads the authorized account repositories after polling reports completion', async () => {
    api.githubLogin.mockResolvedValue({ id: 'auth-1', status: 'pending', code: 'ABCD-EFGH', url: 'https://github.com/login/device' })
    api.githubPoll.mockResolvedValue({ id: 'auth-1', status: 'complete' })
    api.githubStatus.mockResolvedValueOnce({ available: true, authenticated: false })
      .mockResolvedValue({ available: true, authenticated: true, login: 'rey30' })
    renderDialog()
    fireEvent.click(screen.getByText('GitHub'))
    fireEvent.click(await screen.findByText('integrations:connect'))
    await screen.findByText('ABCD-EFGH')
    expect(screen.getByRole('button', { name: 'integrations:reviewRepository' })).toBeDisabled()
    await screen.findByRole('button', { name: 'integrations:reviewNamedRepo:rey30/REA' }, { timeout: 5000 })
    expect(api.githubPoll).toHaveBeenCalledWith('auth-1')
    expect(api.githubRepos).toHaveBeenCalledWith(1)
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('clears the pending authorization session when native polling reports cancellation', async () => {
    api.githubLogin.mockResolvedValue({ id: 'auth-1', status: 'pending', code: 'ABCD-EFGH', url: 'https://github.com/login/device' })
    api.githubPoll.mockResolvedValue({ id: 'auth-1', status: 'cancelled', code: 'stale-code', message: 'Authorization cancelled in GitHub CLI' })
    const view = renderDialog()
    fireEvent.click(screen.getByText('GitHub'))
    fireEvent.click(await screen.findByText('integrations:connect'))
    await screen.findByText('ABCD-EFGH')
    expect(await screen.findByText('Authorization cancelled in GitHub CLI', {}, { timeout: 5000 })).toHaveAttribute('role', 'status')
    expect(screen.queryByText('ABCD-EFGH')).not.toBeInTheDocument()
    expect(screen.queryByText('stale-code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'integrations:connect' })).not.toBeDisabled()
    view.unmount()
    expect(api.githubCancel).not.toHaveBeenCalled()
    expect(api.githubRepos).not.toHaveBeenCalled()
  })
})
