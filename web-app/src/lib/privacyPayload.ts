export type PrivacyJson =
  | null
  | boolean
  | number
  | string
  | PrivacyJson[]
  | { [key: string]: PrivacyJson }
export const OPAQUE_PRIVACY_ERROR =
  'Nube con revisión no puede inspeccionar adjuntos binarios, imágenes, audio, vídeo ni referencias opacas. Usa Solo local o extrae y revisa su texto antes de enviar.'
const opaqueTypes = new Set([
  'file',
  'image',
  'audio',
  'video',
  'image-url',
  'file-url',
  'image-data',
  'file-data',
  'image-file-id',
  'file-id',
  'input_image',
  'input_audio',
  'input_video',
  'custom',
])
const secretKey =
  /^(?:headers?|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|client[-_]?secret|token|secret)$/i
function plain(value: object): boolean {
  return (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  )
}

export function assertPrivacyTextOnly(
  value: unknown,
  depth = 0,
  seen = new Set<object>()
): void {
  if (depth > 40)
    throw new Error('La petición supera la profundidad admitida para revisión.')
  if (typeof value === 'string') {
    if (
      /data:(?:image|audio|video|application)\//i.test(value) ||
      /__REY30_(?:AUDIO|VIDEO|TOOL_IMAGE)__/.test(value)
    )
      throw new Error(OPAQUE_PRIVACY_ERROR)
    return
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return
  if (
    typeof value !== 'object' ||
    (!Array.isArray(value) && !plain(value)) ||
    seen.has(value)
  )
    throw new Error(OPAQUE_PRIVACY_ERROR)
  seen.add(value)
  if (
    !Array.isArray(value) &&
    'type' in value &&
    opaqueTypes.has(String(value.type))
  )
    throw new Error(OPAQUE_PRIVACY_ERROR)
  for (const [key, child] of Object.entries(value)) {
    if (secretKey.test(key) || key === 'abortSignal') continue
    if (
      /^(?:encryptedcontent|thoughtsignature|thinkingsignature|fileid|imageurl|audiourl|videourl)$/i.test(
        key.replace(/[_-]/g, '')
      ) &&
      child !== undefined &&
      child !== null &&
      child !== ''
    )
      throw new Error(OPAQUE_PRIVACY_ERROR)
    assertPrivacyTextOnly(child, depth + 1, seen)
  }
  seen.delete(value)
}

export function redactPrivacyPayload(value: unknown): {
  payload: PrivacyJson
  redactions: number
} {
  assertPrivacyTextOnly(value)
  if (JSON.stringify(value).length > 4 * 1024 * 1024)
    throw new Error(
      'La petición supera 4 MiB para revisión; reduce el contexto antes de enviar.'
    )
  const aliases = new Map<string, string>()
  const counts = new Map<string, number>()
  let redactions = 0
  const hide = (kind: string, match: string): string => {
    redactions++
    if (!aliases.has(match)) {
      const index = (counts.get(kind) ?? 0) + 1
      counts.set(kind, index)
      aliases.set(match, `[${kind}_${index}]`)
    }
    return aliases.get(match)!
  }
  const string = (text: string): string =>
    text
      .replace(
        /\b(?:sk-[a-zA-Z0-9_-]{12,}|hf_[a-zA-Z0-9]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g,
        (match) => hide('CLAVE_POSIBLE', match)
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi, (match) =>
        hide('TOKEN_POSIBLE', match)
      )
      .replace(
        /\b(?:api[_ -]?key|password|contraseña|token|secret)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
        (match) => hide('CREDENCIAL_POSIBLE', match)
      )
      .replace(
        /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g,
        (match) => hide('CORREO_POSIBLE', match)
      )
      .replace(/[A-Za-z]:\\Users\\[^\\\s"'<>]+(?:\\[^\s"'<>]*)?/g, (match) =>
        hide('RUTA_LOCAL', match)
      )
      .replace(
        /\/(?:home|Users)\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?|\/root(?:\/[^\s"'<>]*)?/g,
        (match) => hide('RUTA_LOCAL', match)
      )
      .replace(/\+?\d[\d ()-]{7,}\d/g, (match) =>
        (match.match(/\d/g)?.length ?? 0) >= 9
          ? hide('TELEFONO_POSIBLE', match)
          : match
      )
  const walk = (entry: unknown): PrivacyJson => {
    if (entry === null) return null
    if (typeof entry === 'string') return string(entry)
    if (typeof entry === 'boolean') return entry
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry
    if (Array.isArray(entry))
      return entry.map((child) => (child === undefined ? null : walk(child)))
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry)
          .filter(
            ([key, child]) =>
              !secretKey.test(key) &&
              key !== 'abortSignal' &&
              child !== undefined
          )
          .map(([key, child]) => [string(key), walk(child)])
      )
    throw new Error(
      'La petición contiene opciones no compatibles con una revisión textual.'
    )
  }
  const payload = walk(value)
  if (JSON.stringify(payload).length > 4 * 1024 * 1024)
    throw new Error(
      'La petición supera 4 MiB para revisión; reduce el contexto antes de enviar.'
    )
  return { payload, redactions }
}

export function hidePrivacyText(
  payload: PrivacyJson,
  text: string
): PrivacyJson {
  if (!text || text.length > 512)
    throw new Error('Indica un texto de 1 a 512 caracteres para ocultarlo.')
  if (typeof payload === 'string')
    return payload.split(text).join('[OCULTO_MANUAL]')
  if (Array.isArray(payload))
    return payload.map((value) => hidePrivacyText(value, text))
  if (payload && typeof payload === 'object')
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        hidePrivacyText(value, text),
      ])
    )
  return payload
}
export async function privacyHash(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
