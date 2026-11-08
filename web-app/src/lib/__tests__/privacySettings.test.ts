import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPrivacySettings, PRIVACY_SETTINGS_KEY, savePrivacySettings } from '../privacySettings'
import { ensurePrivacyMode, getPrivacyModeSnapshot } from '../privacyPolicy'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), telemetry: vi.fn(), optOut: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: mocks.invoke }) }) }))
vi.mock('@/hooks/useAnalytic', () => ({ useProductAnalytic: { getState: () => ({ setProductAnalytic: mocks.telemetry }) } }))
vi.mock('posthog-js', () => ({ default: { opt_out_capturing: mocks.optOut } }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
const settings = new Map<string, string>()
beforeEach(() => {
  settings.clear(); vi.clearAllMocks()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  usePrivacyMode.setState({ mode: 'standard', loaded: false, error: null, saving: false })
  mocks.invoke.mockImplementation(async (command: string, args?: { key: string; value?: string }) => {
    if (command === 'settings_get') return settings.get(args!.key) ?? null
    if (command === 'settings_set') settings.set(args!.key, args!.value!)
    if (command === 'settings_remove') settings.delete(args!.key)
  })
})
afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__') })
describe('durable privacy preferences', () => {
  it('defaults to standard only after a successful policy read', async () => {
    expect(getPrivacyModeSnapshot()).toBe('local-only')
    expect(await ensurePrivacyMode()).toBe('standard')
    expect(getPrivacyModeSnapshot()).toBe('standard')
    expect(mocks.invoke).toHaveBeenCalledWith('settings_get', { key: PRIVACY_SETTINGS_KEY })
  })
  it('fails closed on unreadable or malformed backend policy without using a web fallback', async () => {
    localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify({ schema: 1, mode: 'standard' }))
    mocks.invoke.mockRejectedValueOnce(new Error('fixture IO failure'))
    await expect(ensurePrivacyMode()).rejects.toThrow('No se pudo leer')
    expect(getPrivacyModeSnapshot()).toBe('local-only')
    settings.set(PRIVACY_SETTINGS_KEY, 'fixture-invalid-json')
    await expect(loadPrivacySettings()).rejects.toThrow('No se pudo leer')
  })
  it('commits the mode and disables real telemetry setters before reporting success', async () => {
    settings.set('productAnalytic', JSON.stringify({ state: { productAnalytic: true, future: 'keep' }, version: 0 }))
    await usePrivacyMode.getState().setMode('cloud-review')
    expect(JSON.parse(settings.get(PRIVACY_SETTINGS_KEY)!)).toEqual({ schema: 1, mode: 'cloud-review' })
    expect(JSON.parse(settings.get('productAnalytic')!).state).toEqual({ productAnalytic: false, future: 'keep' })
    expect(mocks.telemetry).toHaveBeenCalledWith(false); expect(mocks.optOut).toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('settings_commit')
    expect(usePrivacyMode.getState().mode).toBe('cloud-review')
  })
  it('rolls back the previous policy if durable confirmation fails and exposes failure', async () => {
    const original = JSON.stringify({ schema: 1, mode: 'local-only' })
    settings.set(PRIVACY_SETTINGS_KEY, original)
    const normal = mocks.invoke.getMockImplementation()!
    let failed = false
    mocks.invoke.mockImplementation(async (...args) => { if (args[0] === 'settings_commit' && !failed) { failed = true; throw new Error('fixture write failure') }; return normal(...args) })
    await expect(usePrivacyMode.getState().setMode('standard')).rejects.toThrow('modo anterior')
    expect(settings.get(PRIVACY_SETTINGS_KEY)).toBe(original)
    expect(usePrivacyMode.getState().error).toContain('modo anterior')
    expect(getPrivacyModeSnapshot()).toBe('local-only')
  })
  it('never silently enables telemetry when returning to standard', async () => {
    await savePrivacySettings('standard')
    expect(mocks.telemetry).not.toHaveBeenCalledWith(true)
    settings.set(PRIVACY_SETTINGS_KEY, JSON.stringify({ schema: 1, mode: 'local-only' }))
    expect(await loadPrivacySettings()).toBe('local-only')
    expect(mocks.optOut).toHaveBeenCalled()
  })
})
