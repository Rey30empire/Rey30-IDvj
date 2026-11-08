import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'

export const CHARACTER_STORAGE_KEY = 'rey30-characters-v1'
export type CharacterStorage = { read(): Promise<string | null>; write(value: string): Promise<void> }
export class CharacterStorageError extends Error {
  constructor(message: string, readonly recoveryRequired = false) { super(message) }
}
const native = () => isPlatformTauri() && typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export const characterStorage: CharacterStorage = {
  async read() {
    if (!native()) return localStorage.getItem(CHARACTER_STORAGE_KEY)
    return await getServiceHub().core().invoke<string | null>('settings_get', { key: CHARACTER_STORAGE_KEY })
  },
  async write(value) {
    if (!native()) { localStorage.setItem(CHARACTER_STORAGE_KEY, value); return }
    const core = getServiceHub().core()
    const previous = await core.invoke<string | null>('settings_get', { key: CHARACTER_STORAGE_KEY })
    try {
      await core.invoke('settings_set', { key: CHARACTER_STORAGE_KEY, value })
      await core.invoke('settings_commit')
    } catch {
      try {
        await core.invoke(previous === null ? 'settings_remove' : 'settings_set', previous === null ? { key: CHARACTER_STORAGE_KEY } : { key: CHARACTER_STORAGE_KEY, value: previous })
        await core.invoke('settings_commit')
      } catch { throw new CharacterStorageError('No se pudo confirmar ni recuperar el archivo de personajes. Vuelve a cargarlo antes de editar.', true) }
      throw new CharacterStorageError('No se pudo guardar el cambio de personajes; se conservó la configuración anterior.')
    }
  },
}
