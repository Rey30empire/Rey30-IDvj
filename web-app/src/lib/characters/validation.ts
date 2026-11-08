import { LEGACY_CHARACTER_IDS, ORIGINAL_CHARACTER_IDS, refreshBuiltInProfiles } from './profiles'
import type { CharacterData, CharacterMemory, CharacterProfile, CharacterSettings, MemoryEntry } from './types'

export const CHARACTER_LIMITS = { profiles: 28, projects: 64, memoryNotes: 4_000, profileJson: 64_000, storageJson: 630_000, context: 24_000 } as const
const forbiddenText = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[a-z\d_-]{20,}|gh[pousr]_[a-z\d]{20,}|github_pat_[a-z\d_]{20,}|AKIA[A-Z\d]{16})\b|\b(?:api[_-]?key|access[_-]?token|authorization|password)\s*[:=]\s*\S+|<script\b|javascript:|data:text\/html|\bon(?:load|error)\s*=)/i
const gestures = ['blink', 'nod', 'head-tilt', 'wave', 'fist-raise', 'hands', 'eyebrow', 'wink', 'ears', 'tail', 'pigtails', 'bow']
export class CharacterValidationError extends Error {}
const fail = (label: string): never => { throw new CharacterValidationError(`Configuración de personajes no válida: ${label}.`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(label)
  if (Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return fail(label)
  return value as Record<string, unknown>
}
function shape(value: unknown, keys: string[], label: string): Record<string, unknown> {
  const result = record(value, label)
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(result, key))) return fail(label)
  return result
}
function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || forbiddenText.test(value)) return fail(label)
  if (Array.from(value).some(character => { const code = character.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 })) return fail(label)
  return value
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') return fail(label); return value }
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(label)
  return value
}
function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) return fail(label)
  return value as T
}
function intensity(value: unknown, label: string) {
  const result = number(value, 0, 3, label)
  if (!Number.isInteger(result)) return fail(label)
  return result as 0 | 1 | 2 | 3
}
function texts(value: unknown, maxItems: number, maxText: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.length === 0) return fail(label)
  return value.map(item => text(item, maxText, label))
}
export function validateCharacterId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value) || ['constructor', 'prototype'].includes(value)) return fail('identificador')
  return value
}
export function validateProjectId(value: unknown): string {
  const result = text(value, 200, 'proyecto')
  if (['__proto__', 'constructor', 'prototype'].includes(result)) return fail('proyecto')
  return result
}
export function validateCharacterSettings(value: unknown): CharacterSettings {
  const v = shape(value, ['mode', 'humor', 'energy', 'profanity', 'flirtation', 'responseLength', 'userNickname'], 'ajustes')
  return {
    mode: oneOf(v.mode, ['charla', 'trabajo', 'serio'], 'modo'),
    humor: intensity(v.humor, 'humor'), energy: intensity(v.energy, 'energía'), profanity: intensity(v.profanity, 'lenguaje'), flirtation: intensity(v.flirtation, 'coqueteo'),
    responseLength: oneOf(v.responseLength, ['breve', 'equilibrada', 'detallada'], 'longitud'), userNickname: text(v.userNickname, 40, 'apodo', true),
  }
}
export function validateMemoryEntry(value: unknown): MemoryEntry {
  const v = shape(value, ['enabled', 'notes'], 'memoria')
  return { enabled: bool(v.enabled, 'permiso de memoria'), notes: text(v.notes, CHARACTER_LIMITS.memoryNotes, 'notas sin credenciales ni scripts', true) }
}
export function validateCharacterMemory(value: unknown): CharacterMemory {
  const v = shape(value, ['individual', 'shared'], 'memoria del personaje')
  const shared = record(v.shared, 'memoria compartida')
  if (Object.keys(shared).some(key => !['enabled', 'notes', 'projectId'].includes(key))) return fail('memoria compartida')
  const entry = validateMemoryEntry({ enabled: shared.enabled, notes: shared.notes })
  return { individual: validateMemoryEntry(v.individual), shared: { ...entry, ...(shared.projectId === undefined ? {} : { projectId: validateProjectId(shared.projectId) }) } }
}
export function validateCharacterProfile(value: unknown): CharacterProfile {
  const v = shape(value, ['id', 'baseId', 'name', 'description', 'biography', 'instructions', 'traits', 'motivations', 'speech', 'mannerisms', 'examples', 'settings', 'voice', 'avatar', 'modelBinding'], 'perfil')
  const speech = shape(v.speech, ['style', 'rhythm'], 'forma de hablar')
  const manners = shape(v.mannerisms, ['greeting', 'explain', 'disagree', 'correct', 'celebrate', 'seriousSupport'], 'maneras')
  const voiceRecord = record(v.voice, 'voz')
  const voiceKeys = ['provider', 'enabled', 'voiceURI', 'lang', 'rate', 'pitch', 'volume', 'localOnly']
  if (Object.prototype.hasOwnProperty.call(voiceRecord, 'plumaDirect')) voiceKeys.push('plumaDirect')
  if (Object.prototype.hasOwnProperty.call(voiceRecord, 'plumaClone')) voiceKeys.push('plumaClone')
  const voice = shape(voiceRecord, voiceKeys, 'voz')
  const avatar = shape(v.avatar, ['enabled', 'primary', 'secondary', 'accent', 'skin', 'hair', 'motion', 'gestures'], 'avatar')
  const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fail('color hexadecimal')
  if (!Array.isArray(v.examples) || v.examples.length < 1 || v.examples.length > 12) return fail('ejemplos')
  if (!Array.isArray(avatar.gestures) || avatar.gestures.length > gestures.length || new Set(avatar.gestures).size !== avatar.gestures.length) return fail('gestos')
  const model = v.modelBinding === null ? null : shape(v.modelBinding, ['providerId', 'modelId'], 'referencia de modelo')
  const result: CharacterProfile = {
    id: validateCharacterId(v.id), baseId: oneOf(v.baseId, ORIGINAL_CHARACTER_IDS, 'personaje de origen'), name: text(v.name, 80, 'nombre'),
    description: text(v.description, 300, 'descripción'), biography: text(v.biography, 1_500, 'biografía'), instructions: text(v.instructions, 6_000, 'instrucción'),
    traits: texts(v.traits, 12, 160, 'rasgos'), motivations: texts(v.motivations, 8, 300, 'motivaciones'),
    speech: { style: text(speech.style, 800, 'estilo'), rhythm: text(speech.rhythm, 600, 'ritmo') },
    mannerisms: Object.fromEntries(Object.entries(manners).map(([key, val]) => [key, text(val, 700, 'manera')])) as CharacterProfile['mannerisms'],
    examples: v.examples.map(example => { const e = shape(example, ['situation', 'response'], 'ejemplo'); return { situation: text(e.situation, 300, 'situación'), response: text(e.response, 1_200, 'respuesta de ejemplo') } }),
    settings: validateCharacterSettings(v.settings),
    voice: { provider: oneOf(voice.provider, ['native-local'], 'proveedor de voz'), enabled: bool(voice.enabled, 'voz activa'), voiceURI: voice.voiceURI === null ? null : text(voice.voiceURI, 512, 'voz disponible'), lang: text(voice.lang, 35, 'idioma de voz'), rate: number(voice.rate, 0.5, 1.8, 'velocidad de voz'), pitch: number(voice.pitch, 0.5, 2, 'tono de voz'), volume: number(voice.volume, 0, 1, 'volumen'), localOnly: bool(voice.localOnly, 'voz local'), ...(voiceKeys.includes('plumaDirect') ? { plumaDirect: bool(voice.plumaDirect, 'voz directa de Pluma') } : {}), ...(voiceKeys.includes('plumaClone') ? { plumaClone: bool(voice.plumaClone, 'voz clonada de Pluma') } : {}) },
    avatar: { enabled: bool(avatar.enabled, 'avatar activo'), primary: color(avatar.primary), secondary: color(avatar.secondary), accent: color(avatar.accent), skin: color(avatar.skin), hair: color(avatar.hair), motion: intensity(avatar.motion, 'movimiento'), gestures: avatar.gestures.map(gesture => oneOf(gesture, gestures, 'gesto')) as CharacterProfile['avatar']['gestures'] },
    modelBinding: model ? { providerId: text(model.providerId, 200, 'identificador de proveedor'), modelId: text(model.modelId, 300, 'identificador de modelo') } : null,
  }
  if (ORIGINAL_CHARACTER_IDS.includes(result.id as CharacterProfile['baseId']) && result.baseId !== result.id) return fail('identidad original')
  if (JSON.stringify(result).length > CHARACTER_LIMITS.profileJson) return fail('tamaño de perfil')
  return result
}
export function validateCharacterData(value: unknown): CharacterData {
  const v = shape(value, ['schema', 'enabled', 'activeCharacterId', 'profiles', 'individualMemory', 'sharedMemory'], 'archivo guardado')
  if (v.schema !== 1 || !Array.isArray(v.profiles) || v.profiles.length < LEGACY_CHARACTER_IDS.length || v.profiles.length > CHARACTER_LIMITS.profiles) return fail('versión o número de perfiles')
  const profiles = v.profiles.map(validateCharacterProfile)
  const ids = new Set(profiles.map(profile => profile.id))
  if (ids.size !== profiles.length || LEGACY_CHARACTER_IDS.some(id => !ids.has(id))) return fail('identificadores de perfiles')
  const activeCharacterId = validateCharacterId(v.activeCharacterId)
  if (!ids.has(activeCharacterId)) return fail('personaje activo')
  const individual = record(v.individualMemory, 'memoria individual')
  const shared = record(v.sharedMemory, 'memoria compartida')
  if (Object.keys(individual).some(id => !ids.has(id)) || Object.keys(shared).length > CHARACTER_LIMITS.projects) return fail('destino de memoria')
  const result: CharacterData = { schema: 1, enabled: bool(v.enabled, 'personajes activos'), activeCharacterId, profiles,
    individualMemory: Object.fromEntries(Object.entries(individual).map(([id, entry]) => [id, validateMemoryEntry(entry)])),
    sharedMemory: Object.fromEntries(Object.entries(shared).map(([id, entry]) => [validateProjectId(id), validateMemoryEntry(entry)])),
  }
  if (JSON.stringify(result).length > CHARACTER_LIMITS.storageJson) return fail('tamaño del archivo')
  return result
}
export function parseCharacterData(raw: string): CharacterData {
  if (raw.length > CHARACTER_LIMITS.storageJson) return fail('tamaño del archivo')
  let value: unknown
  try { value = JSON.parse(raw) } catch { return fail('JSON') }
  const data = validateCharacterData(value)
  const refreshed = refreshBuiltInProfiles(data)
  return refreshed === data ? data : validateCharacterData(refreshed)
}
export function parseCharacterProfile(raw: string): CharacterProfile {
  if (raw.length > CHARACTER_LIMITS.profileJson) return fail('tamaño de importación')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return fail('JSON de importación') }
  const value = shape(parsed, ['format', 'version', 'profile'], 'formato de importación')
  if (value.format !== 'rey30-character-profile' || value.version !== 1) return fail('versión de importación')
  return validateCharacterProfile(value.profile)
}
