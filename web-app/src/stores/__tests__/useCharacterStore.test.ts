import { describe, expect, it, vi } from 'vitest'
import { createCharacterStore } from '../useCharacterStore'
import { createDefaultCharacterData, LEGACY_CHARACTER_IDS } from '@/lib/characters/profiles'
import { CharacterStorageError } from '@/lib/characters/persistence'

function fixture(raw: string | null = null) {
  let saved = raw
  const storage = { read: vi.fn(async () => saved), write: vi.fn(async (value: string) => { saved = value }) }
  return { store: createCharacterStore(storage), storage, read: () => saved }
}
describe('persistencia independiente de personajes', () => {
  it('does not opt into characters or memory or write anything when opening a fresh profile', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    expect(store.getState()).toMatchObject({ loaded: true, enabled: false, activeCharacterId: 'kairo', individualMemory: {}, sharedMemory: {} })
    expect(storage.write).not.toHaveBeenCalled()
    await store.getState().selectCharacter('roco')
    expect(store.getState()).toMatchObject({ enabled: true, activeCharacterId: 'roco' })
  })
  it('rehydrates custom settings, optional model references and explicit memory on a new store', async () => {
    const { store, read } = fixture()
    await store.getState().selectCharacter('nara')
    const profile = structuredClone(store.getState().profiles[5])
    profile.settings.flirtation = 0
    profile.modelBinding = { providerId: 'llamacpp', modelId: 'Jan-v3.5-4B-Q4_K_XL' }
    await store.getState().updateProfile(profile)
    await store.getState().setIndividualMemory('nara', { enabled: true, notes: 'Prefiero explicaciones cortas.' })
    const restarted = fixture(read()).store
    await restarted.getState().load()
    expect(restarted.getState().profiles[5]).toEqual(profile)
    expect(restarted.getState().getMemory('nara').individual.notes).toContain('cortas')
    expect(restarted.getState().getMemory('kairo').individual.enabled).toBe(false)
  })
  it('renames default identities and adds specialists without replacing user settings or profiles', async () => {
    const data = createDefaultCharacterData()
    data.profiles = data.profiles.filter((profile) => LEGACY_CHARACTER_IDS.includes(profile.baseId))
    data.enabled = true
    data.activeCharacterId = 'nara'
    const [atlas, forja] = data.profiles
    atlas.name = 'Kairo Voltán'
    atlas.voice = { ...atlas.voice, enabled: true, voiceURI: 'espeak:es-419+m3', rate: 0.9 }
    atlas.modelBinding = { providerId: 'llamacpp', modelId: 'mi-modelo' }
    atlas.settings.userNickname = 'R'
    atlas.examples[0].response = 'Saludo personalizado'
    forja.name = 'Backend personal'
    data.individualMemory.kairo = { enabled: true, notes: 'Preferencias de arquitectura' }
    data.sharedMemory['equipo-a'] = { enabled: true, notes: 'Proyecto existente' }
    for (let index = 0; index < 18; index++) {
      data.profiles.push({ ...structuredClone(forja), id: `custom-${index}` })
    }

    const { store, storage, read } = fixture(JSON.stringify(data))
    await store.getState().load()
    expect(store.getState().profiles).toHaveLength(28)
    expect(store.getState().profiles[0]).toEqual({ ...atlas, name: 'Atlas' })
    expect(store.getState().profiles[1]).toEqual(forja)
    expect(store.getState().profiles.filter((profile) => profile.id.startsWith('custom-'))).toEqual(data.profiles.slice(6))
    expect(store.getState().profiles.slice(-4).map((profile) => profile.id)).toEqual(['centinela', 'verso', 'fullstack', 'literatura'])
    expect(store.getState()).toMatchObject({
      enabled: true,
      activeCharacterId: 'nara',
      individualMemory: data.individualMemory,
      sharedMemory: data.sharedMemory,
    })
    expect(storage.write).not.toHaveBeenCalled()

    await store.getState().updateProfile({ ...store.getState().profiles[0], name: 'Kairo Voltán' })
    const restarted = fixture(read()).store
    await restarted.getState().load()
    expect(restarted.getState().profiles[0].name).toBe('Kairo Voltán')
    expect(restarted.getState().profiles).toHaveLength(28)
  })
  it('adds the two new profiles to a 0.9.6 store without rerunning the old rename', async () => {
    const data = createDefaultCharacterData()
    data.profiles = data.profiles.filter(({ id }) => id !== 'fullstack' && id !== 'literatura')
    data.profiles[0].name = 'Kairo Voltán'
    data.profiles[0].examples[0].response = 'Mi saludo guardado.'
    data.profiles[0].modelBinding = { providerId: 'llamacpp', modelId: 'Jan-v3.5-4B-Q4_K_XL' }
    const { store, storage } = fixture(JSON.stringify(data))
    await store.getState().load()
    expect(store.getState().profiles.slice(0, 8)).toEqual(data.profiles)
    expect(store.getState().profiles.slice(8).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'fullstack', name: 'Trama' },
      { id: 'literatura', name: 'Pluma' },
    ])
    expect(storage.write).not.toHaveBeenCalled()
  })
  it('separates shared project memory, retains it on character switch and clears only the selected entry', async () => {
    const { store } = fixture()
    await store.getState().setSharedMemory('project-a', { enabled: true, notes: 'Tarea A' })
    await store.getState().setSharedMemory('project-b', { enabled: true, notes: 'Tarea B' })
    await store.getState().selectCharacter('tino')
    expect(store.getState().getMemory('tino').shared.enabled).toBe(false)
    expect(store.getState().getMemory('tino', 'project-a').shared.notes).toBe('Tarea A')
    const detached = store.getState().getMemory('tino', 'project-a')
    detached.shared.notes = 'Mutado'
    expect(store.getState().getMemory('tino', 'project-a').shared.notes).toBe('Tarea A')
    await store.getState().clearSharedMemory('project-a')
    expect(store.getState().getMemory('tino', 'project-a').shared.enabled).toBe(false)
    expect(store.getState().getMemory('tino', 'project-b').shared.notes).toBe('Tarea B')
  })
  it('duplicates/imports without overwriting identity or transferring memory, then resets appearance independently', async () => {
    const { store } = fixture()
    await store.getState().load()
    await store.getState().setIndividualMemory('kairo', { enabled: true, notes: 'Nota privada' })
    const copy = await store.getState().duplicateProfile('kairo')
    const imported = await store.getState().importProfile(store.getState().exportProfile('kairo'))
    expect(new Set(store.getState().profiles.map(profile => profile.id)).size).toBe(12)
    expect(store.getState().getMemory(copy).individual.notes).toBe('')
    expect(store.getState().getMemory(imported).individual.notes).toBe('')
    expect(store.getState().exportProfile('kairo')).not.toContain('Nota privada')
    expect(store.getState().exportMemory('kairo')).toContain('Nota privada')
    const modified = structuredClone(store.getState().profiles[0])
    modified.avatar.primary = '#000000'
    await store.getState().updateProfile(modified)
    await store.getState().resetProfile('kairo')
    expect(store.getState().profiles[0].avatar.primary).not.toBe('#000000')
    expect(store.getState().getMemory('kairo').individual.notes).toBe('Nota privada')
  })
  it('commits before exposing success and serializes edits without losing another profile or project', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    let finish!: () => void
    storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = store.getState().selectCharacter('beto')
    await vi.waitFor(() => expect(store.getState().saving).toBe(true))
    expect(store.getState().activeCharacterId).toBe('kairo')
    const next = store.getState().setSharedMemory('a', { enabled: true, notes: 'Conservar' })
    finish()
    await Promise.all([pending, next])
    expect(store.getState().activeCharacterId).toBe('beto')
    expect(store.getState().sharedMemory.a.notes).toBe('Conservar')
  })
  it('shows a safe storage failure, keeps confirmed state and never replaces unreadable storage', async () => {
    const { store, storage } = fixture()
    await store.getState().load()
    storage.write.mockRejectedValueOnce(new Error('private-provider-token'))
    await expect(store.getState().selectCharacter('milo')).rejects.toThrow('El cambio no se aplicó')
    expect(store.getState().activeCharacterId).toBe('kairo')
    expect(store.getState().error).not.toContain('private-provider-token')
    const broken = fixture('{')
    await expect(broken.store.getState().selectCharacter('nara')).rejects.toThrow('No se pudo leer')
    expect(broken.storage.write).not.toHaveBeenCalled()
    expect(broken.read()).toBe('{')
  })
  it('fails closed after an uncertain rollback and persists natural mode only for an enabled character', async () => {
    const { store, storage } = fixture(JSON.stringify(createDefaultCharacterData()))
    await store.getState().load()
    expect(await store.getState().applyModeInstruction('Háblame en serio')).toBeNull()
    await store.getState().selectCharacter('nara')
    expect(await store.getState().applyModeInstruction('Háblame en serio')).toBe('serio')
    expect(store.getState().profiles[5].settings.mode).toBe('serio')
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
