import { create } from 'zustand'
import {
  loadPrivacySettings,
  savePrivacySettings,
  type PrivacyMode,
} from '@/lib/privacySettings'

export type { PrivacyMode }
type PrivacyState = {
  mode: PrivacyMode
  loaded: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  setMode: (mode: PrivacyMode) => Promise<void>
}
let loading: Promise<void> | undefined
export const usePrivacyMode = create<PrivacyState>((set, get) => ({
  mode: 'standard',
  loaded: false,
  saving: false,
  error: null,
  load: async () => {
    if (loading) return loading
    loading = (async () => {
      try {
        set({ mode: await loadPrivacySettings(), loaded: true, error: null })
      } catch (error) {
        set({
          loaded: false,
          error:
            error instanceof Error
              ? error.message
              : 'No se pudo leer la política de privacidad.',
        })
        throw error
      }
    })().finally(() => {
      loading = undefined
    })
    return loading
  },
  setMode: async (mode) => {
    if (get().saving)
      throw new Error('Espera a que termine el guardado de privacidad.')
    set({ saving: true, error: null })
    try {
      await savePrivacySettings(mode)
      set({ mode, loaded: true, error: null })
    } catch (error) {
      set({
        loaded: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar la política de privacidad.',
      })
      throw error
    } finally {
      set({ saving: false })
    }
  },
}))
