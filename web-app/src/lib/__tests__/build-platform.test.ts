import { describe, expect, it } from 'vitest'
import { resolveBuildPlatform } from '../../../build-platform'

describe('resolución de plataforma explícita o del host Tauri', () => {
  it.each([['win32', 'windows'], ['darwin', 'darwin'], ['linux', 'linux']])('maps native host %s only for a Tauri build', (hostPlatform, expected) => {
    expect(resolveBuildPlatform({ hostPlatform, isTauri: 'true' })).toBe(expected)
    expect(resolveBuildPlatform({ hostPlatform })).toBeUndefined()
    expect(resolveBuildPlatform({ hostPlatform, isTauri: 'false' })).toBeUndefined()
  })
  it.each(['android', 'ios', 'darwin', 'linux', 'windows', 'aarch64-apple-ios'])('preserves explicit %s on a Windows host', tauriPlatform => {
    expect(resolveBuildPlatform({ hostPlatform: 'win32', isTauri: 'true', tauriPlatform })).toBe(tauriPlatform)
  })
  it('does not infer a desktop platform for unknown hosts or non-boolean opt-ins', () => {
    expect(resolveBuildPlatform({ hostPlatform: 'aix', isTauri: 'true' })).toBeUndefined()
    expect(resolveBuildPlatform({ hostPlatform: 'win32', isTauri: '1' })).toBeUndefined()
    expect(resolveBuildPlatform({ hostPlatform: 'win32', isTauri: 'false', tauriPlatform: '' })).toBeUndefined()
  })
})
