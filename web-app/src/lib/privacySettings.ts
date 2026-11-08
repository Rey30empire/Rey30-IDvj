import { getServiceHub } from '@/hooks/useServiceHub'
import { useProductAnalytic } from '@/hooks/useAnalytic'
import { isPlatformTauri } from '@/lib/platform/utils'
import { localStorageKey } from '@/constants/localStorage'
import posthog from 'posthog-js'

export type PrivacyMode = 'standard' | 'local-only' | 'cloud-review'
export const PRIVACY_SETTINGS_KEY = 'privacy-mode-v1'
export const privacyModes: readonly PrivacyMode[] = [
  'standard',
  'local-only',
  'cloud-review',
]

function nativeStorage(): boolean {
  return (
    isPlatformTauri() &&
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}
async function read(key: string): Promise<string | null> {
  if (!nativeStorage()) return localStorage.getItem(key)
  return await getServiceHub()
    .core()
    .invoke<string | null>('settings_get', { key })
}
async function write(key: string, value: string | null): Promise<void> {
  if (!nativeStorage()) {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return
  }
  await getServiceHub()
    .core()
    .invoke(
      value === null ? 'settings_remove' : 'settings_set',
      value === null ? { key } : { key, value }
    )
}
async function commit(): Promise<void> {
  if (nativeStorage()) await getServiceHub().core().invoke('settings_commit')
}
export function disablePrivacyTelemetry(): void {
  useProductAnalytic.getState().setProductAnalytic(false)
  posthog.opt_out_capturing()
}
export async function loadPrivacySettings(): Promise<PrivacyMode> {
  try {
    const raw = await read(PRIVACY_SETTINGS_KEY)
    if (raw === null) return 'standard'
    const value: unknown = JSON.parse(raw)
    if (
      !value ||
      typeof value !== 'object' ||
      !('schema' in value) ||
      value.schema !== 1 ||
      !('mode' in value) ||
      !privacyModes.includes(value.mode as PrivacyMode)
    )
      throw new Error()
    const mode = value.mode as PrivacyMode
    if (mode !== 'standard') disablePrivacyTelemetry()
    return mode
  } catch {
    throw new Error(
      'No se pudo leer la política de privacidad. Revisa Ajustes > Privacidad antes de enviar.'
    )
  }
}
export async function savePrivacySettings(mode: PrivacyMode): Promise<void> {
  if (!privacyModes.includes(mode))
    throw new Error('Modo de privacidad no válido.')
  if (mode !== 'standard') disablePrivacyTelemetry()
  const previous = await read(PRIVACY_SETTINGS_KEY)
  if (mode !== 'standard') {
    const raw = await read(localStorageKey.productAnalytic)
    let value: { state?: Record<string, unknown>; version?: number } = {}
    try {
      if (raw !== null) value = JSON.parse(raw)
    } catch {
      throw new Error(
        'No se pudo actualizar la preferencia de telemetría; el modo no se cambió.'
      )
    }
    if (
      !value ||
      typeof value !== 'object' ||
      (value.state !== undefined &&
        (!value.state ||
          typeof value.state !== 'object' ||
          Array.isArray(value.state)))
    ) {
      throw new Error(
        'La preferencia de telemetría no tiene un formato compatible; el modo no se cambió.'
      )
    }
    await write(
      localStorageKey.productAnalytic,
      JSON.stringify({
        ...value,
        state: { ...value.state, productAnalytic: false },
        version: value.version ?? 0,
      })
    )
  }
  await write(PRIVACY_SETTINGS_KEY, JSON.stringify({ schema: 1, mode }))
  try {
    await commit()
  } catch {
    try {
      await write(PRIVACY_SETTINGS_KEY, previous)
      await commit()
    } catch {
      throw new Error(
        'No se pudo confirmar ni recuperar la política guardada. Se bloquearán los envíos hasta volver a leerla.'
      )
    }
    throw new Error(
      'No se pudo confirmar la política de privacidad; se conservó el modo anterior.'
    )
  }
}
