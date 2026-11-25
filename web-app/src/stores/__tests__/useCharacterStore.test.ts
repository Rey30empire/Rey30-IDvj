import { describe, expect, it, vi } from 'vitest'
import { createCharacterStore } from '../useCharacterStore'
import { createDefaultCharacterData, getOriginalProfile, RETIRED_CHARACTER_IDS, upgradeSavedCharacters } from '@/lib/characters/profiles'
import { CharacterStorageError } from '@/lib/characters/persistence'

function fixture(raw: string | null = null) {
  let saved = raw
  const storage = { read: vi.fn(async () => saved), write: vi.fn(async (value: string) => { saved = value }) }
  return { store: createCharacterStore(storage), storage, read: () => saved }
}

/**
 * A save from a build that still shipped the nine retired assistants: all
 * eleven built-ins, a copy of Beto (active), a copy of Pluma, and Pluma's own
 * settings, model, voice and memory.
 */
function saveWithRetiredAssistants() {
  const retired = RETIRED_CHARACTER_IDS.map((id) => ({ ...getOriginalProfile('coder'), id, baseId: id, name: `Retirado ${id}` }))
  const pluma = getOriginalProfile('literatura')
  pluma.settings.userNickname = 'R'
  pluma.modelBinding = { providerId: 'llamacpp', modelId: 'mi-modelo' }
  pluma.voice = { ...pluma.voice, enabled: true, plumaClone: true, rate: 0.9 }
  const coder = getOriginalProfile('coder')
  coder.modelBinding = { providerId: 'llamacpp', modelId: 'coder-modelo' }
  const betoCopy = { ...structuredClone(retired[1]), id: 'custom-beto-copia', name: 'Beto (copia)' }
  const plumaCopy = { ...structuredClone(pluma), id: 'custom-pluma-copia', name: 'Pluma (copia)' }
  return {
    schema: 1,
    enabled: true,
    activeCharacterId: 'beto',
    activeAgents: ['literatura', 'kairo', 'coder', 'beto', 'custom-beto-copia', 'custom-pluma-copia'],
    profiles: [...retired, pluma, coder, betoCopy, plumaCopy],
    individualMemory: {
      beto: { enabled: true, notes: 'Nota de Beto' },
      'custom-beto-copia': { enabled: true, notes: 'Nota de la copia' },
      literatura: { enabled: true, notes: 'Nota de Pluma' },
    },
    sharedMemory: { 'equipo-a': { enabled: true, notes: 'Proyecto existente' } },
  }
}

describe('persistencia independiente de personajes', () => {
  it('marca saving desde que se pide el cambio hasta la última escritura pendiente', async () => {
    const { store } = fixture()
    await store.getState().load()
    const profile = store.getState().profiles[0]
    const first = store.getState().updateProfile(profile)
    expect(store.getState().saving).toBe(true)
    const second = store.getState().updateProfile(profile)
    await first
    expect(store.getState().saving).toBe(true)
    await second
    expect(store.getState().saving).toBe(false)
  })
  it('no deja saving puesto si la carga previa falla', async () => {
    const { store, storage } = fixture()
    storage.read.mockRejectedValueOnce(new Error('sin disco'))
    await expect(store.getState().setEnabled(true)).rejects.toThrow()
    expect(store.getState().saving).toBe(false)
  })
  it('quita saving tras una escritura fallida', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    storage.write.mockRejectedValueOnce(new Error('disco lleno'))
    await expect(store.getState().setEnabled(true)).rejects.toThrow()
    expect(store.getState().saving).toBe(false)
  })
  it('does not opt into characters or memory or write anything when opening a fresh profile', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    expect(store.getState()).toMatchObject({ loaded: true, enabled: false, activeCharacterId: 'literatura', activeAgents: ['literatura', 'coder'], individualMemory: {}, sharedMemory: {} })
    expect(store.getState().profiles.map(({ id }) => id)).toEqual(['literatura', 'coder'])
    expect(storage.write).not.toHaveBeenCalled()
    await store.getState().selectCharacter('coder')
    expect(store.getState()).toMatchObject({ enabled: true, activeCharacterId: 'coder' })
  })
  it('rehydrates custom settings, optional model references and explicit memory on a new store', async () => {
    const { store, read } = fixture()
    await store.getState().selectCharacter('coder')
    const profile = structuredClone(store.getState().profiles[1])
    profile.settings.humor = 0
    profile.modelBinding = { providerId: 'llamacpp', modelId: 'Qwen3.5-9B-Q4_K_M' }
    await store.getState().updateProfile(profile)
    await store.getState().setIndividualMemory('coder', { enabled: true, notes: 'Prefiero explicaciones cortas.' })
    const restarted = fixture(read()).store
    await restarted.getState().load()
    expect(restarted.getState().profiles[1]).toEqual(profile)
    expect(restarted.getState().getMemory('coder').individual.notes).toContain('cortas')
    expect(restarted.getState().getMemory('literatura').individual.enabled).toBe(false)
  })
  it('puts a missing Coder back switched on, keeps the user profiles and saves it once', async () => {
    const data: Record<string, unknown> & ReturnType<typeof createDefaultCharacterData> = createDefaultCharacterData()
    data.profiles = data.profiles.filter(({ id }) => id !== 'coder')
    delete (data as Partial<typeof data>).activeAgents
    data.enabled = true
    const [pluma] = data.profiles
    pluma.name = 'Plumita'
    pluma.voice = { ...pluma.voice, enabled: true, voiceURI: 'espeak:es-419+f3', rate: 0.9 }
    pluma.modelBinding = { providerId: 'llamacpp', modelId: 'mi-modelo' }
    data.individualMemory.literatura = { enabled: true, notes: 'Preferencias de lectura' }
    data.sharedMemory['equipo-a'] = { enabled: true, notes: 'Proyecto existente' }
    for (let index = 0; index < 18; index++) {
      data.profiles.push({ ...structuredClone(pluma), id: `custom-${index}` })
    }

    const { store, storage } = fixture(JSON.stringify(data))
    await store.getState().load()
    expect(store.getState().profiles).toHaveLength(20)
    expect(store.getState().profiles[0]).toEqual(pluma)
    expect(store.getState().profiles.filter((profile) => profile.id.startsWith('custom-'))).toEqual(data.profiles.slice(1))
    expect(store.getState().profiles.at(-1)).toEqual(getOriginalProfile('coder'))
    expect(store.getState()).toMatchObject({
      enabled: true,
      activeCharacterId: 'literatura',
      activeAgents: ['literatura', 'coder'],
      individualMemory: data.individualMemory,
      sharedMemory: data.sharedMemory,
    })
    expect(storage.write).toHaveBeenCalledTimes(1)

    const restarted = fixture(storage.write.mock.calls[0][0])
    await restarted.store.getState().load()
    expect(restarted.store.getState().profiles).toHaveLength(20)
    expect(restarted.storage.write).not.toHaveBeenCalled()
  })
  it('switches agents on and off without touching their profiles', async () => {
    const { store, read } = fixture()
    await store.getState().setAgentActive('literatura', false)
    await store.getState().setAgentActive('coder', false)
    await store.getState().setAgentActive('literatura', true)
    expect(store.getState().activeAgents).toEqual(['literatura'])
    const restarted = fixture(read()).store
    await restarted.getState().load()
    expect(restarted.getState().activeAgents).toEqual(['literatura'])
    expect(restarted.getState().profiles.map(({ id }) => id)).toContain('coder')
  })
  it('separates shared project memory, retains it on character switch and clears only the selected entry', async () => {
    const { store } = fixture()
    await store.getState().setSharedMemory('project-a', { enabled: true, notes: 'Tarea A' })
    await store.getState().setSharedMemory('project-b', { enabled: true, notes: 'Tarea B' })
    await store.getState().selectCharacter('coder')
    expect(store.getState().getMemory('coder').shared.enabled).toBe(false)
    expect(store.getState().getMemory('coder', 'project-a').shared.notes).toBe('Tarea A')
    const detached = store.getState().getMemory('coder', 'project-a')
    detached.shared.notes = 'Mutado'
    expect(store.getState().getMemory('coder', 'project-a').shared.notes).toBe('Tarea A')
    await store.getState().clearSharedMemory('project-a')
    expect(store.getState().getMemory('coder', 'project-a').shared.enabled).toBe(false)
    expect(store.getState().getMemory('coder', 'project-b').shared.notes).toBe('Tarea B')
  })
  it('duplicates/imports without overwriting identity or transferring memory, then resets appearance independently', async () => {
    const { store } = fixture()
    await store.getState().load()
    await store.getState().setIndividualMemory('literatura', { enabled: true, notes: 'Nota privada' })
    const copy = await store.getState().duplicateProfile('literatura')
    const imported = await store.getState().importProfile(store.getState().exportProfile('literatura'))
    expect(new Set(store.getState().profiles.map(profile => profile.id)).size).toBe(4)
    expect(store.getState().getMemory(copy).individual.notes).toBe('')
    expect(store.getState().getMemory(imported).individual.notes).toBe('')
    expect(store.getState().exportProfile('literatura')).not.toContain('Nota privada')
    expect(store.getState().exportMemory('literatura')).toContain('Nota privada')
    const modified = structuredClone(store.getState().profiles[0])
    modified.avatar.primary = '#000000'
    await store.getState().updateProfile(modified)
    await store.getState().resetProfile('literatura')
    expect(store.getState().profiles[0].avatar.primary).not.toBe('#000000')
    expect(store.getState().getMemory('literatura').individual.notes).toBe('Nota privada')
  })
  it('commits before exposing success and serializes edits without losing another profile or project', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    let finish!: () => void
    storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = store.getState().selectCharacter('coder')
    await vi.waitFor(() => expect(storage.write).toHaveBeenCalled())
    expect(store.getState().saving).toBe(true)
    expect(store.getState().activeCharacterId).toBe('literatura')
    const next = store.getState().setSharedMemory('a', { enabled: true, notes: 'Conservar' })
    finish()
    await Promise.all([pending, next])
    expect(store.getState().activeCharacterId).toBe('coder')
    expect(store.getState().sharedMemory.a.notes).toBe('Conservar')
  })
  it('shows a safe storage failure, keeps confirmed state and never replaces unreadable storage', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    storage.write.mockRejectedValueOnce(new Error('private-provider-token'))
    await expect(store.getState().selectCharacter('coder')).rejects.toThrow('El cambio no se aplicó')
    expect(store.getState().activeCharacterId).toBe('literatura')
    expect(store.getState().error).not.toContain('private-provider-token')
    const broken = fixture('{')
    await expect(broken.store.getState().selectCharacter('coder')).rejects.toThrow('No se pudo leer')
    expect(broken.storage.write).not.toHaveBeenCalled()
    expect(broken.read()).toBe('{')
  })
  it('fails closed after an uncertain rollback and persists natural mode only for an enabled character', async () => {
    const { store, storage } = fixture(JSON.stringify(createDefaultCharacterData()))
    await store.getState().load()
    expect(await store.getState().applyModeInstruction('Háblame en serio')).toBeNull()
    await store.getState().selectCharacter('coder')
    expect(await store.getState().applyModeInstruction('Háblame en serio')).toBe('serio')
    expect(store.getState().profiles[1].settings.mode).toBe('serio')
    storage.write.mockRejectedValueOnce(new CharacterStorageError('Vuelve a cargar.', true))
    await expect(store.getState().setEnabled(false)).rejects.toThrow('Vuelve a cargar')
    expect(store.getState()).toMatchObject({ enabled: false, loaded: false, saving: false })
  })
  it('rejects dangerous IDs, credentials and invalid imports without writing', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    await expect(store.getState().setSharedMemory('__proto__', { enabled: true, notes: 'x' })).rejects.toThrow()
    await expect(store.getState().importProfile('{"version":1,"credentials":"secret"}')).rejects.toThrow()
    expect(storage.write).not.toHaveBeenCalled()
  })
})

describe('asistentes retirados en datos guardados', () => {
  it('keeps only Pluma, Coder and copies of them, hands the active character to Pluma and saves the result once', async () => {
    const old = saveWithRetiredAssistants()
    const { store, storage } = fixture(JSON.stringify(old))
    await store.getState().load()
    const state = store.getState()
    expect(state.profiles.map(({ id }) => id)).toEqual(['literatura', 'coder', 'custom-pluma-copia'])
    expect(state.profiles[0]).toEqual(old.profiles[9])
    expect(state.profiles[1]).toEqual(old.profiles[10])
    expect(state.profiles[2]).toEqual(old.profiles[12])
    expect(state).toMatchObject({
      loaded: true,
      error: null,
      enabled: true,
      activeCharacterId: 'literatura',
      activeAgents: ['literatura', 'coder', 'custom-pluma-copia'],
      individualMemory: { literatura: { enabled: true, notes: 'Nota de Pluma' } },
      sharedMemory: old.sharedMemory,
    })
    expect(Object.keys(state.individualMemory)).toEqual(['literatura'])

    expect(storage.write).toHaveBeenCalledTimes(1)
    const written = JSON.parse(storage.write.mock.calls[0][0])
    expect(written.profiles.map(({ id }: { id: string }) => id)).toEqual(['literatura', 'coder', 'custom-pluma-copia'])
    expect(written.activeCharacterId).toBe('literatura')
    expect(JSON.stringify(written)).not.toMatch(/beto|kairo|Retirado/)

    // Loading the cleaned save again changes nothing and writes nothing.
    const restarted = fixture(storage.write.mock.calls[0][0])
    await restarted.store.getState().load()
    expect(restarted.storage.write).not.toHaveBeenCalled()
    expect(restarted.store.getState().profiles).toEqual(state.profiles)
    expect(restarted.store.getState()).toMatchObject({ activeCharacterId: 'literatura', activeAgents: state.activeAgents, individualMemory: state.individualMemory })
  })
  it('still loads the cleaned data when writing it back fails', async () => {
    const { store, storage } = fixture(JSON.stringify(saveWithRetiredAssistants()))
    storage.write.mockRejectedValueOnce(new Error('disco lleno'))
    await store.getState().load()
    expect(store.getState()).toMatchObject({ loaded: true, error: null, activeCharacterId: 'literatura' })
    expect(store.getState().profiles.map(({ id }) => id)).toEqual(['literatura', 'coder', 'custom-pluma-copia'])
  })
  it('upgrades a parsed save idempotently and leaves a current or unrecognised one untouched', () => {
    const old = saveWithRetiredAssistants()
    old.activeCharacterId = 'custom-beto-copia'
    const upgraded = upgradeSavedCharacters(old) as typeof old
    expect(upgraded).not.toBe(old)
    expect(upgraded.activeCharacterId).toBe('literatura')
    expect(upgradeSavedCharacters(upgraded)).toBe(upgraded)
    const current = createDefaultCharacterData()
    expect(upgradeSavedCharacters(current)).toBe(current)
    expect(upgradeSavedCharacters('texto')).toBe('texto')
    expect(upgradeSavedCharacters({ profiles: 'no' })).toEqual({ profiles: 'no' })
  })
  it('brings back Pluma when a save lost her, switched on', () => {
    const data = createDefaultCharacterData()
    data.profiles = data.profiles.filter(({ id }) => id !== 'literatura')
    data.activeAgents = ['coder']
    data.activeCharacterId = 'coder'
    const upgraded = upgradeSavedCharacters(data) as typeof data
    expect(upgraded.profiles.map(({ id }) => id)).toEqual(['coder', 'literatura'])
    expect(upgraded.activeAgents).toEqual(['coder', 'literatura'])
    expect(upgraded.activeCharacterId).toBe('coder')
  })
})
