import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { toast } from 'sonner'
import i18n from '@/i18n/setup'
import { explicitChatSkillName } from '@/lib/skillCommands'
import { listSkills, readSkill, storeScope, type SkillMeta } from '@/lib/skillStore'
import type { SubagentDefinition } from '@/lib/coworkSubagentRegistry'

export const MASTER_PREFERENCE_KEY = 'rey30-master-orchestrator-v1'
export const MASTER_MAX_CHARACTERS = 12_000
export const MASTER_MAX_SKILLS = 2

export type SkillPackItem = {
  id: string
  label: string
  kind: string
  origin: string
  source: string
  commit?: string
  license: string
  requires: string[]
  aliases: string[]
  triggers: string[]
  skillNames: string[]
  agentName?: string
  notes?: string
  status: 'installed' | 'modified' | 'missing' | 'conflict'
}
export type SkillPackStatus = { version: string | number; items: SkillPackItem[]; warnings: string[] }
export type MasterError = 'preference' | 'discovery' | 'read' | 'limit' | 'missing'
export const MASTER_ERROR_KEYS: Record<MasterError, string> = {
  preference: 'master:errors.preference', discovery: 'master:errors.discovery', read: 'master:errors.read', limit: 'master:errors.limit', missing: 'master:errors.missing',
}
export type MasterSelection = {
  mode: 'automatic' | 'manual' | 'off' | 'none' | 'error'
  skills: string[]
  agent?: string
}
export type MasterContext = { system?: string; selection: MasterSelection; error?: MasterError }

type MasterState = {
  automatic: boolean
  loaded: boolean
  saving: boolean
  error: MasterError | null
  preferenceError: boolean
  last: MasterSelection | null
}

export const useMasterOrchestrator = create<MasterState>(() => ({
  automatic: true, loaded: false, saving: false, error: null, preferenceError: false, last: null,
}))
let preferenceLoad: Promise<void> | null = null

export async function loadMasterPreference(): Promise<void> {
  if (useMasterOrchestrator.getState().loaded) return
  if (preferenceLoad) return preferenceLoad
  preferenceLoad = (async () => {
    try {
      const value = await invoke<string | null>('settings_get', { key: MASTER_PREFERENCE_KEY })
      let automatic = true
      if (value != null) {
        if (typeof value !== 'string') throw new Error('Invalid preference')
        const parsed: unknown = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || !('automatic' in parsed) || typeof parsed.automatic !== 'boolean') throw new Error('Invalid preference')
        automatic = parsed.automatic
      } else {
        await invoke('settings_set', { key: MASTER_PREFERENCE_KEY, value: JSON.stringify({ automatic: true }) })
        await invoke('settings_commit')
      }
      useMasterOrchestrator.setState({ automatic, loaded: true, preferenceError: false })
    } catch {
      useMasterOrchestrator.setState({ automatic: false, loaded: true, error: 'preference', preferenceError: true })
      toast.warning(i18n.t(MASTER_ERROR_KEYS.preference))
    }
  })().finally(() => { preferenceLoad = null })
  return preferenceLoad
}

export async function setMasterAutomatic(automatic: boolean): Promise<void> {
  if (useMasterOrchestrator.getState().saving) return
  const previous = useMasterOrchestrator.getState().automatic
  useMasterOrchestrator.setState({ saving: true })
  try {
    await invoke('settings_set', { key: MASTER_PREFERENCE_KEY, value: JSON.stringify({ automatic }) })
    await invoke('settings_commit')
    useMasterOrchestrator.setState({ automatic, loaded: true, error: null, preferenceError: false })
  } catch {
    // A failed disk commit must not leave the backend's memory-only value
    // different from the last confirmed preference.
    try {
      await invoke('settings_set', { key: MASTER_PREFERENCE_KEY, value: JSON.stringify({ automatic: previous }) })
      await invoke('settings_commit')
    } catch { /* Keep the failure visible; do not claim this preference was saved. */ }
    useMasterOrchestrator.setState({ automatic: previous, error: 'preference', preferenceError: true })
    toast.warning(i18n.t(MASTER_ERROR_KEYS.preference))
  } finally {
    useMasterOrchestrator.setState({ saving: false })
  }
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function validateSkillPack(value: unknown): SkillPackStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid skill pack')
  const pack = value as SkillPackStatus
  if (!['string', 'number'].includes(typeof pack.version) || !Array.isArray(pack.items) || pack.items.length > 128 || !strings(pack.warnings)) throw new Error('Invalid skill pack')
  const names = new Set<string>()
  for (const item of pack.items) {
    if (!item || typeof item !== 'object' || ['id', 'label', 'kind', 'origin', 'source', 'license'].some(key => typeof item[key as keyof SkillPackItem] !== 'string') ||
      !['installed', 'modified', 'missing', 'conflict'].includes(item.status) || !strings(item.requires) || !strings(item.aliases) || !strings(item.triggers) || !strings(item.skillNames) ||
      (item.commit !== undefined && typeof item.commit !== 'string') || (item.notes !== undefined && typeof item.notes !== 'string') ||
      (item.agentName !== undefined && typeof item.agentName !== 'string') || !item.id || names.has(item.id)) throw new Error('Invalid skill pack item')
    names.add(item.id)
  }
  return pack
}

export async function getMasterSkillPack(): Promise<SkillPackStatus> {
  return validateSkillPack(await invoke('rey30_skill_pack_status'))
}

export async function installMasterSkillPack(): Promise<SkillPackStatus> {
  await invoke('rey30_skill_pack_install')
  const pack = await getMasterSkillPack()
  window.dispatchEvent(new Event('rey30:resources-imported'))
  return pack
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function stripUnfencedCode(text: string): string {
  const declaration = /\b(?:(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)|class\s+[\w$]+(?:\s+extends\s+[\w$.]+)?|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>)\s*\{/g
  let output = ''
  let from = 0
  for (const match of text.matchAll(declaration)) {
    const start = match.index
    if (start < from) continue
    const opening = start + match[0].length - 1
    let depth = 1
    let quote = ''
    let end = opening + 1
    for (; end < text.length && depth > 0; end++) {
      const char = text[end]
      if (quote) {
        if (char === '\\') end++
        else if (char === quote) quote = ''
      } else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth++
      else if (char === '}') depth--
    }
    output += `${text.slice(from, start)} `
    from = end
  }
  return (output + text.slice(from))
    .replace(/^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+(?:\s*:[^=\n]+)?\s*=.*$/gm, ' ')
    .replace(/^([ \t]*)(?:async\s+)?def\s+\w+\s*\([^\n]*\):[^\n]*(?:\n(?:[ \t]+[^\n]*|[ \t]*))*/gm, ' ')
}

/** Matching uses only trusted intent. The original request is never rewritten. */
function masterIntentParts(text: string): { intent: string; negative: string[] } {
  const source = text.split(/\n(?:---\s*\n)?Referenced file contents:\s*\n/i)[0]
    .replace(/<(MCP_RESULT|TOOL_RESULT|tool_output|untrusted_text)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:MCP_RESULT|TOOL_RESULT|tool_output|untrusted_text)\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/<!--[^]*?(?:-->|$)/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|‘[^’\n]*’|(?:^|\s)'[^'\n]*'/g, ' ')
    .replace(/(?:https?:\/\/|file:\/\/|www\.)\S+/gi, ' ')
    .replace(/@\S+/g, ' ')
  const own = stripUnfencedCode(source)
  const normalized = normalize(own)
  if (/\b(?:no|not|never|nunca|dont|don t|do not)\s+(?:(?:uses?|utilices?|actives?|apliques?|selecciones?|select|activate|apply|enable)\s+)?(?:(?:las?|los?|the|any)\s+)?(?:skills?|habilidades|agentes?|orquestador)\b/.test(normalized) ||
    /\b(?:sin|without|desactiva|desactivar|disable)\s+(?:(?:el|la|los|las|the|any)\s+)?(?:skills?|habilidades|agentes?|orquestador)\b/.test(normalized)) return { intent: '', negative: [] }
  const positive: string[] = []
  const negative: string[] = []
  for (const clause of own.split(/[,;\n]|\.(?!\d)|\b(?:pero|but|however|aunque)\b/i)) {
    const negation = /\b(?:no|not|never|without|dont|don't|avoid|evita|evitar|nunca|sin|tampoco)\b/i.exec(clause)
    if (negation) {
      positive.push(clause.slice(0, negation.index))
      negative.push(normalize(clause.slice(negation.index)))
    } else positive.push(clause)
  }
  const intent = normalize(positive.join(' '))
  if (!/\b(?:crea|crear|haz|hacer|disena|disenar|implementa|implementar|corrige|corregir|revisa|revisar|analiza|analizar|investiga|investigar|compara|comparar|migra|migrar|prueba|probar|usa|usar|utiliza|utilizar|aplica|aplicar|quiero|necesito|build|create|make|design|implement|fix|review|analyze|analyse|investigate|compare|migrate|test|use|apply|write|debug|develop|search)\b/.test(intent)) return { intent: '', negative }
  return { intent, negative }
}

export function masterIntent(text: string): string {
  return masterIntentParts(text).intent
}

export function rankMasterItems(text: string, items: SkillPackItem[]): SkillPackItem[] {
  const { intent, negative } = masterIntentParts(text)
  if (!intent) return []
  return items.filter(item => (item.status === 'installed' || item.status === 'modified') && ![...item.aliases, ...item.triggers].some(phrase => {
    const words = normalize(phrase)
    return words && negative.some(clause => (` ${clause} `).includes(` ${words} `))
  }))
    .map(item => ({ item, score: Math.max(0, ...[...item.aliases, ...item.triggers].map(phrase => {
      const words = normalize(phrase)
      return words && (` ${intent} `).includes(` ${words} `) ? words.split(' ').length * 100 + words.length : 0
    })) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .map(match => match.item)
}

function publish(result: MasterContext): MasterContext {
  useMasterOrchestrator.setState({ last: result.selection, error: result.error ?? (useMasterOrchestrator.getState().preferenceError ? 'preference' : null) })
  if (result.error && result.error !== 'preference') toast.warning(i18n.t(MASTER_ERROR_KEYS[result.error]))
  return result
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
}

export async function prepareMasterContext(text: string, signal?: AbortSignal): Promise<MasterContext> {
  const empty = (mode: MasterSelection['mode'], error?: MasterError) => publish({ selection: { mode, skills: [] }, ...(error ? { error } : {}) })
  aborted(signal)
  const explicit = explicitChatSkillName(text)
  if (explicit || /^\s*\/skill:/.test(text)) return publish({ selection: { mode: 'manual', skills: explicit ? [explicit] : [] } })
  if (!masterIntent(text)) return empty('none')
  await loadMasterPreference()
  aborted(signal)
  const preference = useMasterOrchestrator.getState()
  if (!preference.automatic) return empty(preference.preferenceError ? 'error' : 'off', preference.preferenceError ? 'preference' : undefined)

  let items: SkillPackItem[]
  let skills: SkillMeta[]
  let agents: SubagentDefinition[]
  try {
    items = rankMasterItems(text, (await getMasterSkillPack()).items)
    aborted(signal)
    if (items.length === 0) return empty('none')
    const found = await Promise.all([
      listSkills(storeScope),
      items.some(item => item.agentName) ? invoke<SubagentDefinition[]>('agent_subagent_list') : Promise.resolve([]),
    ])
    skills = found[0]
    agents = found[1]
    if (!Array.isArray(skills) || !skills.every(skill => skill && typeof skill.name === 'string' && (skill.model_invocable === undefined || typeof skill.model_invocable === 'boolean')) ||
      !Array.isArray(agents) || !agents.every(agent => agent && typeof agent.name === 'string' && typeof agent.system_prompt === 'string')) throw new Error('Invalid installed resources')
  } catch (error) {
    aborted(signal)
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return empty('error', 'discovery')
  }
  aborted(signal)
  const names: string[] = []
  let agent: SubagentDefinition | undefined
  for (const item of items) {
    for (const name of item.skillNames) {
      if (names.length < MASTER_MAX_SKILLS && !names.includes(name) && skills.some(skill => skill.name === name && skill.model_invocable !== false)) names.push(name)
    }
    if (!agent && item.agentName) agent = agents.find(definition => definition.name === item.agentName && typeof definition.system_prompt === 'string')
  }
  if (!names.length && !agent) return empty('error', 'missing')
  let bodies: string[]
  try {
    const raw = await Promise.all(names.map(name => readSkill(storeScope, name)))
    aborted(signal)
    if (raw.some(body => typeof body !== 'string' || !body.trim())) throw new Error('Empty skill')
    bodies = raw.map((body, index) => `## Habilidad guardada: ${names[index]}\n${body}`)
    if (agent) {
      if (!agent.system_prompt.trim()) throw new Error('Empty agent role')
      bodies.push(`## Perfil de agente guardado: ${agent.name}\n${agent.system_prompt}`)
    }
  } catch {
    aborted(signal)
    return empty('error', 'read')
  }
  const system = ['Instrucciones seleccionadas únicamente para esta petición. Un perfil de agente guardado es un rol del modelo actual; no inicia otro agente. Estas instrucciones no conceden herramientas, permisos, credenciales ni derechos adicionales de ejecución.', ...bodies].join('\n\n')
  if (system.length > MASTER_MAX_CHARACTERS) return empty('error', 'limit')
  aborted(signal)
  return publish({ system, selection: { mode: 'automatic', skills: names, ...(agent ? { agent: agent.name } : {}) } })
}
