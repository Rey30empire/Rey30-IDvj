import { beforeEach, describe, expect, it, vi } from 'vitest'

const hub = vi.hoisted(() => ({ invoke: vi.fn(), getTools: vi.fn(), callTool: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({ invoke: hub.invoke }),
    mcp: () => ({
      getTools: hub.getTools,
      callToolWithCancellation: (args: unknown) => ({ promise: hub.callTool(args), cancel: async () => {}, token: 't' }),
    }),
  }),
}))

import { useToolApproval } from '@/hooks/useToolApproval'
import { documentTools, plumaActions, trustedMcpTools } from '../pluma-actions'

const call = (name: string, args: object) => ({ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } })
const fetchTool = { name: 'fetch', description: 'Descarga una página web.', inputSchema: { $schema: 'x', type: 'object', properties: { url: { type: 'string' } } }, server: 'fetch' }
const shellTool = { name: 'run', description: 'Ejecuta comandos.', inputSchema: {}, server: 'OpenClaw' }

beforeEach(() => {
  vi.resetAllMocks()
  useToolApproval.setState({ approvedServers: [], approvedToolsGlobal: [], approvedTools: {}, allowAllMCPPermissions: false })
})

describe('herramientas de Pluma en la llamada', () => {
  it('solo ofrece herramientas MCP de servidores en los que ya confías siempre', async () => {
    expect(trustedMcpTools([fetchTool, shellTool])).toEqual([])
    useToolApproval.setState({ approvedServers: ['fetch'] })
    expect(trustedMcpTools([fetchTool, shellTool]).map(entry => entry.name)).toEqual(['mcp_fetch_fetch'])
    hub.getTools.mockResolvedValue([fetchTool, shellTool])
    const actions = await plumaActions()
    const names = actions.tools.map(tool => (tool as { function: { name: string } }).function.name)
    expect(names).toEqual([...documentTools.map(tool => tool.function.name), 'mcp_fetch_fetch'])
    expect(JSON.stringify(actions.tools.at(-1))).not.toContain('$schema')
    expect(actions.owns('mcp_openclaw_run')).toBe(false)
  })

  it('crea, lee y edita documentos con los comandos nativos y devuelve el resultado a Gemma', async () => {
    hub.getTools.mockResolvedValue([])
    hub.invoke.mockImplementation(async (command: string, args: { name?: string }) => {
      if (command === 'pluma_documents_create') return 'ideas.md'
      if (command === 'pluma_documents_read') return '# Ideas'
      if (command === 'pluma_documents_edit') return args.name
      if (command === 'pluma_documents_list') return [{ name: 'ideas.md', sizeBytes: 7 }]
    })
    const actions = await plumaActions()
    expect(await actions.run(call('crear_documento', { nombre: 'ideas', texto: '# Ideas' }))).toContain('Creado ideas.md')
    expect(hub.invoke).toHaveBeenCalledWith('pluma_documents_create', { name: 'ideas', text: '# Ideas' })
    expect(await actions.run(call('leer_documento', { nombre: 'ideas.md' }))).toBe('# Ideas')
    expect(await actions.run(call('listar_documentos', {}))).toBe('- ideas.md')
    await actions.run(call('editar_documento', { nombre: 'ideas.md', buscar: 'Ideas', texto: 'Ideas nuevas' }))
    expect(hub.invoke).toHaveBeenCalledWith('pluma_documents_edit', { name: 'ideas.md', find: 'Ideas', text: 'Ideas nuevas' })
  })

  it('convierte un fallo en un mensaje para Gemma en vez de cortar la llamada', async () => {
    hub.getTools.mockRejectedValue(new Error('sin MCP'))
    hub.invoke.mockRejectedValue(new Error('Ya existe un documento llamado ideas.md.'))
    const actions = await plumaActions()
    expect(actions.tools).toHaveLength(documentTools.length)
    expect(await actions.run(call('crear_documento', { nombre: 'ideas.md', texto: 'x' }))).toContain('Ya existe')
    expect(await actions.run({ id: 'x', function: { name: 'leer_documento', arguments: '{' } })).toContain('Argumentos no válidos')
  })

  it('llama a la herramienta MCP de confianza con sus argumentos', async () => {
    useToolApproval.setState({ approvedServers: ['fetch'] })
    hub.getTools.mockResolvedValue([fetchTool])
    hub.callTool.mockResolvedValue({ error: '', content: [{ text: 'Página descargada' }] })
    const actions = await plumaActions()
    expect(await actions.run(call('mcp_fetch_fetch', { url: 'https://example.com' }))).toBe('Página descargada')
    expect(hub.callTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'fetch', serverName: 'fetch', arguments: { url: 'https://example.com' } }))
  })
})
