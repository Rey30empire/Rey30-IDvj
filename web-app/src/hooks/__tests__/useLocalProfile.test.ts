import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LOCAL_PROFILE, LOCAL_PROFILE_KEY, normalizeLocalProfile, readLocalProfile, useLocalProfile } from '../useLocalProfile'

describe('local profile persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.removeItem(LOCAL_PROFILE_KEY)
    useLocalProfile.setState({ profile: { ...DEFAULT_LOCAL_PROFILE } })
  })

  it('persists and reads the chosen name and avatar initials without changing existing application data', () => {
    localStorage.setItem('threads', 'existing-chats')
    localStorage.setItem('model-provider', 'existing-models')
    useLocalProfile.getState().saveProfile({ name: '  Reinier Tamayo  ', initials: 'rt' })
    expect(readLocalProfile()).toEqual({ name: 'Reinier Tamayo', initials: 'RT' })
    expect(useLocalProfile.getState().profile).toEqual(readLocalProfile())
    expect(localStorage.getItem('threads')).toBe('existing-chats')
    expect(localStorage.getItem('model-provider')).toBe('existing-models')
  })

  it.each(['null', '[]', '{"name":3}', '{bad json', '{"name":"","initials":"R30"}'])('falls back safely without overwriting damaged data: %s', (value) => {
    const storage = { getItem: vi.fn(() => value) }
    expect(readLocalProfile(storage)).toEqual(DEFAULT_LOCAL_PROFILE)
    expect(storage.getItem).toHaveBeenCalledWith(LOCAL_PROFILE_KEY)
  })

  it('leaves the current profile unchanged when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    expect(() => useLocalProfile.getState().saveProfile({ name: 'New name', initials: 'NN' })).toThrow('storage unavailable')
    expect(useLocalProfile.getState().profile).toEqual(DEFAULT_LOCAL_PROFILE)
  })

  it('rejects invalid fields before writing a profile', () => {
    expect(() => normalizeLocalProfile({ name: ' ', initials: 'R30' })).toThrow('name')
    expect(() => normalizeLocalProfile({ name: 'Rey30', initials: 'R!!' })).toThrow('initials')
    expect(() => useLocalProfile.getState().saveProfile({ name: 'x'.repeat(61), initials: 'RT' })).toThrow('name')
    expect(localStorage.getItem(LOCAL_PROFILE_KEY)).toBeNull()
  })

  it('keeps application startup usable when reading storage throws', () => {
    expect(readLocalProfile({ getItem: () => { throw new Error('storage blocked') } })).toEqual(DEFAULT_LOCAL_PROFILE)
  })
})
