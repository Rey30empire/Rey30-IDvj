import { getServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/useToolApproval'
import type { MCPTool } from '@/types/completion'
import { loadPlumaProject, plumaProjectPrompt, projectReadToolNames, projectToolNames, projectTools, runProjectTool } from './pluma-project'

/**
 * Tools Pluma can use to act during a voice call, beyond talking:
 * - her documents (`Documentos\Pluma`): list, read, create and edit `.md`/`.txt`
 *   files. Creating never overwrites and every edit keeps the previous version.
 * - MCP tools from servers the person already trusts in every conversation
 *   (Settings → MCP). A call has no screen to approve each use, so only that
 *   standing trust counts; nothing new is unlocked here.
 * - one project folder, when the person chose it and switched editing on
 *   (see `pluma-project.ts`).
 */
export type PlumaToolCall = { id: string; function: { name: string; arguments: string } }
export type PlumaActions = {
  tools: object[]
  owns(name: string): boolean
  run(call: PlumaToolCall, signal?: AbortSignal): Promise<string>
  /** Extra system-prompt rule for these tools. */
  prompt?: string
  /** Model rounds a turn may take; the default suits one or two tool calls. */
  maxRounds?: number
  /** Whether this tool hands project text, which nobody vetted, to the model. */
  readsProject?(name: string): boolean
  /** Whether this tool can carry data out of the app. */
  reachesOutside?(name: string): boolean
}

const MAX_MCP_TOOLS = 8
const MAX_RESULT_CHARS = 6_000
const MAX_TEXT_LENGTH = 60_000

const tool = (name: string, description: string, properties: Record<string, object>, required: string[]) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
})

const documentName = { type: 'string', description: 'Nombre del documento, por ejemplo «ideas.md». Sin carpetas.', maxLength: 120 }

export const documentTools = [
  tool('listar_documentos', 'Lista los documentos de la carpeta de Pluma.', {}, []),
  tool('leer_documento', 'Lee un documento de la carpeta de Pluma.', { nombre: documentName }, ['nombre']),
  tool('crear_documento', 'Crea un documento nuevo en la carpeta de Pluma cuando la persona lo pida. Nunca sobrescribe uno existente.', {
    nombre: documentName,
    texto: { type: 'string', description: 'Contenido completo en Markdown o texto plano.', maxLength: MAX_TEXT_LENGTH },
  }, ['nombre', 'texto']),
  tool('editar_documento', 'Edita un documento existente cuando la persona lo pida. Sin «buscar», añade el texto al final; con «buscar», reemplaza ese fragmento exacto, que debe aparecer una sola vez. Lee el documento antes de reemplazar.', {
    nombre: documentName,
    buscar: { type: 'string', description: 'Fragmento exacto a reemplazar. Omítelo para añadir al final.', maxLength: MAX_TEXT_LENGTH },
    texto: { type: 'string', description: 'Texto nuevo.', maxLength: MAX_TEXT_LENGTH },
  }, ['nombre', 'texto']),
]

const documentToolNames = new Set(documentTools.map(item => item.function.name))

const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const clip = (text: string) => text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[…recortado]` : text

function parseArgs(call: PlumaToolCall): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(call.function.arguments || '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

const text = (args: Record<string, unknown>, key: string) => typeof args[key] === 'string' ? args[key] as string : undefined

export function trustedMcpTools(tools: MCPTool[]): { name: string; tool: MCPTool }[] {
  const approval = useToolApproval.getState()
  const trusted = tools.filter(item =>
    approval.allowAllMCPPermissions ||
    approval.approvedServers.includes(item.server) ||
    approval.approvedToolsGlobal.includes(item.name))
  const used = new Set<string>()
  const result: { name: string; tool: MCPTool }[] = []
  for (const item of trusted) {
    const name = `mcp_${slug(`${item.server}_${item.name}`)}`.slice(0, 64)
    if (name === 'mcp_' || used.has(name)) continue
    used.add(name)
    result.push({ name, tool: item })
    if (result.length >= MAX_MCP_TOOLS) break
  }
  return result
}

function mcpDefinition(name: string, item: MCPTool) {
  const parameters = { ...(item.inputSchema ?? {}) } as Record<string, unknown>
  delete parameters.$schema
  return {
    type: 'function',
    function: {
      name,
      description: `${item.description ?? ''}`.slice(0, 300) || `Herramienta ${item.name} de ${item.server}.`,
      parameters: Object.keys(parameters).length ? parameters : { type: 'object', properties: {} },
    },
  }
}

async function runDocumentTool(call: PlumaToolCall): Promise<string> {
  const args = parseArgs(call)
  if (!args) return 'Argumentos no válidos. Vuelve a intentarlo con un JSON correcto.'
  const core = getServiceHub().core()
  const name = text(args, 'nombre')
  try {
    switch (call.function.name) {
      case 'listar_documentos': {
        const documents = await core.invoke<{ name: string; sizeBytes: number }[]>('pluma_documents_list')
        return documents.length ? documents.map(doc => `- ${doc.name}`).join('\n') : 'La carpeta de documentos de Pluma está vacía.'
      }
      case 'leer_documento':
        if (!name) return 'Falta el nombre del documento.'
        return clip(await core.invoke<string>('pluma_documents_read', { name })) || '(El documento está vacío.)'
      case 'crear_documento': {
        const content = text(args, 'texto')
        if (!name || content === undefined) return 'Faltan el nombre o el texto del documento.'
        const created = await core.invoke<string>('pluma_documents_create', { name, text: content })
        return `Creado ${created} en la carpeta de documentos de Pluma. Díselo a la persona en una frase.`
      }
      case 'editar_documento': {
        const content = text(args, 'texto')
        if (!name || content === undefined) return 'Faltan el nombre o el texto nuevo.'
        const edited = await core.invoke<string>('pluma_documents_edit', { name, find: text(args, 'buscar') ?? null, text: content })
        return `Guardado ${edited}; la versión anterior queda en .versiones. Díselo a la persona en una frase.`
      }
    }
  } catch (cause) {
    return `No se pudo: ${cause instanceof Error ? cause.message : String(cause)}`
  }
  return 'Herramienta desconocida.'
}

async function runMcpTool(item: MCPTool, call: PlumaToolCall, signal?: AbortSignal): Promise<string> {
  const args = parseArgs(call)
  if (!args) return 'Argumentos no válidos. Vuelve a intentarlo con un JSON correcto.'
  const { promise, cancel } = getServiceHub().mcp().callToolWithCancellation({
    toolName: item.name, serverName: item.server, arguments: args, maxOutputChars: MAX_RESULT_CHARS,
  })
  const onAbort = () => { void cancel().catch(() => undefined) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await promise
    if (result?.error) return `La herramienta falló: ${result.error}`
    return clip((result?.content ?? []).map(part => part.text).filter(Boolean).join('\n')) || 'La herramienta terminó sin resultado.'
  } catch (cause) {
    return `La herramienta falló: ${cause instanceof Error ? cause.message : String(cause)}`
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Builds the tools for one call; MCP tools come from the running servers. */
export async function plumaActions(): Promise<PlumaActions> {
  let mcp: { name: string; tool: MCPTool }[] = []
  try {
    mcp = trustedMcpTools(await getServiceHub().mcp().getTools() ?? [])
  } catch {
    mcp = []
  }
  const byName = new Map(mcp.map(entry => [entry.name, entry.tool]))
  const project = await loadPlumaProject()
  const folder = project.canEdit ? project.folder : null
  // The tools' scratch space; the work itself happens in `folder`.
  const projectSession = crypto.randomUUID()
  return {
    tools: [...documentTools, ...(folder ? projectTools : []), ...mcp.map(entry => mcpDefinition(entry.name, entry.tool))],
    owns: name => documentToolNames.has(name) || byName.has(name) || (!!folder && projectToolNames.has(name)),
    run: (call, signal) => {
      if (folder && projectToolNames.has(call.function.name)) return runProjectTool(call, folder, projectSession)
      const item = byName.get(call.function.name)
      return item ? runMcpTool(item, call, signal) : runDocumentTool(call)
    },
    readsProject: name => !!folder && projectReadToolNames.has(name),
    reachesOutside: name => byName.has(name),
    ...(folder ? { prompt: plumaProjectPrompt(folder), maxRounds: 8 } : {}),
  }
}
