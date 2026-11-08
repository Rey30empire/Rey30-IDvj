import { parseDocument } from 'yaml'

export const MAX_ASSISTANT_FILE_BYTES = 1024 * 1024
export type AssistantFileDraft = {
  name: string
  description?: string
  avatar?: string
  instructions: string
  parameters: Record<string, string | number | boolean | null | (string | number | boolean | null)[]>
  warnings: string[]
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function yaml(text: string): unknown {
  const document = parseDocument(text, { strict: true, uniqueKeys: true, stringKeys: true, customTags: [], prettyErrors: false })
  if (document.errors.length || document.warnings.length) throw new Error('El YAML contiene errores, claves duplicadas o etiquetas no admitidas.')
  return document.toJS({ maxAliasCount: 0 })
}

function textField(value: unknown, key: string, limit: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`Campo no válido: ${key}.`)
  return value.trim()
}

export function parseAssistantFile(fileName: string, content: string): AssistantFileDraft {
  if (new TextEncoder().encode(content).length > MAX_ASSISTANT_FILE_BYTES) throw new Error('El archivo supera 1 MiB.')
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const extension = fileName.split('.').pop()?.toLowerCase()
  let raw: unknown
  let body: string | undefined
  if (extension === 'json') {
    try { raw = JSON.parse(text) } catch { throw new Error('El archivo JSON no es válido.') }
  } else if (extension === 'yaml' || extension === 'yml') {
    raw = yaml(text)
  } else if (extension === 'md') {
    if (text.startsWith('---\n')) {
      const end = text.indexOf('\n---', 4)
      if (end < 0 || !/^\n---(?:\n|$)/.test(text.slice(end))) throw new Error('El frontmatter Markdown no está cerrado.')
      raw = yaml(text.slice(4, end))
      body = text.slice(end + 4).replace(/^\n/, '')
    } else { raw = {}; body = text }
  } else throw new Error('Selecciona un archivo JSON, Markdown o YAML.')
  if (!object(raw)) throw new Error('El archivo debe definir un único asistente como objeto.')
  if (Object.keys(raw).some(key => /tools?|permission|sandbox|approval|hooks?|mcpservers?|readonly|isolation|writableroots|capabilit|policy|allow|deny|denied|restrict/.test(key.toLowerCase().replace(/[^a-z0-9]/g, '')))) {
    throw new Error('Este archivo declara herramientas o permisos de un agente. Revísalo desde Importar recursos; no se convertirán sus restricciones en un asistente sin límites.')
  }
  const fallbackName = fileName.replace(/\.(md|json|ya?ml)$/i, '').split(/[\\/]/).pop()
  const name = textField(raw.name ?? (extension === 'md' ? fallbackName : undefined), 'name', 120, true)!
  const instructionCandidates = [raw.instructions, raw.system_prompt, raw.systemPrompt, raw.prompt].filter(value => value !== undefined)
  if (instructionCandidates.length > 1) throw new Error('El archivo contiene varios campos de instrucciones; conserva solo uno.')
  const instructions = textField(body?.trim() ? body : instructionCandidates[0], 'instructions', 256 * 1024, true)!
  const description = textField(raw.description, 'description', 4000)
  const warnings: string[] = []
  let avatar = textField(raw.avatar, 'avatar', 2048)
  if (avatar && (/[:/\\]/.test(avatar) || [...avatar].length > 16)) { avatar = undefined; warnings.push('El avatar externo se omitió para evitar solicitudes de red al revisar el archivo.') }
  const parameters: AssistantFileDraft['parameters'] = {}
  if (raw.parameters !== undefined) {
    if (!object(raw.parameters) || Object.keys(raw.parameters).length > 64) throw new Error('parameters debe ser un objeto de hasta 64 parámetros.')
    const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 8192)
    for (const [key, value] of Object.entries(raw.parameters)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !(scalar(value) || (Array.isArray(value) && value.length <= 64 && value.every(scalar)))) throw new Error('El archivo contiene un parámetro no compatible.')
      parameters[key] = value
    }
  }
  const known = new Set(['id', 'created_at', 'object', 'name', 'description', 'avatar', 'instructions', 'system_prompt', 'systemPrompt', 'prompt', 'parameters'])
  if (Object.keys(raw).some(key => !known.has(key))) warnings.push('Se omitieron campos que el formato de asistente no admite. No se cambia el modelo seleccionado.')
  if (raw.id !== undefined) warnings.push('Se asignará un identificador nuevo; el identificador del archivo no reemplaza a ningún asistente existente.')
  return { name, description, avatar, instructions, parameters, warnings }
}
