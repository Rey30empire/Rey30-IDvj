import type { CharacterModelBinding, CharacterProfile } from './types'
import { getCharacterChatRole } from './profiles'
import { useAvatarVoiceSession } from '@/stores/useAvatarVoiceSession'
import { useCharacterAudio } from './audio'
import { isLiteraryModelProvider, isLiteraryThread, literaryAssistantId } from '@/lib/literaryLibrary'

const PREFIX = 'character:'
const REY30_MODEL_ID = 'Qwen3.5-9B-Q4_K_M'
const DEFAULT_ASSISTANT_ID = 'rey30'
export type CharacterAssistant = Assistant & { model?: ThreadModel }

export function assistantDisplayName(id: string, name: string): string {
  if (id === DEFAULT_ASSISTANT_ID) return name.trim() ? name : 'Rey30 IDvj'
  const label = name.replace(/^Rey30[- ]IDvj\s*(?:[·:–-]\s*)?/i, '').trim()
  return label ? `Rey30-IDvj ${label}` : 'Rey30-IDvj'
}

export function characterAssistantId(id: string): string {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id))
    throw new Error('El identificador del personaje no es válido.')
  return `${PREFIX}${id}`
}

export function characterIdFromAssistantId(
  id: string | undefined
): string | undefined {
  if (!id?.startsWith(PREFIX)) return undefined
  const value = id.slice(PREFIX.length)
  return /^[a-z][a-z0-9-]{0,79}$/.test(value) ? value : undefined
}

export function toCharacterAssistant(
  profile: CharacterProfile
): CharacterAssistant {
  return {
    id: characterAssistantId(profile.id),
    name: assistantDisplayName(profile.id, profile.name),
    description:
      profile.id === profile.baseId
        ? getCharacterChatRole(profile).description
        : profile.description,
    created_at: 0,
    instructions: '',
    parameters: {},
    ...(profile.modelBinding
      ? {
          model: {
            id: profile.modelBinding.modelId,
            provider: profile.modelBinding.providerId,
          },
        }
      : {}),
  }
}

export function mergeAvailableAssistants(
  assistants: Assistant[],
  profiles: CharacterProfile[]
): Assistant[] {
  return [
    ...assistants.filter((assistant) => !assistant.id.startsWith(PREFIX)).map((assistant) => ({
      ...assistant,
      name: assistantDisplayName(assistant.id, assistant.name),
    })),
    ...profiles.map(toCharacterAssistant),
  ]
}

export function characterBindingModel(
  binding: CharacterModelBinding | null,
  providers: ModelProvider[]
): ThreadModel {
  if (!binding)
    throw new Error(
      'El personaje no tiene un modelo asignado. Elige un modelo disponible en su configuración.'
    )
  const provider = providers.find(
    (item) => item.provider === binding.providerId
  )
  const model = provider?.models.find((item) => item.id === binding.modelId)
  if (
    !provider ||
    provider.active === false ||
    !model ||
    model.capabilities?.includes('embeddings')
  ) {
    throw new Error(
      'El modelo asignado al personaje ya no está disponible. Elige otro modelo en su configuración.'
    )
  }
  return { provider: binding.providerId, id: binding.modelId }
}

export function preferredCharacterModel(
  providers: ModelProvider[],
  selectedModel?: Model | null
): CharacterModelBinding | null {
  const candidates = providers
    .filter(
      (provider) =>
        ['llamacpp', 'mlx'].includes(provider.provider) &&
        provider.active !== false
    )
    .flatMap((provider) =>
      provider.models
        .filter(
          (model) =>
            !model.capabilities?.includes('embeddings') &&
            !/embed|sentence[-_]transformer/i.test(model.id)
        )
        .map((model) => ({
          provider,
          model,
          text: `${model.id} ${model.displayName ?? ''}`,
        }))
    )
  const chosen =
    candidates.find(({ model }) => model.id === REY30_MODEL_ID) ??
    candidates.find(({ model, text }) => model.id === selectedModel?.id &&
      model.capabilities?.includes('tools') && /(?:^|[^\d.])[4-9](?:\.\d+)?b\b/i.test(text))
  return chosen
    ? { providerId: chosen.provider.provider, modelId: chosen.model.id }
    : null
}

export function assistantModelBinding(id: string, providers: ModelProvider[]): CharacterModelBinding | null {
  if (id !== DEFAULT_ASSISTANT_ID) return preferredCharacterModel(providers)
  const provider = providers.find((item) => item.provider === 'llamacpp' && item.active !== false)
  const model = provider?.models.find((item) => item.id === REY30_MODEL_ID)
  return model && provider ? { providerId: provider.provider, modelId: model.id } : null
}

export async function ensureCharacterModelBindings(
  providers: ModelProvider[],
  selectedModel?: Model | null
): Promise<CharacterModelBinding | null> {
  const binding = preferredCharacterModel(providers, selectedModel)
  if (!binding) return null
  const { useCharacterStore } = await import('@/stores/useCharacterStore')
  await useCharacterStore.getState().load()
  if (useCharacterStore.getState().profiles.some((profile) => !profile.modelBinding)) {
    await useCharacterStore.getState().fillMissingModelBindings(binding)
  }
  return binding
}

let selectionQueue: Promise<unknown> = Promise.resolve()

export function selectIntegratedAssistant(
  assistantId: string,
  threadId?: string
): Promise<void> {
  const voiceSession = useAvatarVoiceSession.getState()
  if (voiceSession.open) {
    const owner = `avatar:${voiceSession.generation}`
    voiceSession.close()
    useCharacterAudio.getState().stop(owner)
  }
  const operation = selectionQueue.then(async () => {
    const [
      { useAssistant },
      { useCharacterStore },
      { useModelProvider },
      { useThreads },
    ] = await Promise.all([
      import('@/hooks/useAssistant'),
      import('@/stores/useCharacterStore'),
      import('@/hooks/useModelProvider'),
      import('@/hooks/useThreads'),
    ])
    const id = characterIdFromAssistantId(assistantId)
    let assistant: Assistant | undefined
    let model: ThreadModel | undefined
    if (id) {
      await useCharacterStore.getState().load()
      await ensureCharacterModelBindings(
        useModelProvider.getState().providers,
        useModelProvider.getState().selectedModel
      )
      const profile = useCharacterStore
        .getState()
        .profiles.find((item) => item.id === id)
      if (!profile)
        throw new Error(
          'No se encontró el personaje seleccionado. Actualiza la lista de asistentes.'
        )
      model = characterBindingModel(
        profile.modelBinding,
        useModelProvider.getState().providers
      )
      if (assistantId === literaryAssistantId || (threadId && isLiteraryThread(useThreads.getState().threads[threadId]))) {
        const provider = useModelProvider.getState().getProviderByName(model.provider)
        if (!provider || !isLiteraryModelProvider(provider)) {
          throw new Error('Este chat de biblioteca requiere un modelo local gestionado por Rey30.')
        }
      }
      assistant = toCharacterAssistant(profile)
    } else if (assistantId && assistantId !== 'model-only') {
      assistant = useAssistant
        .getState()
        .assistants.find((item) => item.id === assistantId)
      if (!assistant)
        throw new Error(
          'No se encontró el asistente seleccionado. Actualiza la lista de asistentes.'
        )
      assistant = { ...assistant, name: assistantDisplayName(assistant.id, assistant.name) }
      const binding = assistantModelBinding(assistant.id, useModelProvider.getState().providers)
      if (binding) model = { provider: binding.providerId, id: binding.modelId }
      else if (assistant.id !== DEFAULT_ASSISTANT_ID) throw new Error('Instala Qwen3.5-9B para usar este asistente.')
    }
    if (threadId)
      await useThreads
        .getState()
        .assignThreadAssistant(threadId, assistant, model)
    useAssistant.getState().setCurrentAssistant(assistant)
    if (model)
      useModelProvider.getState().selectModelProvider(model.provider, model.id)
  })
  selectionQueue = operation.catch(() => {})
  return operation
}
