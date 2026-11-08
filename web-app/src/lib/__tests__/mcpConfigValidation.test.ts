import { describe, expect, it } from 'vitest'
import { validateMCPConfigJson } from '../mcpConfigValidation'

describe('MCP JSON validation', () => {
  it.each([null, [], true, 3, 'servers', { mcpServers: [] }, { mcpSettings: {} }, { broken: null }, { broken: 1 }])(
    'rejects invalid configuration shapes before they can replace saved servers: %j', (value) => {
      expect(() => validateMCPConfigJson(value, 'all')).toThrow()
    }
  )

  it.each([
    { args: ['one'] },
    { command: 'node', args: [3] },
    { command: 'node', env: { TOKEN: 5 } },
    { command: 'node', headers: [] },
    { command: 'node', active: 'false' },
    { command: 'node', type: 'invalid' },
    { type: 'http', url: 'file:///config.json' },
    { type: 'sse', url: 'not-a-url' },
  ])('rejects malformed server fields: %j', (server) => {
    expect(() => validateMCPConfigJson({ server }, 'all')).toThrow()
    expect(() => validateMCPConfigJson(server, 'server')).toThrow()
  })

  it('accepts a bare map and envelope without changing the input or dropping advanced fields', () => {
    const servers = { local: { command: 'node', args: ['tool.js'], env: { TOKEN: '${TOKEN}' }, active: false, custom: 'preserved' } }
    const envelope = { mcpServers: servers, mcpSettings: { maxToolOutputChars: 0 } }
    expect(validateMCPConfigJson(servers, 'all')).toBe(servers)
    expect(validateMCPConfigJson(envelope, 'all')).toBe(envelope)
    expect(servers.local.custom).toBe('preserved')
  })

  it('accepts explicit empty maps and single remote configurations', () => {
    expect(validateMCPConfigJson({}, 'all')).toEqual({})
    expect(validateMCPConfigJson({ type: 'http', url: 'https://example.com/mcp', headers: { Authorization: '${TOKEN}' } }, 'server')).toMatchObject({ type: 'http' })
  })

  it('validates the entire map, including the last server, and settings', () => {
    expect(() => validateMCPConfigJson({ good: { command: 'node' }, bad: { command: '' } }, 'all')).toThrow()
    expect(() => validateMCPConfigJson({ mcpServers: {}, mcpSettings: { enableSmartToolRouting: 'false' } }, 'all')).toThrow()
    expect(() => validateMCPConfigJson(JSON.parse('{"__proto__":{"command":"node"}}'), 'all')).toThrow()
  })
})
