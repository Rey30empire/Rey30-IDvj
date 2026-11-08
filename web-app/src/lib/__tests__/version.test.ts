import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to mock isDev before importing version module
vi.mock('../utils', () => ({
  isDev: vi.fn(() => false),
}))

describe('version', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('isNightly is true when VERSION contains hyphen', async () => {
    vi.stubGlobal('VERSION', '1.0.0-nightly')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isNightly).toBe(true)
  })

  it('isBeta is true when VERSION contains beta', async () => {
    vi.stubGlobal('VERSION', '1.0.0-beta')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isBeta).toBe(true)
  })

  it('isProd is true when VERSION has no hyphen, no beta, and not dev', async () => {
    vi.stubGlobal('VERSION', '1.0.0')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isProd).toBe(true)
    expect(mod.isNightly).toBe(false)
    expect(mod.isBeta).toBe(false)
  })

  it('isProd is false when isDev returns true', async () => {
    vi.stubGlobal('VERSION', '1.0.0')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => true) }))
    const mod = await import('../version')
    expect(mod.isProd).toBe(false)
  })

  it('isCoworkEnabled is true on nightly and on the dev server', async () => {
    vi.stubGlobal('VERSION', '1.0.0-nightly')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    expect((await import('../version')).isCoworkEnabled()).toBe(true)

    vi.resetModules()
    vi.stubGlobal('VERSION', '1.0.0')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => true) }))
    expect((await import('../version')).isCoworkEnabled()).toBe(true)
  })

  it('isCoworkEnabled is false on beta and on stable releases', async () => {
    vi.stubGlobal('VERSION', '1.0.0-beta')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    expect((await import('../version')).isCoworkEnabled()).toBe(false)

    vi.resetModules()
    vi.stubGlobal('VERSION', '1.0.0')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    expect((await import('../version')).isCoworkEnabled()).toBe(false)
  })

  it('enables the stable Windows workspace only with a native bridge', async () => {
    vi.stubGlobal('VERSION', '1.0.0')
    vi.stubGlobal('IS_WINDOWS', true)
    vi.stubGlobal('IS_WEB_APP', false)
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    const mod = await import('../version')
    expect(mod.isCoworkEnabled()).toBe(false)
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    expect(mod.isCoworkEnabled()).toBe(true)
  })

  it('preserves the beta gate and leaves stable non-Windows builds gated', async () => {
    vi.stubGlobal('IS_WEB_APP', false)
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    vi.stubGlobal('IS_WINDOWS', true)
    vi.stubGlobal('VERSION', '1.0.0-beta')
    vi.doMock('../utils', () => ({ isDev: vi.fn(() => false) }))
    expect((await import('../version')).isCoworkEnabled()).toBe(false)
    vi.resetModules()
    vi.stubGlobal('IS_WINDOWS', false)
    vi.stubGlobal('VERSION', '1.0.0')
    expect((await import('../version')).isCoworkEnabled()).toBe(false)
  })
})
