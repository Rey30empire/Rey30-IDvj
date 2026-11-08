import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriMCPService } from '../tauri'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockCore = {
  api: {
    saveMcpConfigs: vi.fn(),
    restartMcpServers: vi.fn(),
    getMcpConfigs: vi.fn(),
    getTools: vi.fn(),
    getConnectedServers: vi.fn(),
    callTool: vi.fn(),
    cancelToolCall: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { core: mockCore },
  writable: true,
})

describe('TauriMCPService – coverage', () => {
  let svc: TauriMCPService

  beforeEach(() => {
    svc = new TauriMCPService()
    vi.clearAllMocks()
  })

  describe('callToolWithCancellation', () => {
    it('returns promise, cancel fn, and token', () => {
      const mockResult = { error: '', content: [{ text: 'ok' }] }
      mockCore.api.callTool.mockResolvedValue(mockResult)
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: { foo: 'bar' },
      })

      expect(result.token).toBeDefined()
      expect(typeof result.cancel).toBe('function')
      expect(result.promise).toBeDefined()
    })

    it('uses provided cancellationToken', () => {
      mockCore.api.callTool.mockResolvedValue({ error: '', content: [] })

      const result = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: {},
        cancellationToken: 'my-token',
      })

      expect(result.token).toBe('my-token')
      expect(mockCore.api.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ cancellationToken: 'my-token' })
      )
    })

    it('cancel calls cancelToolCall with correct token', async () => {
      mockCore.api.callTool.mockResolvedValue({ error: '', content: [] })
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      const { cancel, token } = svc.callToolWithCancellation({
        toolName: 'test_tool',
        arguments: {},
      })

      await cancel()

      expect(mockCore.api.cancelToolCall).toHaveBeenCalledWith({
        cancellationToken: token,
      })
    })
  })

  describe('cancelToolCall', () => {
    it('calls cancelToolCall on window.core.api', async () => {
      mockCore.api.cancelToolCall.mockResolvedValue(undefined)

      await svc.cancelToolCall('token-123')

      expect(mockCore.api.cancelToolCall).toHaveBeenCalledWith({
        cancellationToken: 'token-123',
      })
    })
  })

  describe('activateMCPServer', () => {
    it('invokes activate_mcp_server with name and config', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      const config = { command: 'node', args: ['server.js'] }
      await svc.activateMCPServer('myServer', config as any)

      expect(invoke).toHaveBeenCalledWith('activate_mcp_server', {
        name: 'myServer',
        config,
      })
    })
  })

  describe('deactivateMCPServer', () => {
    it('invokes deactivate_mcp_server with name', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(undefined)

      await svc.deactivateMCPServer('myServer')

      expect(invoke).toHaveBeenCalledWith('deactivate_mcp_server', {
        name: 'myServer',
      })
    })
  })

  describe('checkRey30BrowserExtensionConnected', () => {
    it('invokes check_rey30_browser_extension_connected', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue(true)

      const result = await svc.checkRey30BrowserExtensionConnected()

      expect(invoke).toHaveBeenCalledWith('check_rey30_browser_extension_connected')
      expect(result).toBe(true)
    })
  })

  describe('getMCPConfig – additional branches', () => {
    it('handles config with mcpServers and mcpSettings keys', async () => {
      const config = {
        mcpServers: { fs: { command: 'fs-server' } },
        mcpSettings: { maxToolRoundtrips: 5 },
      }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({ fs: { command: 'fs-server' } })
      expect(result.mcpSettings).toEqual({
        ...DEFAULT_MCP_SETTINGS,
        maxToolRoundtrips: 5,
      })
    })

    it('preserves unknown envelope, settings and server fields through activation and a read/write roundtrip', async () => {
      const config = {
        mcpServers: { fs: { command: 'node', args: ['server.js'], active: false, customServer: { owner: 'kept' } } },
        mcpSettings: { ...DEFAULT_MCP_SETTINGS, customSetting: ['keep', 3] },
        customMetadata: { command: 'metadata, not a legacy server', nested: [1, null, { enabled: false }] },
        schemaVersion: 7,
        optionalMetadata: null,
      }
      mockCore.api.getMcpConfigs.mockResolvedValueOnce(JSON.stringify(config))
      const current = await svc.getMCPConfig()
      const next = { ...current, mcpServers: { ...current.mcpServers, fs: { ...current.mcpServers!.fs, active: true } } }
      mockCore.api.saveMcpConfigs.mockResolvedValueOnce(undefined)
      await svc.updateMCPConfig(JSON.stringify(next))
      const saved = mockCore.api.saveMcpConfigs.mock.calls.at(-1)![0].configs
      expect(JSON.parse(saved)).toEqual({ ...config, mcpServers: { fs: { ...config.mcpServers.fs, active: true } } })
      mockCore.api.getMcpConfigs.mockResolvedValueOnce(saved)
      expect(await svc.getMCPConfig()).toEqual(JSON.parse(saved))
      expect(Object.keys(next.mcpServers)).toEqual(['fs'])
    })

    it('normalizes legacy servers without duplicating their top-level entries when saved', async () => {
      const legacy = { myServer: { command: 'node', args: ['s.js'] }, mcpSettings: { maxToolOutputChars: 0 } }
      mockCore.api.getMcpConfigs.mockResolvedValueOnce(JSON.stringify(legacy))
      const normalized = await svc.getMCPConfig()
      mockCore.api.saveMcpConfigs.mockResolvedValueOnce(undefined)
      await svc.updateMCPConfig(JSON.stringify(normalized))
      const saved = JSON.parse(mockCore.api.saveMcpConfigs.mock.calls.at(-1)![0].configs)
      expect(saved).toEqual({ mcpServers: { myServer: legacy.myServer }, mcpSettings: { ...DEFAULT_MCP_SETTINGS, maxToolOutputChars: 0 } })
      expect(saved).not.toHaveProperty('myServer')
    })

    it.each([null, [], [{ command: 'node' }], 42, true, 'scalar'])('rejects non-object top-level shapes without treating them as legacy servers: %j', async (value) => {
      mockCore.api.getMcpConfigs.mockResolvedValueOnce(JSON.stringify(value))
      expect(await svc.getMCPConfig()).toEqual({ mcpServers: {}, mcpSettings: { ...DEFAULT_MCP_SETTINGS } })
      expect(mockCore.api.saveMcpConfigs).not.toHaveBeenCalled()
    })

    it('preserves envelope metadata while normalizing invalid settings shape', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValueOnce(JSON.stringify({ mcpServers: {}, mcpSettings: [], metadata: { retained: true } }))
      expect(await svc.getMCPConfig()).toEqual({ mcpServers: {}, mcpSettings: { ...DEFAULT_MCP_SETTINGS }, metadata: { retained: true } })
    })

    it('handles whitespace-only config string', async () => {
      mockCore.api.getMcpConfigs.mockResolvedValue('   ')

      const result = await svc.getMCPConfig()

      expect(result).toEqual({
        mcpServers: {},
        mcpSettings: { ...DEFAULT_MCP_SETTINGS },
      })
    })

    it('handles config with no mcpServers key (legacy format)', async () => {
      const legacy = { myServer: { command: 'node', args: ['s.js'] } }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(legacy))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual(legacy)
    })

    it('handles config where mcpServers is not an object', async () => {
      const config = { mcpServers: 'invalid', legacyServer: { command: 'x' } }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({ legacyServer: { command: 'x' } })
    })

    it('handles config where mcpSettings is not an object', async () => {
      const config = { mcpServers: {}, mcpSettings: 'invalid' }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpSettings).toEqual({ ...DEFAULT_MCP_SETTINGS })
    })

    it('returns empty servers when no legacy and mcpServers is null', async () => {
      const config = { mcpServers: null }
      mockCore.api.getMcpConfigs.mockResolvedValue(JSON.stringify(config))

      const result = await svc.getMCPConfig()

      expect(result.mcpServers).toEqual({})
    })
  })

  describe('OAuth', () => {
    it('forwards each command with the server name', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const status = {
        state: 'unauthenticated',
        canAuthenticate: true,
        hasCredentials: false,
        expiresAt: null,
      }
      vi.mocked(invoke).mockResolvedValueOnce(status)
      await expect(svc.getMCPAuthStatus('remote')).resolves.toEqual(status)
      expect(invoke).toHaveBeenCalledWith('get_mcp_auth_status', {
        name: 'remote',
      })

      vi.mocked(invoke).mockResolvedValueOnce(undefined)
      await svc.authorizeMCPServer('remote')
      expect(invoke).toHaveBeenCalledWith('authorize_mcp_server', {
        name: 'remote',
      })

      vi.mocked(invoke).mockResolvedValueOnce(true)
      await expect(svc.clearMCPAuth('remote')).resolves.toBe(true)
      expect(invoke).toHaveBeenCalledWith('clear_mcp_auth', { name: 'remote' })
    })
  })
})
