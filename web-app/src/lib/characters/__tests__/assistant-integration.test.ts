import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import {
  characterAssistantId,
  characterIdFromAssistantId,
  assistantModelBinding,
  ensureCharacterModelBindings,
  mergeAvailableAssistants,
  preferredCharacterModel,
  selectIntegratedAssistant,
  toCharacterAssistant,
} from '../assistant-integration'

const h = vi.hoisted(() => ({
  providers: [] as ModelProvider[],
  selectedModel: null as Model | null,
  selectModel: vi.fn(),
  saveCharacter: vi.fn<(value: string) => Promise<void>>(async () => {}),
  updateThread: vi.fn<(thread: unknown) => Promise<void>>(async () => {}),
  createAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
  stopAudio: vi.fn(),
}))
vi.mock('../audio', () => ({
  useCharacterAudio: { getState: () => ({ stop: h.stopAudio }) },
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    assistants: () => ({
      createAssistant: h.createAssistant,
      deleteAssistant: h.deleteAssistant,
    }),
    threads: () => ({ updateThread: h.updateThread }),
    path: () => ({ sep: () => '/' }),
  }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      providers: h.providers,
      selectedModel: h.selectedModel,
      selectModelProvider: h.selectModel,
    }),
  },
}))
vi.mock('@/stores/useCharacterStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/stores/useCharacterStore')>()
  return {
    ...actual,
    useCharacterStore: actual.createCharacterStore({
      read: async () => null,
      write: h.saveCharacter,
    }),
  }
})
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useAssistant, defaultAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import {
  useActiveCharacter,
  useAvailableAssistants,
} from '@/hooks/useAvailableAssistants'
import { createDefaultCharacterData } from '../profiles'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'

const provider = (id: string, models: string[], active = true): ModelProvider =>
  ({
    provider: id,
    active,
    models: models.map((id) => ({ id, capabilities: [] })),
    settings: [],
  }) as unknown as ModelProvider
const binding = { providerId: 'llamacpp', modelId: 'Qwen3.5-9B-Q4_K_M' }

describe('asistentes de personajes integrados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAvatarVoiceSession.getState().close()
    h.updateThread.mockResolvedValue(undefined)
    localStorage.clear()
    h.providers = [
      provider('llamacpp', [binding.modelId]),
      provider('openai', ['owned-remote']),
    ]
    h.selectedModel = h.providers[0].models[0]
    const data = createDefaultCharacterData()
    data.profiles = data.profiles.map((profile) => ({
      ...profile,
      modelBinding: { ...binding },
    }))
    useCharacterStore.setState({
      ...data,
      loaded: true,
      saving: false,
      error: null,
    })
    useAssistant.setState({
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
      defaultAssistantId: '',
      loading: false,
    })
    useThreads.setState({ threads: {}, currentThreadId: undefined })
  })

  it('proyecta solo los agentes activos sin duplicar perfiles ni persistir instrucciones personales como snapshot', async () => {
    const { result } = renderHook(useAvailableAssistants)
    expect(result.current.map((assistant) => assistant.id)).toEqual([
      'rey30',
      'character:literatura',
      'character:coder',
    ])
    const profile = useCharacterStore.getState().profiles[0]
    expect(toCharacterAssistant(profile)).toMatchObject({
      id: 'character:kairo',
      name: `Rey30-IDvj ${profile.name}`,
      instructions: '',
      parameters: {},
      model: { provider: 'llamacpp', id: binding.modelId },
    })
    expect(
      mergeAvailableAssistants(
        [defaultAssistant, toCharacterAssistant(profile)],
        useCharacterStore.getState().profiles
      )
    ).toHaveLength(12)
    await expect(
      useAssistant.getState().addAssistant(toCharacterAssistant(profile))
    ).rejects.toThrow('no se duplican')
    expect(h.createAssistant).not.toHaveBeenCalled()
    expect(h.saveCharacter).not.toHaveBeenCalled()
    expect(characterIdFromAssistantId('character:../bad')).toBeUndefined()
    expect(characterIdFromAssistantId('rey30')).toBeUndefined()
    expect(characterAssistantId('nara')).toBe('character:nara')
  })

  it('restaura predeterminado y último usado por id virtual manteniendo el id rey30 y la lista persistida separados', async () => {
    localStorage.setItem(localStorageKey.lastUsedAssistant, 'character:beto')
    act(() => useAssistant.getState().setAssistants([defaultAssistant]))
    await waitFor(() =>
      expect(useAssistant.getState().currentAssistant?.id).toBe(
        'character:beto'
      )
    )
    act(() => useAssistant.getState().setDefaultAssistant('character:roco'))
    expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(
      'character:roco'
    )
    act(() => useAssistant.getState().setAssistants([defaultAssistant]))
    await waitFor(() =>
      expect(useAssistant.getState().currentAssistant?.id).toBe(
        'character:roco'
      )
    )
    expect(useAssistant.getState().assistants).toEqual([defaultAssistant])
    expect(h.createAssistant).not.toHaveBeenCalled()
  })

  it('actualiza la proyección desde el perfil único sin sobrescribir su memoria ni otro asistente', async () => {
    useAssistant
      .getState()
      .setCurrentAssistant(
        toCharacterAssistant(useCharacterStore.getState().profiles[0])
      )
    const { result } = renderHook(useAvailableAssistants)
    await act(async () => {
      await useCharacterStore.getState().setAgentActive('kairo', true)
      await useCharacterStore.getState().setIndividualMemory('kairo', {
        enabled: true,
        notes: 'MEMORY_OWNED_QA',
      })
      const profile = structuredClone(useCharacterStore.getState().profiles[0])
      profile.name = 'Kairo propio QA'
      await useCharacterStore.getState().updateProfile(profile)
    })
    expect(
      result.current.find((item) => item.id === 'character:kairo')?.name
    ).toBe('Rey30-IDvj Kairo propio QA')
    expect(useAssistant.getState().currentAssistant?.name).toBe(
      'Rey30-IDvj Kairo propio QA'
    )
    expect(useCharacterStore.getState().individualMemory.kairo.notes).toBe(
      'MEMORY_OWNED_QA'
    )
    expect(useAssistant.getState().assistants).toEqual([defaultAssistant])
  })

  it('elige Qwen 9B para el asistente predeterminado y los asistentes Rey30-IDvj', () => {
    const local = provider('llamacpp', [
      'sentence-transformer-mini',
      'Phi-3.8B',
      binding.modelId,
    ])
    expect(
      preferredCharacterModel([provider('openai', [binding.modelId]), local])
    ).toEqual(binding)
    expect(
      preferredCharacterModel([
        provider('llamacpp', ['sentence-transformer-mini']),
      ])
    ).toBeNull()
    expect(assistantModelBinding('rey30', [local])).toEqual(binding)
    expect(assistantModelBinding('owned-assistant', [local])).toEqual(binding)
    expect(
      preferredCharacterModel([provider('llamacpp', [binding.modelId], false)])
    ).toBeNull()
    expect(
      preferredCharacterModel([provider('llamacpp', ['Large-70B'])])
    ).toBeNull()
    expect(
      preferredCharacterModel([provider('openai', [binding.modelId])])
    ).toBeNull()
  })

  it('completa bindings ausentes una vez, preservando otros modelos y memoria', async () => {
    const data = createDefaultCharacterData()
    data.profiles[0].modelBinding = null
    data.profiles[4].modelBinding = {
      providerId: 'openai',
      modelId: 'chosen-owned',
    }
    data.individualMemory.kairo = { enabled: false, notes: 'KEEP_OWNED_QA' }
    useCharacterStore.setState(data)
    await ensureCharacterModelBindings(h.providers)
    expect(h.saveCharacter).toHaveBeenCalledOnce()
    expect(useCharacterStore.getState().profiles).toEqual(
      data.profiles.map((profile) => ({
        ...profile,
        modelBinding: profile.modelBinding?.modelId === 'chosen-owned' ? profile.modelBinding : binding,
      }))
    )
    expect(useCharacterStore.getState().individualMemory.kairo.notes).toBe(
      'KEEP_OWNED_QA'
    )
    await ensureCharacterModelBindings(h.providers)
    expect(h.saveCharacter).toHaveBeenCalledOnce()
    expect(h.selectModel).not.toHaveBeenCalled()
  })

  it('guarda asistente y binding en un único cambio de hilo antes de publicar selección, sin activar motor', async () => {
    const old = {
      id: 'owned-thread',
      title: 'Owned thread',
      updated: 1,
      model: { provider: 'openai', id: 'owned-remote' },
      assistants: [defaultAssistant],
      metadata: { owned: { keep: true } },
    } as Thread
    useThreads.setState({
      threads: { 'owned-thread': old },
      currentThreadId: 'owned-thread',
    })
    let finish!: () => void
    h.updateThread.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const selecting = selectIntegratedAssistant(
      'character:tino',
      'owned-thread'
    )
    await waitFor(() => expect(h.updateThread).toHaveBeenCalledOnce())
    expect(useAssistant.getState().currentAssistant?.id).toBe('rey30')
    expect(useThreads.getState().threads['owned-thread']).toEqual(old)
    finish()
    await selecting
    expect(h.updateThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: binding.modelId, provider: 'llamacpp' },
        assistants: [
          expect.objectContaining({
            id: 'character:tino',
            instructions: '',
            model: { id: binding.modelId, provider: 'llamacpp' },
          }),
        ],
        metadata: old.metadata,
      })
    )
    expect(useAssistant.getState().currentAssistant?.id).toBe('character:tino')
    expect(h.selectModel).toHaveBeenCalledWith('llamacpp', binding.modelId)
    expect(useCharacterStore.getState().enabled).toBe(false)
    expect(h.createAssistant).not.toHaveBeenCalled()
  })

  it('no cambia selección visible/modelo si falla guardar el hilo y explica un binding inválido sin sustituirlo', async () => {
    const old = {
      id: 'owned-thread',
      title: 'Owned',
      updated: 1,
      model: { id: 'owned-remote', provider: 'openai' },
      assistants: [defaultAssistant],
    } as Thread
    useThreads.setState({ threads: { 'owned-thread': old } })
    h.updateThread.mockRejectedValueOnce(new Error('owned-disk-full'))
    await expect(
      selectIntegratedAssistant('character:roco', 'owned-thread')
    ).rejects.toThrow('owned-disk-full')
    expect(useThreads.getState().threads['owned-thread']).toEqual(old)
    expect(useAssistant.getState().currentAssistant?.id).toBe('rey30')
    expect(h.selectModel).not.toHaveBeenCalled()
    const profile = structuredClone(useCharacterStore.getState().profiles[4])
    profile.modelBinding = { providerId: 'openai', modelId: 'missing-owned' }
    await useCharacterStore.getState().updateProfile(profile)
    await expect(selectIntegratedAssistant('character:roco')).rejects.toThrow(
      'ya no está disponible'
    )
    expect(useCharacterStore.getState().profiles[4].modelBinding).toEqual(
      profile.modelBinding
    )
    expect(useAssistant.getState().currentAssistant?.id).toBe('rey30')
  })

  it('cancela voz y un envío pendiente sincrónicamente al cambiar de asistente, antes de resolver la nueva selección', async () => {
    const voice = useAvatarVoiceSession.getState()
    voice.openFor('kairo', null)
    useAvatarVoiceSession.getState().start()
    const generation = useAvatarVoiceSession.getState().generation
    useAvatarVoiceSession.setState({ phase: 'waiting' })
    const send = vi.fn()
    const pending = Promise.resolve().then(() => {
      const current = useAvatarVoiceSession.getState()
      if (current.open && current.active && current.generation === generation)
        send()
    })

    const selecting = selectIntegratedAssistant('character:nara')
    expect(useAvatarVoiceSession.getState()).toMatchObject({
      open: false,
      active: false,
    })
    expect(h.stopAudio).toHaveBeenCalledWith(`avatar:${generation}`)
    expect(useAssistant.getState().currentAssistant?.id).toBe('rey30')
    await pending
    await selecting
    expect(send).not.toHaveBeenCalled()
    expect(useAssistant.getState().currentAssistant?.id).toBe('character:nara')
  })

  it('deriva el personaje del hilo y no hereda el global al cargar, al elegir el predeterminado ni en model-only', () => {
    useAssistant
      .getState()
      .setCurrentAssistant(
        toCharacterAssistant(useCharacterStore.getState().profiles[0])
      )
    useThreads.setState({ currentThreadId: 'owned-thread', threads: {} })
    const { result } = renderHook(useActiveCharacter)
    expect(result.current).toBeUndefined()
    act(() =>
      useThreads.setState({
        threads: {
          'owned-thread': {
            id: 'owned-thread',
            title: 'Owned',
            updated: 1,
            assistants: [{ id: 'character:nara' }],
          } as Thread,
        },
      })
    )
    expect(result.current?.id).toBe('nara')
    for (const id of ['rey30', 'model-only']) {
      act(() =>
        useThreads.setState({
          threads: {
            'owned-thread': {
              id: 'owned-thread',
              title: 'Owned',
              updated: 1,
              assistants: [{ id }],
            } as Thread,
          },
        })
      )
      expect(result.current).toBeUndefined()
    }
    act(() => useThreads.setState({ currentThreadId: undefined }))
    expect(result.current?.id).toBe('kairo')
  })
})
