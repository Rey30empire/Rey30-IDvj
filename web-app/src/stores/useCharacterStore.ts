import { create } from 'zustand'
import {
  createDefaultCharacterData,
  getOriginalProfile,
} from '@/lib/characters/profiles'
import {
  characterStorage,
  CharacterStorageError,
  type CharacterStorage,
} from '@/lib/characters/persistence'
import { detectCharacterMode } from '@/lib/characters/personality'
import {
  CHARACTER_LIMITS,
  CharacterValidationError,
  parseCharacterData,
  parseCharacterProfile,
  validateCharacterData,
  validateCharacterId,
  validateCharacterProfile,
  validateMemoryEntry,
  validateProjectId,
} from '@/lib/characters/validation'
import type {
  CharacterData,
  CharacterMemory,
  CharacterMode,
  CharacterModelBinding,
  CharacterProfile,
  MemoryEntry,
} from '@/lib/characters/types'

export type CharacterStore = CharacterData & {
  loaded: boolean
  saving: boolean
  error: string | null
  load(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setAgentActive(id: string, active: boolean): Promise<void>
  selectCharacter(id: string): Promise<void>
  updateProfile(profile: CharacterProfile): Promise<void>
  duplicateProfile(id: string): Promise<string>
  resetProfile(id: string): Promise<void>
  importProfile(json: string): Promise<string>
  exportProfile(id: string): string
  applyModeInstruction(
    userText: string,
    characterId?: string
  ): Promise<CharacterMode | null>
  fillMissingModelBindings(binding: CharacterModelBinding): Promise<number>
  setIndividualMemory(id: string, entry: MemoryEntry): Promise<void>
  setSharedMemory(projectId: string, entry: MemoryEntry): Promise<void>
  clearIndividualMemory(id: string): Promise<void>
  clearSharedMemory(projectId: string): Promise<void>
  exportMemory(id: string, projectId?: string): string
  getMemory(id: string, projectId?: string): CharacterMemory
}
const emptyMemory = (): MemoryEntry => ({ enabled: false, notes: '' })
function dataOf(state: CharacterStore): CharacterData {
  return structuredClone({
    schema: state.schema,
    enabled: state.enabled,
    activeCharacterId: state.activeCharacterId,
    activeAgents: state.activeAgents,
    profiles: state.profiles,
    individualMemory: state.individualMemory,
    sharedMemory: state.sharedMemory,
  })
}
export function createCharacterStore(
  storage: CharacterStorage = characterStorage
) {
  let loading: Promise<void> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  return create<CharacterStore>((set, get) => {
    const requireProfile = (id: string) => {
      validateCharacterId(id)
      const profile = get().profiles.find((item) => item.id === id)
      if (!profile)
        throw new CharacterValidationError(
          'No se encontró el personaje seleccionado.'
        )
      return profile
    }
    const mutate = <T>(
      change: (value: CharacterData) => { value: CharacterData; result: T }
    ): Promise<T> => {
      const operation = queue.then(async () => {
        await get().load()
        set({ saving: true, error: null })
        try {
          const next = change(dataOf(get()))
          const value = validateCharacterData(next.value)
          await storage.write(JSON.stringify(value))
          set({ ...value, saving: false, loaded: true, error: null })
          return next.result
        } catch (cause) {
          const error =
            cause instanceof CharacterValidationError ||
            cause instanceof CharacterStorageError
              ? cause.message
              : 'No se pudo guardar la configuración de personajes. El cambio no se aplicó.'
          set({
            saving: false,
            error,
            ...(cause instanceof CharacterStorageError && cause.recoveryRequired
              ? { loaded: false, enabled: false }
              : {}),
          })
          throw new Error(error)
        }
      })
      queue = operation.catch(() => {})
      return operation
    }
    return {
      ...createDefaultCharacterData(),
      loaded: false,
      saving: false,
      error: null,
      load: async () => {
        if (get().loaded) return
        if (loading) return loading
        loading = (async () => {
          try {
            const raw = await storage.read()
            set({
              ...(raw === null
                ? createDefaultCharacterData()
                : parseCharacterData(raw)),
              loaded: true,
              error: null,
            })
          } catch {
            set({
              loaded: false,
              enabled: false,
              error:
                'No se pudo leer la configuración de personajes. No se sobrescribió el archivo; vuelve a intentarlo.',
            })
            throw new Error(get().error!)
          }
        })().finally(() => {
          loading = undefined
        })
        return loading
      },
      setEnabled: (enabled) =>
        mutate((value) => ({
          value: { ...value, enabled },
          result: undefined,
        })),
      setAgentActive: (id, active) =>
        mutate((value) => {
          requireProfile(id)
          const others = value.activeAgents.filter((item) => item !== id)
          return {
            value: { ...value, activeAgents: active ? [...others, id] : others },
            result: undefined,
          }
        }),
      selectCharacter: (id) =>
        mutate((value) => {
          requireProfile(id)
          return {
            value: { ...value, activeCharacterId: id, enabled: true },
            result: undefined,
          }
        }),
      updateProfile: (profile) =>
        mutate((value) => {
          const validated = validateCharacterProfile(profile)
          requireProfile(validated.id)
          return {
            value: {
              ...value,
              profiles: value.profiles.map((item) =>
                item.id === validated.id ? validated : item
              ),
            },
            result: undefined,
          }
        }),
      duplicateProfile: (id) =>
        mutate((value) => {
          const original = requireProfile(id)
          if (value.profiles.length >= CHARACTER_LIMITS.profiles)
            throw new CharacterValidationError(
              'Se alcanzó el límite de personajes. No se añadió otra copia.'
            )
          const copyId = `custom-${crypto.randomUUID()}`
          const copy = validateCharacterProfile({
            ...structuredClone(original),
            id: copyId,
            name: `${original.name.slice(0, 65)} (copia)`,
            voice: { ...original.voice, enabled: false },
          })
          return {
            value: { ...value, profiles: [...value.profiles, copy], activeAgents: [...value.activeAgents, copyId] },
            result: copyId,
          }
        }),
      resetProfile: (id) =>
        mutate((value) => {
          const current = requireProfile(id)
          const reset = {
            ...getOriginalProfile(current.baseId),
            id: current.id,
          }
          return {
            value: {
              ...value,
              profiles: value.profiles.map((item) =>
                item.id === id ? reset : item
              ),
            },
            result: undefined,
          }
        }),
      importProfile: (json) =>
        mutate((value) => {
          const imported = parseCharacterProfile(json)
          if (value.profiles.length >= CHARACTER_LIMITS.profiles)
            throw new CharacterValidationError(
              'Se alcanzó el límite de personajes. No se importó otro perfil.'
            )
          const id = `custom-${crypto.randomUUID()}`
          const profile = {
            ...imported,
            id,
            voice: { ...imported.voice, enabled: false },
          }
          return {
            value: { ...value, profiles: [...value.profiles, profile], activeAgents: [...value.activeAgents, id] },
            result: id,
          }
        }),
      exportProfile: (id) =>
        JSON.stringify(
          {
            format: 'rey30-character-profile',
            version: 1,
            profile: validateCharacterProfile(requireProfile(id)),
          },
          null,
          2
        ),
      fillMissingModelBindings: (binding) =>
        mutate((value) => {
          let count = 0
          const profiles = value.profiles.map((profile) => {
            if (profile.modelBinding) return profile
            count += 1
            return { ...profile, modelBinding: { ...binding } }
          })
          return { value: { ...value, profiles }, result: count }
        }),
      applyModeInstruction: (text, characterId) => {
        if (!characterId && !get().enabled) return Promise.resolve(null)
        const id = characterId ?? get().activeCharacterId
        requireProfile(id)
        const mode = detectCharacterMode(text)
        if (!mode) return Promise.resolve(null)
        return mutate((value) => ({
          value: {
            ...value,
            profiles: value.profiles.map((profile) =>
              profile.id === id
                ? { ...profile, settings: { ...profile.settings, mode } }
                : profile
            ),
          },
          result: mode,
        }))
      },
      setIndividualMemory: (id, entry) =>
        mutate((value) => {
          requireProfile(id)
          return {
            value: {
              ...value,
              individualMemory: {
                ...value.individualMemory,
                [id]: validateMemoryEntry(entry),
              },
            },
            result: undefined,
          }
        }),
      setSharedMemory: (projectId, entry) =>
        mutate((value) => ({
          value: {
            ...value,
            sharedMemory: {
              ...value.sharedMemory,
              [validateProjectId(projectId)]: validateMemoryEntry(entry),
            },
          },
          result: undefined,
        })),
      clearIndividualMemory: (id) =>
        mutate((value) => {
          requireProfile(id)
          delete value.individualMemory[id]
          return { value, result: undefined }
        }),
      clearSharedMemory: (projectId) =>
        mutate((value) => {
          delete value.sharedMemory[validateProjectId(projectId)]
          return { value, result: undefined }
        }),
      getMemory: (id, projectId) => {
        requireProfile(id)
        return structuredClone({
          individual: get().individualMemory[id] ?? emptyMemory(),
          shared: projectId
            ? {
                ...(get().sharedMemory[validateProjectId(projectId)] ??
                  emptyMemory()),
                projectId,
              }
            : emptyMemory(),
        })
      },
      exportMemory: (id, projectId) =>
        JSON.stringify(
          {
            format: 'rey30-character-memory',
            version: 1,
            characterId: requireProfile(id).id,
            memory: get().getMemory(id, projectId),
          },
          null,
          2
        ),
    }
  })
}
export const useCharacterStore = createCharacterStore()
