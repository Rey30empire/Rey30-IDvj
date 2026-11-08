import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failKey: '',
  failCommit: false,
  theme: vi.fn(),
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    core: () => ({
      invoke: async (
        command: string,
        args: { key: string; value?: string }
      ) => {
        if (command === 'settings_commit') {
          if (h.failCommit) {
            h.failCommit = false
            throw new Error('fixture commit failure')
          }
          return
        }
        if (command === 'settings_get') return h.values.get(args.key) ?? null
        if (command === 'settings_set') {
          if (args.key === h.failKey) {
            h.failKey = ''
            throw new Error('fixture write failure')
          }
          h.values.set(args.key, args.value!)
          return
        }
        if (command === 'settings_remove') {
          h.values.delete(args.key)
          return
        }
        throw new Error(`Forbidden command: ${command}`)
      },
    }),
    theme: () => ({ setTheme: h.theme }),
  }),
}))
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'
import { backendStorage } from '@/lib/backendStorage'
import i18n from '@/i18n/setup'
import {
  applyDefaultPreferences,
  getPreferencePoint,
  parsePreferencePoint,
  resetPreferences,
  restorePreferencePoint,
  savePreferencePoint,
} from '../preferences-recovery'

describe('preference recovery with isolated settings fixtures', () => {
  beforeEach(async () => {
    h.values.clear()
    i18n.changeLanguage('es')
    for (const key of ['setting-general', 'setting-appearance', 'theme'])
      await backendStorage.removeItem(key)
    h.failKey = ''
    h.failCommit = false
    h.theme.mockReset().mockResolvedValue(undefined)
    useGeneralSetting.setState({
      ...useGeneralSetting.getInitialState(),
      currentLanguage: 'es',
      huggingfaceToken: 'fixture-secret',
    })
    useInterfaceSettings.setState({
      ...useInterfaceSettings.getInitialState(),
      fontSize: '18px',
    })
    useTheme.setState({
      ...useTheme.getInitialState(),
      activeTheme: 'dark',
      isDark: true,
    })
    await Promise.resolve()
    h.values.set('model-provider', 'fixture-provider-and-credentials')
    h.values.set('threads', 'fixture-chats')
    h.values.set('setting-hardware', 'fixture-amd-device')
    h.values.set('mcp-global-permissions', 'fixture-mcp')
    h.values.set('assistants', 'fixture-assistants')
    h.values.set('skills', 'fixture-skills')
    h.values.set('plugins', 'fixture-plugins')
    h.values.set('llamacpp-settings', 'fixture-model-and-gpu-config')
  })

  it('saves without secrets and restores language/theme while preserving unrelated settings', async () => {
    const general = JSON.parse(h.values.get('setting-general')!)
    general.state.futureField = { preserved: true }
    h.values.set('setting-general', JSON.stringify(general))
    const protectedValues = [
      'model-provider',
      'threads',
      'setting-hardware',
      'mcp-global-permissions',
    ].map((key) => [key, h.values.get(key)])
    const point = await savePreferencePoint()
    expect(JSON.stringify(point)).not.toContain('fixture-secret')
    useGeneralSetting.setState({ currentLanguage: 'en' })
    useInterfaceSettings.setState({ fontSize: '14px' })
    useTheme.setState({ activeTheme: 'light' })
    const currentGeneral = JSON.parse(h.values.get('setting-general')!)
    currentGeneral.state.futureField = { preserved: true }
    h.values.set('setting-general', JSON.stringify(currentGeneral))
    await restorePreferencePoint()
    expect(useGeneralSetting.getState().currentLanguage).toBe('es')
    expect(useGeneralSetting.getState().huggingfaceToken).toBe('fixture-secret')
    expect(useInterfaceSettings.getState().fontSize).toBe('18px')
    expect(useTheme.getState().activeTheme).toBe('dark')
    expect(h.theme).toHaveBeenCalledWith('dark')
    expect(
      JSON.parse(h.values.get('setting-general')!).state.futureField
    ).toEqual({ preserved: true })
    for (const [key, value] of protectedValues)
      expect(h.values.get(key!)).toBe(value)
  })

  it('keeps the chosen point when defaults create a separate undo point', async () => {
    await savePreferencePoint()
    useGeneralSetting.setState({ currentLanguage: 'fr' })
    await applyDefaultPreferences()
    expect(useGeneralSetting.getState().currentLanguage).toBe(
      useGeneralSetting.getInitialState().currentLanguage
    )
    expect(
      (await getPreferencePoint())!.values['setting-general'].currentLanguage
    ).toBe('es')
    await restorePreferencePoint('before-defaults')
    expect(useGeneralSetting.getState().currentLanguage).toBe('fr')
  })

  it('resets to Spanish defaults without a chosen point and preserves all resource namespaces', async () => {
    useGeneralSetting.setState({ currentLanguage: 'en' })
    i18n.changeLanguage('en')
    useInterfaceSettings.setState({ accentColor: 'blue' })
    const keys = [
      'model-provider',
      'threads',
      'setting-hardware',
      'mcp-global-permissions',
      'assistants',
      'skills',
      'plugins',
      'llamacpp-settings',
    ]
    const protectedValues = keys.map((key) => [key, h.values.get(key)])
    expect(await resetPreferences()).toBe('defaults')
    expect(useGeneralSetting.getState().currentLanguage).toBe('es')
    expect(i18n.language).toBe('es')
    expect(useGeneralSetting.getState().huggingfaceToken).toBe('fixture-secret')
    expect(await getPreferencePoint()).toBeNull()
    expect(
      (await getPreferencePoint('before-defaults'))!.values['setting-general']
        .currentLanguage
    ).toBe('en')
    for (const [key, value] of protectedValues)
      expect(h.values.get(key!)).toBe(value)
    await restorePreferencePoint('before-defaults')
    expect(useGeneralSetting.getState().currentLanguage).toBe('en')
    expect(i18n.language).toBe('en')
  })

  it('resets to the chosen point and can undo without replacing that point', async () => {
    const point = await savePreferencePoint()
    useGeneralSetting.setState({ currentLanguage: 'fr' })
    expect(await resetPreferences()).toBe('saved')
    expect(useGeneralSetting.getState().currentLanguage).toBe('es')
    expect(await getPreferencePoint()).toEqual(point)
    await restorePreferencePoint('before-defaults')
    expect(useGeneralSetting.getState().currentLanguage).toBe('fr')
    expect(await getPreferencePoint()).toEqual(point)
  })

  it('migrates the legacy 15px point to the actual 16px interface setting', async () => {
    const point = await savePreferencePoint()
    point.values['setting-appearance'].fontSize = '15px'
    h.values.set('preferences-recovery-point-v1', JSON.stringify(point))
    await restorePreferencePoint()
    expect(useInterfaceSettings.getState().fontSize).toBe('16px')
    expect(
      document.documentElement.style.getPropertyValue('--font-size-base')
    ).toBe('16px')
  })

  it('accepts the blue accent offered by the current appearance settings', async () => {
    useInterfaceSettings.setState({ accentColor: 'blue' })
    const point = await savePreferencePoint()
    expect(point.values['setting-appearance'].accentColor).toBe('blue')
  })

  it('applies defaults with the current schema when a settings namespace is missing', async () => {
    useGeneralSetting.setState({ currentLanguage: 'en' })
    await Promise.resolve()
    h.values.delete('setting-general')
    await applyDefaultPreferences()
    expect(useGeneralSetting.getState().currentLanguage).toBe('es')
    expect(JSON.parse(h.values.get('setting-general')!).version).toBe(1)
  })

  it('updates the active translation language before reporting a completed restore', async () => {
    await savePreferencePoint()
    useGeneralSetting.setState({ currentLanguage: 'en' })
    i18n.changeLanguage('en')
    await restorePreferencePoint()
    expect(useGeneralSetting.getState().currentLanguage).toBe('es')
    expect(i18n.language).toBe('es')
  })

  it('rejects invalid points before changing any preferences', async () => {
    const point = await savePreferencePoint()
    point.values['setting-general'].currentLanguage = '../invalid'
    h.values.set('preferences-recovery-point-v1', JSON.stringify(point))
    const before = new Map(h.values)
    await expect(restorePreferencePoint()).rejects.toThrow('currentLanguage')
    expect(h.values).toEqual(before)
    expect(() => parsePreferencePoint('null')).toThrow()
  })

  it('ignores injected resource namespaces and credential fields from a point', async () => {
    const point = await savePreferencePoint()
    point.values['model-provider'] = { providers: [] }
    point.values['setting-general'].huggingfaceToken = 'replace-secret'
    h.values.set('preferences-recovery-point-v1', JSON.stringify(point))
    await restorePreferencePoint()
    expect(h.values.get('model-provider')).toBe(
      'fixture-provider-and-credentials'
    )
    expect(useGeneralSetting.getState().huggingfaceToken).toBe('fixture-secret')
  })
  it('preserves a future settings schema instead of claiming a successful rehydration', async () => {
    await savePreferencePoint()
    const raw = JSON.parse(h.values.get('setting-appearance')!)
    raw.version = 99
    h.values.set('setting-appearance', JSON.stringify(raw))
    const before = new Map(h.values)
    await expect(restorePreferencePoint()).rejects.toThrow('otra versión')
    expect(h.values).toEqual(before)
  })

  it('rolls back a partial settings write instead of reporting a completed restore', async () => {
    await savePreferencePoint()
    useGeneralSetting.setState({ currentLanguage: 'en' })
    await Promise.resolve()
    const before = new Map(h.values)
    h.failKey = 'setting-appearance'
    await expect(restorePreferencePoint()).rejects.toThrow(
      'fixture write failure'
    )
    expect(h.values).toEqual(before)
    expect(useGeneralSetting.getState().currentLanguage).toBe('en')
  })
  it('does not retain a new point if the durable commit fails', async () => {
    const before = new Map(h.values)
    h.failCommit = true
    await expect(savePreferencePoint()).rejects.toThrow(
      'fixture commit failure'
    )
    expect(h.values).toEqual(before)
    expect(await getPreferencePoint()).toBeNull()
  })
  it('rolls back a restore when its durable commit fails before applying UI state', async () => {
    await savePreferencePoint()
    useGeneralSetting.setState({ currentLanguage: 'en' })
    const before = new Map(h.values)
    h.failCommit = true
    await expect(restorePreferencePoint()).rejects.toThrow(
      'fixture commit failure'
    )
    expect(h.values).toEqual(before)
    expect(useGeneralSetting.getState().currentLanguage).toBe('en')
    expect(h.theme).not.toHaveBeenCalled()
  })
})
