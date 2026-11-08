import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ native: false, invoke: vi.fn() }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => h.native }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
import { CHARACTER_STORAGE_KEY, characterStorage } from '../persistence'

beforeEach(() => {
  h.native = false
  h.invoke.mockReset()
  localStorage.clear()
})
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

describe('almacenamiento de personajes en el perfil de la aplicación', () => {
  it('uses only its own localStorage key for web previews', async () => {
    localStorage.setItem('model-provider', 'preserve')
    await characterStorage.write('fixture')
    expect(await characterStorage.read()).toBe('fixture')
    expect(localStorage.getItem('model-provider')).toBe('preserve')
    expect(h.invoke).not.toHaveBeenCalled()
  })
  it('uses backend settings and an explicit disk commit in the native profile', async () => {
    h.native = true
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    h.invoke.mockResolvedValue(null)
    await characterStorage.write('new')
    expect(h.invoke.mock.calls).toEqual([
      ['settings_get', { key: CHARACTER_STORAGE_KEY }],
      ['settings_set', { key: CHARACTER_STORAGE_KEY, value: 'new' }],
      ['settings_commit'],
    ])
    expect(localStorage.getItem(CHARACTER_STORAGE_KEY)).toBeNull()
  })
  it.each([null, 'confirmed'])('recovers the exact previous native value after a failed commit: %s', async previous => {
    h.native = true
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    h.invoke.mockImplementation(async (command: string) => command === 'settings_get' ? previous : undefined)
    let commits = 0
    h.invoke.mockImplementation(async (command: string) => {
      if (command === 'settings_get') return previous
      if (command === 'settings_commit' && commits++ === 0) throw new Error('disk failure')
    })
    await expect(characterStorage.write('new')).rejects.toThrow('se conservó la configuración anterior')
    expect(h.invoke.mock.calls[3]).toEqual(previous === null
      ? ['settings_remove', { key: CHARACTER_STORAGE_KEY }]
      : ['settings_set', { key: CHARACTER_STORAGE_KEY, value: previous }])
    expect(commits).toBe(2)
  })
  it('marks an unsuccessful rollback as requiring reload without leaking native error details', async () => {
    h.native = true
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    h.invoke.mockImplementation(async (command: string) => {
      if (command === 'settings_get') return 'old'
      throw new Error('private-native-details')
    })
    const error = await characterStorage.write('new').catch(error => error)
    expect(error.recoveryRequired).toBe(true)
    expect(error.message).not.toContain('private-native-details')
  })
})
