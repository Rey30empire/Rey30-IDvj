import { usePrivacyMode, type PrivacyMode } from '@/hooks/usePrivacyMode'

export type { PrivacyMode }
export function privacyAllowsTools(mode: PrivacyMode): boolean {
  return mode === 'standard'
}
export function getPrivacyModeSnapshot(): PrivacyMode {
  const state = usePrivacyMode.getState()
  return !state.loaded || state.saving || state.error
    ? 'local-only'
    : state.mode
}
export async function ensurePrivacyMode(): Promise<PrivacyMode> {
  const state = usePrivacyMode.getState()
  if (state.saving)
    throw new Error(
      'Espera a que termine el guardado de privacidad antes de enviar.'
    )
  if (!state.loaded) await state.load()
  const current = usePrivacyMode.getState()
  if (!current.loaded || current.error)
    throw new Error(
      current.error ?? 'La política de privacidad no está disponible.'
    )
  return current.mode
}
export function nativePrivacyProvider(provider: string): boolean {
  return provider === 'llamacpp' || provider === 'mlx'
}
export function assertPrivacyProvider(
  mode: PrivacyMode,
  nativeEngine: boolean
): void {
  if (mode === 'local-only' && !nativeEngine)
    throw new Error(
      'Solo local bloqueó este proveedor. Selecciona un modelo de llama.cpp o MLX gestionado por la aplicación; un proxy en localhost también puede enviar datos a la nube.'
    )
}
export function assertNativeSessionPort(port: unknown): asserts port is number {
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('La sesión local no tiene un puerto loopback válido.')
}
export function assertPrivacyLoopbackUrl(value: string): void {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(
      'La sesión del motor local debe usar una dirección loopback válida.'
    )
}
export function assertPrivacyFactoryParameters(
  mode: PrivacyMode,
  parameters: Record<string, unknown>,
  nativeEngine = false
): void {
  if (mode === 'standard' || nativeEngine) return
  const enumerations = new Set([
    'reasoning_effort',
    'reasoningEffort',
    'verbosity',
    'service_tier',
  ])
  const scalarKeys = new Set([
    'temperature',
    'top_k',
    'top_p',
    'min_p',
    'typical_p',
    'repeat_penalty',
    'repeat_last_n',
    'max_output_tokens',
    'max_tokens',
    'max_context_tokens',
    'ctx_len',
    'auto_compact',
    'presence_penalty',
    'frequency_penalty',
    'seed',
    'n_predict',
    'n_keep',
    'cache_prompt',
    'ignore_eos',
    'penalize_nl',
    'mirostat',
    'mirostat_tau',
    'mirostat_eta',
    'tfs_z',
    'dry_multiplier',
    'dry_base',
    'dry_allowed_length',
    'dry_penalty_last_n',
    'xtc_probability',
    'xtc_threshold',
  ])
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null || value === '') continue
    if (
      scalarKeys.has(key) &&
      ((typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))
    )
      continue
    if (
      typeof value === 'string' &&
      enumerations.has(key) &&
      /^[a-z_-]{1,32}$/.test(value)
    )
      continue
    if (key === 'stop_sequences' && Array.isArray(value) && value.length === 0)
      continue
    throw new Error(
      'El modo protegido no admite opciones extra con texto u objetos fuera de la revisión SDK. Retira gramáticas, esquemas o secuencias personalizadas antes de enviar.'
    )
  }
}
