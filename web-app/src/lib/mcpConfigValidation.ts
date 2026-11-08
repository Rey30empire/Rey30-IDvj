import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/useMCPServers'

export type MCPConfigJson =
  | MCPServerConfig
  | MCPServers
  | { mcpServers: MCPServers; mcpSettings?: MCPSettings }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function stringMap(value: unknown, field: string) {
  requireValue(
    record(value) && Object.values(value).every((item) => typeof item === 'string'),
    field + ' must be an object containing strings'
  )
}

export function validateMCPServerConfig(value: unknown): asserts value is MCPServerConfig {
  requireValue(record(value), 'A server configuration must be an object')
  const type = value.type ?? (value.url ? 'http' : 'stdio')
  requireValue(['stdio', 'http', 'sse'].includes(String(type)), 'Invalid MCP transport')
  if (type === 'stdio') {
    requireValue(typeof value.command === 'string' && value.command.trim().length > 0, 'A stdio server needs a command')
  } else {
    requireValue(typeof value.url === 'string', 'A remote server needs a URL')
    let url: URL
    try { url = new URL(value.url) } catch { throw new Error('Invalid MCP URL') }
    requireValue(url.protocol === 'http:' || url.protocol === 'https:', 'Invalid MCP URL protocol')
  }
  if (value.command !== undefined) requireValue(typeof value.command === 'string', 'command must be a string')
  if (value.args !== undefined) requireValue(Array.isArray(value.args) && value.args.every((item) => typeof item === 'string'), 'args must contain strings')
  if (value.env !== undefined) stringMap(value.env, 'env')
  if (value.headers !== undefined) stringMap(value.headers, 'headers')
  for (const field of ['active', 'official']) {
    if (value[field] !== undefined) requireValue(typeof value[field] === 'boolean', field + ' must be boolean')
  }
  if (value.timeout !== undefined) requireValue(typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout >= 0, 'timeout must be a non-negative number')
  if (value.description !== undefined) requireValue(typeof value.description === 'string', 'description must be a string')
  if (value.capabilities !== undefined) requireValue(Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === 'string'), 'capabilities must contain strings')
}

export function validateMCPServers(value: unknown): asserts value is MCPServers {
  requireValue(record(value), 'mcpServers must be an object')
  for (const [name, config] of Object.entries(value)) {
    requireValue(name.trim().length > 0 && !['__proto__', 'constructor', 'prototype'].includes(name), 'Invalid MCP server name')
    validateMCPServerConfig(config)
  }
}

function validateSettings(value: unknown) {
  requireValue(record(value), 'mcpSettings must be an object')
  for (const field of ['toolCallTimeoutSeconds', 'baseRestartDelayMs', 'maxRestartDelayMs', 'backoffMultiplier', 'maxToolOutputChars']) {
    if (value[field] !== undefined) requireValue(typeof value[field] === 'number' && Number.isFinite(value[field]) && (value[field] as number) >= 0, field + ' must be a non-negative number')
  }
  for (const field of ['enableSmartToolRouting', 'useLightweightRouterModel']) {
    if (value[field] !== undefined) requireValue(typeof value[field] === 'boolean', field + ' must be boolean')
  }
  for (const field of ['routerModelProvider', 'routerModelId']) {
    if (value[field] !== undefined) requireValue(typeof value[field] === 'string', field + ' must be a string')
  }
}

/** Validate the complete payload before a caller mutates its current configuration. */
export function validateMCPConfigJson(value: unknown, mode: 'server' | 'all'): MCPConfigJson {
  if (mode === 'server') {
    validateMCPServerConfig(value)
    return value
  }
  requireValue(record(value), 'MCP configuration must be an object')
  if ('mcpServers' in value || 'mcpSettings' in value) {
    validateMCPServers(value.mcpServers)
    if (value.mcpSettings !== undefined) validateSettings(value.mcpSettings)
  } else {
    validateMCPServers(value)
  }
  return value as MCPConfigJson
}
