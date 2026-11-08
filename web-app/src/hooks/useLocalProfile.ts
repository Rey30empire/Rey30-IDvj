import { create } from 'zustand'

export const LOCAL_PROFILE_KEY = 'rey30-local-profile-v1'
export const DEFAULT_LOCAL_PROFILE = { name: 'Rey30', initials: 'R30' }
export type LocalProfile = { name: string; initials: string }

export function normalizeLocalProfile(profile: LocalProfile): LocalProfile {
  const name = profile.name.trim()
  const initials = profile.initials.trim().toUpperCase()
  if (!name || name.length > 60) throw new Error('name')
  if (!/^[\p{L}\p{N}]{1,3}$/u.test(initials)) throw new Error('initials')
  return { name, initials }
}

export function readLocalProfile(storage?: Pick<Storage, 'getItem'>): LocalProfile {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(LOCAL_PROFILE_KEY) ?? 'null')
    if (value && typeof value === 'object' && 'name' in value && 'initials' in value && typeof value.name === 'string' && typeof value.initials === 'string') {
      return normalizeLocalProfile({ name: value.name, initials: value.initials })
    }
  } catch { /* A damaged profile must not affect chats or application startup. */ }
  return { ...DEFAULT_LOCAL_PROFILE }
}

type LocalProfileState = {
  profile: LocalProfile
  saveProfile: (profile: LocalProfile) => void
}

export const useLocalProfile = create<LocalProfileState>((set) => ({
  profile: readLocalProfile(),
  saveProfile: (profile) => {
    const normalized = normalizeLocalProfile(profile)
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(normalized))
    set({ profile: normalized })
  },
}))
