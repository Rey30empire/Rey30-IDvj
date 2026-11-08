/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import { highlightFzfMatch } from '@/utils/highlight'
import Capabilities from './Capabilities'
import { IconSettings, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { ModelSetting } from '@/containers/ModelSetting'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { ModelSupportStatus } from '@/containers/ModelSupportStatus'
import { Fzf } from 'fzf'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { predefinedProviders } from '@/constants/providers'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { useServiceHub } from '@/hooks/useServiceHub'
import { getLastUsedModel } from '@/utils/getModelToStart'
import { ChevronsUpDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssistant } from '@/hooks/useAssistant'
import { useAvailableAssistants, useActiveCharacter } from '@/hooks/useAvailableAssistants'
import { assistantModelBinding, characterIdFromAssistantId, preferredCharacterModel, selectIntegratedAssistant } from '@/lib/characters/assistant-integration'
import { getCharacterChatRole } from '@/lib/characters/profiles'
import { isLiteraryModelProvider, isLiteraryThread, literaryAssistantId } from '@/lib/literaryLibrary'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { Button } from '@/components/ui/button'
import { useAssistantSwitcher } from '@/hooks/useAssistantSwitcher'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
  onModelChange?: (model: ThreadModel) => void
  allowAssistants?: boolean
  assistantId?: string
  onAssistantChange?: (id: string) => Promise<void> | void
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
}

// Helper functions for localStorage
const setLastUsedModel = (provider: string, model: string) => {
  try {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model })
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

const DropdownModelProvider = memo(function DropdownModelProvider({
  model,
  useLastUsedModel = false,
  onModelChange,
  allowAssistants = true,
  assistantId,
  onAssistantChange,
}: DropdownModelProviderProps) {
  const {
    providers,
    getProviderByName,
    selectModelProvider,
    getModelBy,
    selectedProvider,
    selectedModel,
    updateProvider,
  } = useModelProvider()
  const [displayModel, setDisplayModel] = useState<string>('')
  const { updateCurrentThreadModel, currentThreadId, threads } = useThreads()
  const { currentAssistant } = useAssistant()
  const assistants = useAvailableAssistants()
  const character = useActiveCharacter()
  const profiles = useCharacterStore((state) => state.profiles)
  const characterError = useCharacterStore((state) => state.error)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [selectorTab, setSelectorTab] = useState<'assistants' | 'models'>(allowAssistants ? 'assistants' : 'models')
  const assignedAssistant = allowAssistants
    ? assistantId !== undefined ? assistants.find(item => item.id === assistantId) : currentThreadId ? threads?.[currentThreadId]?.assistants?.[0] : currentAssistant
    : undefined
  const activeAssistant = assistants.find((item) => item.id === assignedAssistant?.id) ?? assignedAssistant
  const privateLibraryChat = allowAssistants && (activeAssistant?.id === literaryAssistantId || isLiteraryThread(currentThreadId ? threads?.[currentThreadId] : undefined))
  const fixedAssistantId = !character && activeAssistant?.id && !['rey30', 'model-only'].includes(activeAssistant.id) && !characterIdFromAssistantId(activeAssistant.id)
    ? activeAssistant.id
    : undefined
  const binding = allowAssistants && character
    ? character.modelBinding ?? preferredCharacterModel(providers, selectedModel)
    : fixedAssistantId ? assistantModelBinding(fixedAssistantId, providers) : undefined
  const bindingProvider = providers.find((item) => item.provider === binding?.providerId && item.active !== false && (!privateLibraryChat || isLiteraryModelProvider(item)))
  const boundModel = bindingProvider?.models.find((item) => item.id === binding?.modelId && !item.capabilities?.includes('embeddings'))
  const visibleModelName = allowAssistants && (character || fixedAssistantId)
    ? boundModel && bindingProvider
      ? `${getModelDisplayName(boundModel)} · ${getProviderTitle(bindingProvider.provider)}`
      : 'Modelo del asistente no disponible'
    : displayModel
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { favoriteModels } = useFavoriteModel()
  const serviceHub = useServiceHub()

  // Search state
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const assistantQuery = searchValue.trim().toLocaleLowerCase('es')
  const visibleAssistants = assistants.filter((item) => {
    const profile = profiles.find((candidate) => candidate.id === characterIdFromAssistantId(item.id))
    const role = profile ? getCharacterChatRole(profile).label : ''
    return `${item.name} ${role} ${item.description ?? ''}`.toLocaleLowerCase('es').includes(assistantQuery)
  })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const chooseAssistant = useCallback(async (id: string) => {
    setSelectionError(null)
    try {
      await selectIntegratedAssistant(id, assistantId !== undefined ? undefined : currentThreadId)
      await onAssistantChange?.(id)
      setOpen(false)
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'No se pudo seleccionar el asistente.')
    }
  }, [currentThreadId, assistantId, onAssistantChange])
  useEffect(() => {
    if (!allowAssistants) return
    useAssistantSwitcher.getState().setCycleHandler(() => {
      const index = assistants.findIndex((item) => item.id === activeAssistant?.id)
      const next = assistants[(index + 1) % assistants.length]
      if (next) void chooseAssistant(next.id)
    })
    return () => useAssistantSwitcher.getState().setCycleHandler(null)
  }, [allowAssistants, assistants, activeAssistant?.id, chooseAssistant])

  // Helper function to check if a model exists in providers
  const checkModelExists = useCallback(
    (providerName: string, modelId: string) => {
      const provider = providers.find(
        (p) => p.provider === providerName && p.active
      )
      return provider?.models.find((m) => m.id === modelId)
    },
    [providers]
  )

  // Helper function to get context size from model settings
  const getContextSize = useCallback((): number => {
    if (!selectedModel?.settings?.ctx_len?.controller_props?.value) {
      return 8192 // Default context size
    }
    return selectedModel.settings.ctx_len.controller_props.value as number
  }, [selectedModel?.settings?.ctx_len?.controller_props?.value])

  // Function to check if a llamacpp model has vision capabilities and update model capabilities
  const checkAndUpdateModelVisionCapability = useCallback(
    async (modelId: string) => {
      try {
        const hasVision = await serviceHub.models().checkMmprojExists(modelId)
        if (hasVision) {
          // Update the model capabilities to include 'vision'
          const provider = getProviderByName('llamacpp')
          if (provider) {
            const modelIndex = provider.models.findIndex(
              (m) => m.id === modelId
            )
            if (modelIndex !== -1) {
              const model = provider.models[modelIndex]
              const capabilities = model.capabilities || []

              // Add 'vision' capability if not already present AND if user hasn't manually configured capabilities
              // Check if model has a custom capabilities config flag

              const hasUserConfiguredCapabilities =
                (model as any)._userConfiguredCapabilities === true

              if (
                !capabilities.includes('vision') &&
                !hasUserConfiguredCapabilities
              ) {
                const updatedModels = [...provider.models]
                updatedModels[modelIndex] = {
                  ...model,
                  capabilities: [...capabilities, 'vision'],
                  // Mark this as auto-detected, not user-configured
                  _autoDetectedVision: true,
                } as any

                updateProvider('llamacpp', { models: updatedModels })
              }
            }
          }
        }
      } catch (error) {
        console.debug('Error checking mmproj for model:', modelId, error)
      }
    },
    [getProviderByName, updateProvider, serviceHub]
  )

  // Initialize model provider - avoid race conditions with manual selections
  useEffect(() => {
    const initializeModel = async () => {
      if (allowAssistants && (character || fixedAssistantId)) {
        if (binding && boundModel) selectModelProvider(binding.providerId, boundModel.id)
        else selectModelProvider('', '')
        return
      }
      // Auto select model when existing thread is passed
      if (model) {
        selectModelProvider(model?.provider as string, model?.id as string)
        if (!checkModelExists(model.provider, model.id)) {
          selectModelProvider('', '')
        }
        // Check mmproj existence for llamacpp models
        if (model?.provider === 'llamacpp') {
          await serviceHub
            .models()
            .checkMmprojExistsAndUpdateOffloadMMprojSetting(
              model.id as string,
              updateProvider,
              getProviderByName
            )
          // Also check vision capability
          await checkAndUpdateModelVisionCapability(model.id as string)
        }
      } else if (useLastUsedModel) {
        // Try to use last used model only when explicitly requested (for new chat)
        const lastUsed = getLastUsedModel()
        if (lastUsed && checkModelExists(lastUsed.provider, lastUsed.model)) {
          selectModelProvider(lastUsed.provider, lastUsed.model)
          if (lastUsed.provider === 'llamacpp') {
            await serviceHub
              .models()
              .checkMmprojExistsAndUpdateOffloadMMprojSetting(
                lastUsed.model,
                updateProvider,
                getProviderByName
              )
            // Also check vision capability
            await checkAndUpdateModelVisionCapability(lastUsed.model)
          }
        } else {
          // Fallback: auto-select first llamacpp model if available
          const llamacppProvider = providers.find(
            (p) => p.provider === 'llamacpp' && p.active && p.models.length > 0
          )
          if (llamacppProvider && llamacppProvider.models.length > 0) {
            const firstModel = llamacppProvider.models[0]
            selectModelProvider('llamacpp', firstModel.id)
            setLastUsedModel('llamacpp', firstModel.id)
          } else {
            selectModelProvider('', '')
          }
        }
      }
    }

    initializeModel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model,
    selectModelProvider,
    updateCurrentThreadModel,
    providers,
    checkModelExists,
    updateProvider,
    getProviderByName,
    checkAndUpdateModelVisionCapability,
    allowAssistants,
    fixedAssistantId,
    character?.id,
    binding?.providerId,
    boundModel?.id,

    // selectedModel and selectedProvider intentionally excluded to prevent race conditions
  ])

  // Update display model when selection changes
  useEffect(() => {
    if (selectedProvider && selectedModel) {
      setDisplayModel(getModelDisplayName(selectedModel))
    } else {
      setDisplayModel(t('common:selectAModel'))
    }
  }, [selectedProvider, selectedModel, t])

  // Check vision capabilities for all llamacpp models
  useEffect(() => {
    const checkAllLlamacppModelsForVision = async () => {
      const llamacppProvider = providers.find(
        (p) => p.provider === 'llamacpp' && p.active
      )
      if (llamacppProvider) {
        const checkPromises = llamacppProvider.models.map((model) =>
          checkAndUpdateModelVisionCapability(model.id)
        )
        await Promise.allSettled(checkPromises)
      }
    }

    if (open) {
      checkAllLlamacppModelsForVision()
    }
  }, [open, providers, checkAndUpdateModelVisionCapability])

  // Reset search value when dropdown closes
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      requestAnimationFrame(() => setSearchValue(''))
    } else {
      // Focus search input when opening
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [])

  // Clear search and focus input
  const onClearSearch = useCallback(() => {
    setSearchValue('')
    searchInputRef.current?.focus()
  }, [])

  // Create searchable items from all models
  const searchableItems = useMemo(() => {
    const items: SearchableModel[] = []

    providers.forEach((provider) => {
      if (!provider.active || (privateLibraryChat && !isLiteraryModelProvider(provider))) return

      provider.models.forEach((modelItem) => {
        // Skip embedding models - they can't be used for chat
        if (modelItem.embedding) return
        if (fixedAssistantId && (provider.provider !== binding?.providerId || modelItem.id !== binding.modelId)) return

        // Skip models that require API key but don't have one (except llamacpp)
        // For custom providers, allow if they have at least one model loaded
        const isPredefined = predefinedProviders.some((e) =>
          e.provider.includes(provider.provider)
        )
        if (
          provider &&
          provider.provider !== 'llamacpp' &&
          !providerHasRemoteApiKeys(provider) &&
          (isPredefined || provider.models.length === 0)
        )
          return

        const capabilities = modelItem.capabilities || []
        const capabilitiesString = capabilities.join(' ')
        const providerTitle = getProviderTitle(provider.provider)

        // Create search string with model id, provider, and capabilities
        const searchStr =
          `${modelItem.id} ${providerTitle} ${provider.provider} ${capabilitiesString}`.toLowerCase()

        items.push({
          provider,
          model: modelItem,
          searchStr,
          value: `${provider.provider}:${modelItem.id}`,
        })
      })
    })

    return items
  }, [providers, privateLibraryChat, fixedAssistantId, binding?.providerId, binding?.modelId])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item) =>
        `${getModelDisplayName(item.model)} ${item.model.id}`.toLowerCase(),
    })
  }, [searchableItems])

  // Get favorite models that are currently available
  const favoriteItems = useMemo(() => {
    return searchableItems.filter((item) =>
      favoriteModels.some((fav) => fav.id === item.model.id)
    )
  }, [searchableItems, favoriteModels])

  // Filter models based on search value
  const filteredItems = useMemo(() => {
    if (!searchValue) return searchableItems

    return fzfInstance.find(searchValue.toLowerCase()).map((result) => {
      const item = result.item
      const positions = Array.from(result.positions) || []
      const highlightedId = highlightFzfMatch(
        item.model.id,
        positions,
        'text-accent'
      )

      return {
        ...item,
        highlightedId,
      }
    })
  }, [searchableItems, searchValue, fzfInstance])

  // Group filtered items by provider, excluding favorites when not searching
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue) {
      // When not searching, show all active providers (even without models)
      // Sort: local first, then providers with API keys or custom with models, then others, alphabetically
      const activeProviders = providers
        .filter((p) => p.active)
        .sort((a, b) => {
          const aIsLocal = a.provider === 'llamacpp' || a.provider === 'mlx'
          const bIsLocal = b.provider === 'llamacpp' || b.provider === 'mlx'
          // Local (llamacpp) first
          if (aIsLocal && !bIsLocal) return -1
          if (!aIsLocal && bIsLocal) return 1

          // Custom providers without API key but with models should be treated like "have API key"
          const aIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(a.provider)
          )
          const bIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(b.provider)
          )
          const aHasApiKeyOrCustomModel =
            providerHasRemoteApiKeys(a) ||
            (!aIsPredefined && a.models.length > 0)
          const bHasApiKeyOrCustomModel =
            providerHasRemoteApiKeys(b) ||
            (!bIsPredefined && b.models.length > 0)
          // Providers with API keys or custom with models filled second
          if (aHasApiKeyOrCustomModel && !bHasApiKeyOrCustomModel) return -1
          if (!aHasApiKeyOrCustomModel && bHasApiKeyOrCustomModel) return 1

          // Sort remaining by provider name
          return a.provider.localeCompare(b.provider)
        })

      activeProviders.forEach((provider) => {
        groups[provider.provider] = []
      })
    }

    // Add the filtered items to their respective groups
    filteredItems.forEach((item) => {
      const providerKey = item.provider.provider
      if (!groups[providerKey]) {
        groups[providerKey] = []
      }

      // When not searching, exclude favorite models from regular provider sections
      const isFavorite = favoriteModels.some((fav) => fav.id === item.model.id)
      if (!searchValue && isFavorite) return // Skip adding this item to regular provider section

      groups[providerKey].push(item)
    })

    return groups
  }, [filteredItems, providers, searchValue, favoriteModels])

  const handleSelect = useCallback(
    async (searchableModel: SearchableModel) => {
      setSelectionError(null)
      if (allowAssistants && character) {
        try {
          await useCharacterStore.getState().updateProfile({ ...character, modelBinding: { providerId: searchableModel.provider.provider, modelId: searchableModel.model.id } })
        } catch (error) {
          setSelectionError(error instanceof Error ? error.message : 'No se pudo guardar el modelo del asistente.')
          return
        }
      }
      // Immediately update display to prevent double-click issues
      setDisplayModel(getModelDisplayName(searchableModel.model))
      setSearchValue('')
      setOpen(false)

      selectModelProvider(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
      ;(onModelChange ?? updateCurrentThreadModel)({
        id: searchableModel.model.id,
        provider: searchableModel.provider.provider,
      })

      // Store the selected model as last used
      setLastUsedModel(
        searchableModel.provider.provider,
        searchableModel.model.id
      )


      // Check mmproj existence for llamacpp models (async, don't block UI)
      if (searchableModel.provider.provider === 'llamacpp') {
        serviceHub
          .models()
          .checkMmprojExistsAndUpdateOffloadMMprojSetting(
            searchableModel.model.id,
            updateProvider,
            getProviderByName
          )
          .catch((error) => {
            console.debug(
              'Error checking mmproj for model:',
              searchableModel.model.id,
              error
            )
          })

        // Also check vision capability (async, don't block UI)
        checkAndUpdateModelVisionCapability(searchableModel.model.id).catch(
          (error) => {
            console.debug(
              'Error checking vision capability for model:',
              searchableModel.model.id,
              error
            )
          }
        )
      }
    },
    [
      selectModelProvider,
      updateCurrentThreadModel,
      onModelChange,
      updateProvider,
      getProviderByName,
      checkAndUpdateModelVisionCapability,
      serviceHub,
      allowAssistants,
      character,
    ]
  )

  const currentModel = selectedModel?.id
    ? getModelBy(selectedModel?.id)
    : undefined

  if (!providers.length && !allowAssistants) return null

  const provider = getProviderByName(selectedProvider)


  return (
    <Popover open={open} onOpenChange={onOpenChange}>
          <div
            data-testid="model-selector-trigger"
            className="border relative z-20 px-3 py-1.5 flex min-w-0 max-w-full items-center gap-1.5 rounded-full"
          >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={allowAssistants ? 'Seleccionar asistente y modelo' : 'Seleccionar modelo'}
              className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20 min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              {allowAssistants && character ? <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{character.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span> : provider && (
                <div className="shrink-0">
                  <ProvidersAvatar provider={provider} />
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'text-foreground truncate leading-normal',
                      !selectedModel?.id && 'text-muted-foreground'
                    )}
                  >
                    {activeAssistant && activeAssistant.id !== 'model-only' ? <><span data-testid="selected-assistant-name" className="block truncate text-sm">{activeAssistant.name}</span><span className="block truncate text-xs text-muted-foreground">{visibleModelName}</span></> : visibleModelName}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{visibleModelName}</TooltipContent>
              </Tooltip>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          {currentModel?.settings &&
            provider &&
            provider.provider === 'llamacpp' && (
              <div onClick={(e) => e.stopPropagation()}>
                <ModelSetting
                  model={currentModel as Model}
                  provider={provider}
                />
              </div>
            )}
          <ModelSupportStatus
            modelId={selectedModel?.id}
            provider={selectedProvider}
            contextSize={getContextSize()}
            className="ml-0.5 shrink-0"
          />
        </div>

      <PopoverContent
        className={cn(
          // Use auto width to fit long model names; keep a sensible minimum.
          'w-auto min-w-70 max-w-[90vw] p-0 backdrop-blur-2xl bg-background/95 border',
          'max-h-[min(560px,75dvh)] w-[min(420px,90vw)]'
        )}
        align="start"
        // sideOffset={16}
        // alignOffset={-10}
        side="bottom"
        avoidCollisions={searchValue.length === 0 ? true : false}
      >
        <div className="flex flex-col size-full">
          {allowAssistants && <div className="flex gap-1 border-b p-2" aria-label="Elegir asistentes o modelos">
            <Button data-testid="assistant-selector-tab" variant={selectorTab === 'assistants' ? 'secondary' : 'ghost'} aria-pressed={selectorTab === 'assistants'} size="sm" onClick={() => setSelectorTab('assistants')}>Asistentes</Button>
            <Button data-testid="model-selector-tab" variant={selectorTab === 'models' ? 'secondary' : 'ghost'} aria-pressed={selectorTab === 'models'} size="sm" onClick={() => setSelectorTab('models')}>Modelos</Button>
          </div>}
          {/* Search input */}
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              aria-label={selectorTab === 'assistants' ? 'Buscar asistentes' : 'Buscar modelos'}
              placeholder={selectorTab === 'assistants' ? 'Buscar asistentes…' : t('common:searchModels')}
              className="w-full rounded-sm text-sm font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            />
            {searchValue.length > 0 && (
              <button type="button" aria-label="Borrar búsqueda" className="absolute right-2 top-0 bottom-0 flex items-center justify-center" onClick={onClearSearch}>
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                />
              </button>
            )}
          </div>

          {(selectionError || characterError) && <p className="px-3 py-2 text-sm text-destructive" role="alert">{selectionError || characterError}</p>}
          {allowAssistants && selectorTab === 'assistants' ? <div className="max-h-[min(420px,55dvh)] overflow-y-auto p-1">
            <button type="button" data-testid="assistant-option-model-only" className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-foreground" aria-pressed={!activeAssistant || activeAssistant.id === 'model-only'} onClick={() => void chooseAssistant('')}>Solo modelo</button>
            {visibleAssistants.map((assistant) => {
              const id = characterIdFromAssistantId(assistant.id)
              const profile = profiles.find((item) => item.id === id)
              const binding = profile?.modelBinding
              const linkedModel = binding ? providers.find((item) => item.provider === binding.providerId)?.models.find((item) => item.id === binding.modelId) : undefined
              return <button type="button" key={assistant.id} data-testid={`assistant-option-${assistant.id}`} aria-pressed={activeAssistant?.id === assistant.id} className={cn('my-0.5 flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-foreground', activeAssistant?.id === assistant.id && 'bg-accent')} onClick={() => void chooseAssistant(assistant.id)}>
                {profile ? <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{profile.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span> : <AvatarEmoji avatar={assistant.avatar ?? '👤'} imageClassName="size-7" textClassName="text-xl" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{assistant.name}</span>
                  {profile && <span className="block truncate text-xs text-muted-foreground">{getCharacterChatRole(profile).label}</span>}
                  <span className="block truncate text-xs text-muted-foreground">{profile ? linkedModel ? getModelDisplayName(linkedModel) : binding ? 'Modelo asociado no disponible' : 'Selecciona un modelo en Asistentes' : 'Utiliza el modelo seleccionado'}</span>
                </span>
                {activeAssistant?.id === assistant.id && <span aria-label="Seleccionado">✓</span>}
              </button>
            })}
            {!visibleAssistants.length && <p className="p-3 text-sm text-muted-foreground">No se encontraron asistentes.</p>}
            <Button variant="ghost" className="mt-1 w-full justify-start" onClick={() => { setOpen(false); navigate({ to: route.settings.assistant }) }}>Gestionar asistentes</Button>
          </div> : <>

          {/* Model list */}
          <div className="max-h-80 overflow-y-auto">
            {Object.keys(groupedItems).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm ">
                {t('common:noModelsFoundFor', { searchValue })}
              </div>
            ) : (
              <div className="py-1">
                {/* Favorites section - only show when not searching */}
                {!searchValue && favoriteItems.length > 0 && (
                  <div className="bg-secondary/30 rounded-sm m-2 py-1">
                    {/* Favorites header */}
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        {t('common:favorites')}
                      </span>
                    </div>

                    {/* Favorite models */}
                    {favoriteItems.map((searchableModel) => {
                      const isSelected =
                        selectedModel?.id === searchableModel.model.id &&
                        selectedProvider === searchableModel.provider.provider
                      const capabilities =
                        searchableModel.model.capabilities || []

                      return (
                        <button
                          type="button"
                          key={`fav-${searchableModel.value}`}
                          data-testid={`model-option-${searchableModel.model.id}`}
                          onClick={() => handleSelect(searchableModel)}
                          className={cn(
                            'mx-1 mb-1 w-[calc(100%-0.5rem)] min-h-11 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-foreground transition-all duration-200',
                            'hover:bg-secondary/40',
                            // Selected state needs stronger contrast than the surrounding secondary tint.
                            isSelected &&
                              'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40'
                          )}
                        >
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <div className="shrink-0 -ml-1">
                              <ProvidersAvatar
                                provider={searchableModel.provider}
                              />
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm truncate">
                                  {getModelDisplayName(searchableModel.model)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {searchableModel.model.id}
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex-1"></div>
                            {capabilities.length > 0 && (
                              <div className="shrink-0 -mr-1.5">
                                <Capabilities capabilities={capabilities} />
                              </div>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Divider between favorites and regular providers */}
                {favoriteItems.length > 0 && (
                  <div className="border-b mx-2"></div>
                )}

                {/* Regular provider sections */}
                {Object.entries(groupedItems).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
                  )

                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className="bg-secondary/30 first:mt-0 rounded-sm my-1.5 mx-1.5 first:mb-0 py-1"
                    >
                      {/* Provider header */}
                      <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <ProvidersAvatar provider={providerInfo} />
                          <span className="capitalize text-sm font-medium text-muted-foreground">
                            {getProviderTitle(providerInfo.provider)}
                          </span>
                        </div>

                        <button
                          type="button"
                          aria-label={`Configurar ${getProviderTitle(providerInfo.provider)}`}
                          className="size-6 cursor-pointer flex items-center justify-center rounded-sm bg-secondary-foreground/8 transition-all duration-200 ease-in-out"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate({
                              to: route.settings.providers,
                              params: { providerName: providerInfo.provider },
                            })
                            setOpen(false)
                          }}
                        >
                          <IconSettings
                            size={16}
                            className="text-muted-foreground"
                          />
                        </button>
                      </div>

                      {/* Models for this provider */}
                      {models.length === 0 ? (
                        // Show message when provider has no available models
                        <></>
                      ) : (
                        models.map((searchableModel) => {
                          const isSelected =
                            selectedModel?.id === searchableModel.model.id &&
                            selectedProvider ===
                              searchableModel.provider.provider
                          const capabilities =
                            searchableModel.model.capabilities || []

                          return (
                            <button
                              type="button"
                              key={searchableModel.value}
                              data-testid={`model-option-${searchableModel.model.id}`}
                              onClick={() => handleSelect(searchableModel)}
                              className={cn(
                                'mx-1 mb-1 w-[calc(100%-0.5rem)] min-h-11 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-foreground transition-all duration-200',
                                'hover:bg-secondary/40',
                                isSelected &&
                                  'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40'
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-sm truncate">
                                      {getModelDisplayName(
                                        searchableModel.model
                                      )}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {searchableModel.model.id}
                                  </TooltipContent>
                                </Tooltip>
                                <div className="flex-1"></div>
                                {capabilities.length > 0 && (
                                  <div className="shrink-0 -mr-1.5">
                                    <Capabilities capabilities={capabilities} />
                                  </div>
                                )}
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          </>}
        </div>
      </PopoverContent>
    </Popover>
  )
})

export default DropdownModelProvider
