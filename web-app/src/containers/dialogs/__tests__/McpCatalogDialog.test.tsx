import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogReview, CatalogServer } from '@/lib/mcpCatalog'
import { OPENCLAW_MCP_TEMPLATE } from '@/lib/mcpCatalog'

const api = vi.hoisted(() => ({
  listMcpCatalog: vi.fn(),
  reviewMcpCatalog: vi.fn(),
  configureMcpCatalog: vi.fn(),
  commitResources: vi.fn(),
  getMCPConfig: vi.fn(),
  activateMCPServer: vi.fn(),
  deactivateMCPServer: vi.fn(),
  getConnectedServers: vi.fn(),
  getToolsForServers: vi.fn(),
  updateMCPConfig: vi.fn(),
  authorize: vi.fn(),
  clearAuth: vi.fn(),
  refresh: vi.fn(),
  listen: vi.fn(),
}))
vi.mock('@/lib/mcpCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcpCatalog')>()),
  ...api,
}))
vi.mock('@/lib/resourceImport', () => ({
  commitResources: api.commitResources,
  RESOURCE_IMPORT_EVENT: 'owned:resources-imported',
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ mcp: () => api, events: () => api }),
}))
vi.mock('@/hooks/useMcpAuth', () => ({
  useMcpAuth: () => ({
    statuses: {
      owned: {
        state: 'unauthenticated',
        canAuthenticate: true,
        hasCredentials: false,
        expiresAt: null,
        renewable: false,
      },
    },
    authorizing: {},
    consentUrls: {},
    authorize: api.authorize,
    clearAuth: api.clearAuth,
    refresh: api.refresh,
  }),
  needsAuthDetail: (error: unknown) =>
    typeof error === 'string' && error.startsWith('NEEDS_AUTH: ')
      ? error.slice(12)
      : null,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key + (values ? ':' + Object.values(values).join(',') : ''),
  }),
}))
import McpCatalogDialog from '../McpCatalogDialog'

const server: CatalogServer = {
  name: 'io.fixture/catalog',
  title: 'Owned fixture',
  description: '<script>metadata only</script>',
  version: '1.0.0',
  transports: ['streamable-http'],
  packages: [],
  status: 'active',
}
const review: CatalogReview = {
  server,
  parameters: [],
  alternatives: [{ candidateId: 'candidate', remote: true, requirements: [] }],
  plan: {
    id: 'plan',
    warnings: ['Review supplier trust'],
    candidates: [
      {
        id: 'candidate',
        kind: 'mcp',
        name: 'owned',
        description: 'Owned endpoint',
        source: 'official registry',
        sourcePath: 'metadata',
        preview: 'https://fixture.invalid/mcp',
        warnings: [],
        conflict: false,
        importable: true,
      },
    ],
  },
}
const config = {
  mcpServers: {
    existing: { command: 'owned', args: [], env: {}, active: false },
    owned: {
      command: '',
      args: [],
      env: {},
      type: 'http',
      url: 'https://fixture.invalid/mcp',
      active: false,
    },
  },
  mcpSettings: { future: { keep: true } },
  customFlag: { keep: true },
}
const inspect = async () => {
  await screen.findByText('Owned fixture')
  fireEvent.click(
    screen.getByRole('button', {
      name: 'mcp-servers:catalog.browser.reviewServer:Owned fixture',
    })
  )
  await screen.findByTestId('mcp-catalog-review')
}
const install = async () => {
  await inspect()
  fireEvent.click(screen.getByTestId('mcp-catalog-install'))
  await screen.findByTestId('mcp-catalog-installed')
}

describe('official MCP catalog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.listMcpCatalog.mockResolvedValue({
      servers: [server],
      nextCursor: 'opaque cursor',
    })
    api.reviewMcpCatalog.mockResolvedValue(review)
    api.commitResources.mockResolvedValue({
      installed: [
        { id: 'candidate', kind: 'mcp', name: 'owned', path: 'owned-config' },
      ],
      errors: [],
      warnings: [],
    })
    api.getMCPConfig.mockResolvedValue(config)
    api.getConnectedServers.mockResolvedValue(['owned'])
    api.getToolsForServers.mockResolvedValue([
      { name: 'owned_tool', server: 'owned' },
    ])
    api.activateMCPServer.mockResolvedValue(undefined)
    api.updateMCPConfig.mockResolvedValue(undefined)
    api.configureMcpCatalog.mockResolvedValue(undefined)
    api.authorize.mockResolvedValue(undefined)
    api.listen.mockResolvedValue(vi.fn())
  })

  it('saves the local OpenClaw bridge through the review flow even when the registry is offline', async () => {
    api.listMcpCatalog.mockRejectedValueOnce(new Error('Registry offline'))
    api.reviewMcpCatalog.mockResolvedValueOnce({
      ...review,
      server: { ...server, ...OPENCLAW_MCP_TEMPLATE, title: 'OpenClaw' },
      alternatives: [{ candidateId: 'candidate', remote: false, requirements: [] }],
    })
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Registry offline')
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:openClaw.review' }))
    await screen.findByTestId('mcp-catalog-review')
    expect(api.reviewMcpCatalog).toHaveBeenCalledWith(
      OPENCLAW_MCP_TEMPLATE.name, OPENCLAW_MCP_TEMPLATE.version, {}
    )
    expect(screen.getByRole('link', { name: 'mcp-servers:openClaw.installGuide' }))
      .toHaveAttribute('href', 'https://docs.openclaw.ai/install')
    fireEvent.click(screen.getByRole('button', { name: 'mcp-servers:openClaw.save' }))
    await screen.findByText('mcp-servers:openClaw.saved')
    expect(api.commitResources).toHaveBeenCalledWith('plan', ['candidate'])
    expect(api.activateMCPServer).not.toHaveBeenCalled()
  })

  it('loads metadata only, paginates with the opaque cursor, and enforces minimum search', async () => {
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned fixture')
    expect(api.listMcpCatalog).toHaveBeenCalledWith('', undefined)
    expect(api.commitResources).not.toHaveBeenCalled()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByText('mcp-servers:catalog.loadMore'))
    await waitFor(() =>
      expect(api.listMcpCatalog).toHaveBeenCalledWith('', 'opaque cursor')
    )
    fireEvent.change(screen.getByTestId('mcp-catalog-search'), {
      target: { value: 'ab' },
    })
    expect(screen.getByText('mcp-servers:catalog.search')).toBeDisabled()
  })

  it('reviews an exact version, installs only on confirmation, and connects only when requested', async () => {
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await install()
    expect(api.reviewMcpCatalog).toHaveBeenCalledWith(server.name, '1.0.0', {})
    expect(api.commitResources).toHaveBeenCalledWith('plan', ['candidate'])
    expect(api.activateMCPServer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('mcp-catalog-connect'))
    await screen.findByText('mcp-servers:catalog.connected:1')
    expect(api.getToolsForServers).toHaveBeenCalledWith(['owned'])
    const saved = JSON.parse(api.updateMCPConfig.mock.calls[0][0])
    expect(saved.customFlag).toEqual(config.customFlag)
    expect(saved.mcpSettings).toEqual(config.mcpSettings)
    expect(saved.mcpServers.existing).toEqual(config.mcpServers.existing)
    expect(saved.mcpServers.owned.active).toBe(true)
  })

  it('requests missing credentials after installation and never sends their values to config writers', async () => {
    api.reviewMcpCatalog.mockResolvedValue({
      ...review,
      alternatives: [
        {
          candidateId: 'candidate',
          remote: true,
          requirements: [
            {
              field: 'headers',
              key: 'Authorization',
              description: 'Owned service token',
              secret: true,
              required: true,
            },
          ],
        },
      ],
    })
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await install()
    expect(screen.getByTestId('mcp-catalog-connect')).toBeDisabled()
    const field = screen.getByLabelText('Authorization *')
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.change(field, { target: { value: 'owned-secret-nonce' } })
    fireEvent.click(screen.getByText('mcp-servers:catalog.saveCredentials'))
    await screen.findByText('mcp-servers:catalog.credentialsSaved')
    expect(api.configureMcpCatalog).toHaveBeenCalledWith('owned', [
      { field: 'headers', key: 'Authorization', value: 'owned-secret-nonce' },
    ])
    expect(api.updateMCPConfig).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('owned-secret-nonce')).toBeNull()
    expect(screen.getByTestId('mcp-catalog-connect')).not.toBeDisabled()
  })

  it('uses the real OAuth service contract only after the user requests sign-in', async () => {
    api.activateMCPServer.mockRejectedValue('NEEDS_AUTH: owned challenge')
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await install()
    fireEvent.click(screen.getByTestId('mcp-catalog-connect'))
    await screen.findByText('mcp-servers:catalog.authorizationRequired')
    expect(api.authorize).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('mcp-servers:auth.authenticate'))
    await screen.findByText('mcp-servers:catalog.authorized')
    expect(api.authorize).toHaveBeenCalledWith('owned')
    expect(api.updateMCPConfig).not.toHaveBeenCalled()
  })

  it('repeats a review after entering public URL or argument parameters', async () => {
    api.reviewMcpCatalog.mockResolvedValue({
      ...review,
      parameters: [
        {
          id: 'remote/tenant',
          label: 'Tenant',
          description: 'Public tenant',
          required: true,
          choices: ['owned'],
          defaultValue: '',
        },
      ],
    })
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await inspect()
    fireEvent.change(screen.getByLabelText('Tenant'), {
      target: { value: 'owned' },
    })
    expect(screen.getByTestId('mcp-catalog-install')).toBeDisabled()
    fireEvent.click(screen.getByText('mcp-servers:catalog.updateReview'))
    await waitFor(() =>
      expect(api.reviewMcpCatalog).toHaveBeenLastCalledWith(
        server.name,
        '1.0.0',
        { 'remote/tenant': 'owned' }
      )
    )
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('does not install a late review response after the dialog closes', async () => {
    let complete!: (value: CatalogReview) => void
    api.reviewMcpCatalog.mockReturnValue(
      new Promise<CatalogReview>((resolve) => {
        complete = resolve
      })
    )
    const view = render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned fixture')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'mcp-servers:catalog.browser.reviewServer:Owned fixture',
      })
    )
    view.rerender(<McpCatalogDialog open={false} onOpenChange={vi.fn()} />)
    await act(async () => complete(review))
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('groups only returned metadata and filters categories without inventing integrations', async () => {
    api.listMcpCatalog.mockResolvedValue({
      servers: [
        server,
        {
          ...server,
          name: 'io.fixture/db',
          title: 'Owned database',
          description: 'Read a database',
        },
      ],
      nextCursor: null,
    })
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned database')
    expect(screen.getAllByTestId('mcp-registry-card')).toHaveLength(2)
    const select = screen.getByRole('combobox', {
      name: 'mcp-servers:catalog.browser.category',
    })
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    expect(screen.queryByText('Google Drive')).toBeNull()
    expect(screen.queryByText('Microsoft Teams')).toBeNull()
    fireEvent.change(select, { target: { value: 'data' } })
    expect(screen.getAllByTestId('mcp-registry-card')).toHaveLength(1)
    expect(screen.queryByText('Owned fixture')).toBeNull()
    expect(
      screen.getByText('mcp-servers:catalog.browser.categoryHint:2')
    ).toBeVisible()
    expect(api.reviewMcpCatalog).not.toHaveBeenCalled()
  })

  it('uses runtime state rather than active flags and preserves configuration when connecting a saved server', async () => {
    api.getMCPConfig.mockResolvedValue({
      ...config,
      mcpServers: {
        ...config.mcpServers,
        existing: { ...config.mcpServers.existing, active: true },
      },
    })
    const manage = vi.fn()
    render(
      <McpCatalogDialog
        open
        presentation="page"
        onOpenChange={vi.fn()}
        onManageServer={manage}
      />
    )
    await screen.findByText('Owned fixture')
    fireEvent.click(
      screen.getByRole('button', {
        name: /^mcp-servers:catalog.browser.connections/,
      })
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('mcp-saved-card')).toHaveLength(2)
    )
    const saved = screen.getAllByTestId('mcp-saved-card')
    const inactiveButConnected = saved.find(
      (item) => item.dataset.serverName === 'owned'
    )!
    const activeButOffline = saved.find(
      (item) => item.dataset.serverName === 'existing'
    )!
    expect(
      within(inactiveButConnected).getByRole('button', {
        name: 'mcp-servers:catalog.browser.disconnect',
      })
    ).toBeEnabled()
    fireEvent.click(
      within(activeButOffline).getByRole('button', {
        name: 'mcp-servers:catalog.browser.manage',
      })
    )
    expect(manage).toHaveBeenCalledWith('existing')
    api.getConnectedServers.mockResolvedValue(['owned', 'existing'])
    fireEvent.click(
      within(activeButOffline).getByRole('button', {
        name: 'mcp-servers:catalog.browser.connect',
      })
    )
    await screen.findByText('mcp-servers:catalog.connected:1')
    expect(api.activateMCPServer).toHaveBeenCalledWith(
      'existing',
      expect.objectContaining({ active: true })
    )
    const persisted = JSON.parse(api.updateMCPConfig.mock.calls.at(-1)![0])
    expect(persisted.customFlag).toEqual(config.customFlag)
    expect(persisted.mcpSettings).toEqual(config.mcpSettings)
    expect(persisted.mcpServers.owned).toEqual(config.mcpServers.owned)
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('disconnects a live server and persists only its active flag without losing future metadata', async () => {
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned fixture')
    fireEvent.click(
      screen.getByRole('button', {
        name: /^mcp-servers:catalog.browser.connections/,
      })
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('mcp-saved-card')).toHaveLength(2)
    )
    api.getConnectedServers.mockResolvedValue([])
    fireEvent.click(
      screen.getByRole('button', {
        name: 'mcp-servers:catalog.browser.disconnect',
      })
    )
    await screen.findByText(
      'mcp-servers:catalog.browser.disconnectedMessage:owned'
    )
    expect(api.deactivateMCPServer).toHaveBeenCalledWith('owned')
    const persisted = JSON.parse(api.updateMCPConfig.mock.calls.at(-1)![0])
    expect(persisted).toEqual(config)
    expect(
      screen.queryByRole('button', {
        name: 'mcp-servers:catalog.browser.disconnect',
      })
    ).toBeNull()
  })

  it('keeps saved connections accessible when the registry fails and never presents an unknown state as connected', async () => {
    api.listMcpCatalog.mockRejectedValue(new Error('Registry unavailable'))
    api.getConnectedServers.mockRejectedValue(new Error('Runtime unavailable'))
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Registry unavailable')
    fireEvent.click(
      screen.getByRole('button', {
        name: /^mcp-servers:catalog.browser.connections/,
      })
    )
    await screen.findByText('Runtime unavailable')
    const cards = screen.getAllByTestId('mcp-saved-card')
    expect(cards).toHaveLength(2)
    cards.forEach((card) => {
      expect(
        within(card).getByText('mcp-servers:catalog.browser.unknown')
      ).toBeVisible()
      expect(
        within(card).getByRole('button', {
          name: 'mcp-servers:catalog.browser.connect',
        })
      ).toBeDisabled()
    })
    expect(api.activateMCPServer).not.toHaveBeenCalled()
    expect(api.authorize).not.toHaveBeenCalled()
  })

  it('rolls back a connection if runtime confirmation fails and does not persist a false positive', async () => {
    api.getConnectedServers.mockResolvedValue([])
    render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned fixture')
    fireEvent.click(
      screen.getByRole('button', {
        name: /^mcp-servers:catalog.browser.connections/,
      })
    )
    await waitFor(() =>
      expect(screen.getAllByTestId('mcp-saved-card')).toHaveLength(2)
    )
    const card = screen
      .getAllByTestId('mcp-saved-card')
      .find((item) => item.dataset.serverName === 'existing')!
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'mcp-servers:catalog.browser.connect',
      })
    )
    await screen.findByText('mcp-servers:catalog.connectionFailed')
    expect(api.deactivateMCPServer).toHaveBeenCalledWith('existing')
    expect(api.updateMCPConfig).not.toHaveBeenCalled()
  })

  it.each([
    { conflict: true, importable: true },
    { conflict: false, importable: false },
  ])(
    'does not offer install for an unresolved or conflicting review: %j',
    async (flags) => {
      api.reviewMcpCatalog.mockResolvedValue({
        ...review,
        plan: {
          ...review.plan,
          candidates: review.plan.candidates.map((item) => ({
            ...item,
            ...flags,
          })),
        },
      })
      render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
      await inspect()
      expect(screen.getByTestId('mcp-catalog-install')).toBeDisabled()
      expect(api.commitResources).not.toHaveBeenCalled()
    }
  )

  it('exposes the existing custom-server action in the page header', async () => {
    const add = vi.fn()
    render(
      <McpCatalogDialog
        open
        presentation="page"
        onOpenChange={vi.fn()}
        onAddCustom={add}
      />
    )
    await screen.findByText('Owned fixture')
    fireEvent.click(
      screen.getByRole('button', {
        name: 'mcp-servers:catalog.browser.addCustom',
      })
    )
    expect(add).toHaveBeenCalledOnce()
    expect(api.commitResources).not.toHaveBeenCalled()
  })

  it('releases an event subscription that finishes after the dialog has closed and reopened', async () => {
    let subscribe!: (stop: () => void) => void
    const stop = vi.fn()
    api.listen.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        subscribe = resolve
      })
    )
    const view = render(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await screen.findByText('Owned fixture')
    view.rerender(<McpCatalogDialog open={false} onOpenChange={vi.fn()} />)
    view.rerender(<McpCatalogDialog open onOpenChange={vi.fn()} />)
    await act(async () => subscribe(stop))
    expect(stop).toHaveBeenCalledOnce()
  })
})
