import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import {
  ACCENT_COLORS,
  useInterfaceSettings,
} from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'
import { isPlatformTauri } from '@/lib/platform/utils'
import i18n from '@/i18n/setup'

const POINT_KEY = 'preferences-recovery-point-v1'
const BEFORE_DEFAULTS_KEY = 'preferences-before-defaults-v1'
const languages = [
  'en',
  'es',
  'fr',
  'it',
  'hi',
  'id',
  'pl',
  'vn',
  'zh-CN',
  'zh-TW',
  'de-DE',
  'cs',
  'pt-BR',
  'ko',
  'ja',
  'ru',
  'ca',
]
const boolean = (value: unknown) => typeof value === 'boolean'
const oneOf = (values: readonly unknown[]) => (value: unknown) =>
  values.includes(value)
const fields = {
  [localStorageKey.settingGeneral]: {
    currentLanguage: oneOf(languages),
    spellCheckChatInput: boolean,
    tokenCounterCompact: boolean,
    autoUpdateCheck: boolean,
    stripReasoningFromContext: boolean,
  },
  [localStorageKey.settingInterface]: {
    fontSize: oneOf(['14px', '15px', '16px', '18px', '20px']),
    messageZoom: oneOf([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]),
    accentColor: oneOf(ACCENT_COLORS.map((color) => color.value)),
    notificationPosition: oneOf([
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]),
    showTokenSpeed: boolean,
    coloredUserBubble: boolean,
    renderHtmlArtifacts: boolean,
    autoGenerateTitle: boolean,
  },
  [localStorageKey.theme]: { activeTheme: oneOf(['auto', 'light', 'dark']) },
} as const

type PreferenceValues = Record<string, Record<string, unknown>>
export type PreferencePoint = {
  version: 1
  createdAt: string
  values: PreferenceValues
}
export type PreferencePointKind = 'saved' | 'before-defaults'
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function selectPreferences(values: PreferenceValues): PreferenceValues {
  const selected: PreferenceValues = {}
  for (const [namespace, rules] of Object.entries(fields)) {
    const value = values[namespace]
    if (!object(value))
      throw new Error(
        'Faltan preferencias compatibles en el punto de configuración.'
      )
    selected[namespace] = {}
    for (const [key, valid] of Object.entries(rules)) {
      if (!valid(value[key])) throw new Error(`Preferencia no válida: ${key}`)
      selected[namespace][key] =
        namespace === localStorageKey.settingInterface &&
        key === 'fontSize' &&
        value[key] === '15px'
          ? '16px'
          : value[key]
    }
  }
  return selected
}

export function parsePreferencePoint(raw: string): PreferencePoint {
  if (raw.length > 64 * 1024)
    throw new Error('El punto de configuración supera el tamaño admitido.')
  let point: unknown
  try {
    point = JSON.parse(raw)
  } catch {
    throw new Error('El punto de configuración no contiene JSON válido.')
  }
  if (
    !object(point) ||
    point.version !== 1 ||
    typeof point.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(point.createdAt)) ||
    !object(point.values)
  ) {
    throw new Error('El punto de configuración no tiene un formato compatible.')
  }
  return {
    version: 1,
    createdAt: point.createdAt,
    values: selectPreferences(point.values as PreferenceValues),
  }
}

function currentValues(defaults = false): PreferenceValues {
  return selectPreferences({
    [localStorageKey.settingGeneral]: {
      ...(defaults
        ? useGeneralSetting.getInitialState()
        : useGeneralSetting.getState()),
    },
    [localStorageKey.settingInterface]: {
      ...(defaults
        ? useInterfaceSettings.getInitialState()
        : useInterfaceSettings.getState()),
    },
    [localStorageKey.theme]: {
      ...(defaults ? useTheme.getInitialState() : useTheme.getState()),
    },
  })
}

async function read(key: string): Promise<string | null> {
  if (!isPlatformTauri()) return localStorage.getItem(key)
  return (
    (await getServiceHub()
      .core()
      .invoke<string | null>('settings_get', { key })) ?? null
  )
}
async function write(key: string, value: string | null): Promise<void> {
  if (!isPlatformTauri()) {
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
  if (isPlatformTauri()) await getServiceHub().core().invoke('settings_commit')
}
const pointKey = (kind: PreferencePointKind) =>
  kind === 'saved' ? POINT_KEY : BEFORE_DEFAULTS_KEY

export async function getPreferencePoint(
  kind: PreferencePointKind = 'saved'
): Promise<PreferencePoint | null> {
  const raw = await read(pointKey(kind))
  return raw === null ? null : parsePreferencePoint(raw)
}
export async function savePreferencePoint(
  kind: PreferencePointKind = 'saved'
): Promise<PreferencePoint> {
  const point: PreferencePoint = {
    version: 1,
    createdAt: new Date().toISOString(),
    values: currentValues(),
  }
  const key = pointKey(kind)
  const previous = await read(key)
  await write(key, JSON.stringify(point))
  try {
    await commit()
  } catch (error) {
    try {
      await write(key, previous)
      await commit()
    } catch {
      throw new Error(
        'No se pudo guardar el punto de configuración. Revisa el acceso al almacenamiento antes de continuar.'
      )
    }
    throw error
  }
  return point
}

async function rehydratePreferences(): Promise<void> {
  await useTheme.persist.rehydrate()
  await getServiceHub()
    .theme()
    .setTheme(
      useTheme.getState().activeTheme === 'auto'
        ? null
        : (useTheme.getState().activeTheme as 'light' | 'dark')
    )
  await useInterfaceSettings.persist.rehydrate()
  await useGeneralSetting.persist.rehydrate()
  i18n.changeLanguage(useGeneralSetting.getState().currentLanguage)
}
async function applyPreferences(values: PreferenceValues): Promise<void> {
  const selected = selectPreferences(values)
  const versions: Record<string, number> = {
    [localStorageKey.settingGeneral]:
      useGeneralSetting.persist.getOptions().version ?? 0,
    [localStorageKey.settingInterface]:
      useInterfaceSettings.persist.getOptions().version ?? 0,
    [localStorageKey.theme]: useTheme.persist.getOptions().version ?? 0,
  }
  const previous = new Map<string, string | null>()
  const merged = new Map<string, string>()
  for (const [namespace, preferences] of Object.entries(selected)) {
    const raw = await read(namespace)
    previous.set(namespace, raw)
    let blob: unknown
    try {
      blob =
        raw === null
          ? { state: {}, version: versions[namespace] }
          : JSON.parse(raw)
    } catch {
      throw new Error(
        'Los ajustes actuales no contienen JSON válido; no se modificaron.'
      )
    }
    if (!object(blob) || !object(blob.state))
      throw new Error(
        'Los ajustes actuales no se pueden combinar de forma segura.'
      )
    if (blob.version !== undefined && blob.version !== versions[namespace])
      throw new Error(
        'Los ajustes actuales usan otra versión; no se modificarán desde esta recuperación.'
      )
    merged.set(
      namespace,
      JSON.stringify({ ...blob, state: { ...blob.state, ...preferences } })
    )
  }
  const changed: string[] = []
  let rehydrationStarted = false
  try {
    for (const [namespace, raw] of merged) {
      await write(namespace, raw)
      changed.push(namespace)
    }
    await commit()
    rehydrationStarted = true
    await rehydratePreferences()
    if (JSON.stringify(currentValues()) !== JSON.stringify(selected))
      throw new Error(
        'No se pudieron aplicar todas las preferencias; se recuperará la configuración anterior.'
      )
  } catch (error) {
    try {
      for (const namespace of changed.reverse())
        await write(namespace, previous.get(namespace) ?? null)
      if (changed.length) await commit()
      if (rehydrationStarted) await rehydratePreferences()
    } catch {
      throw new Error(
        'No se completó la restauración. Conserva el punto guardado y revisa los ajustes antes de continuar.'
      )
    }
    throw error
  }
}
export async function restorePreferencePoint(
  kind: PreferencePointKind = 'saved'
): Promise<void> {
  const point = await getPreferencePoint(kind)
  if (!point) throw new Error('Guarda primero un punto de configuración.')
  await applyPreferences(point.values)
}
export async function applyDefaultPreferences(): Promise<void> {
  await savePreferencePoint('before-defaults')
  await applyPreferences(currentValues(true))
}

export async function resetPreferences(): Promise<'saved' | 'defaults'> {
  const point = await getPreferencePoint()
  if (!point) {
    await applyDefaultPreferences()
    return 'defaults'
  }
  await savePreferencePoint('before-defaults')
  await applyPreferences(point.values)
  return 'saved'
}
