import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@rey30-idvj/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { useCharacterStore } from '@/stores/useCharacterStore'
import {
  characterIdFromAssistantId,
  mergeAvailableAssistants,
  toCharacterAssistant,
} from '@/lib/characters/assistant-integration'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | undefined
  loading: boolean
  defaultAssistantId: string
  addAssistant: (assistant: Assistant) => Promise<void>
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (
    assistant: Assistant | undefined,
    saveToStorage?: boolean
  ) => void
  setDefaultAssistant: (id: string) => void
  setAssistants: (assistants: Assistant[] | null) => void
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    localStorage.setItem(localStorageKey.lastUsedAssistant, assistantId)
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: 'rey30',
  name: 'Rey30 IDvj',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '/images/rey30-idvj.svg',
  description:
    'Te ayuda a resolver tareas y utilizar las herramientas habilitadas en tu equipo.',
  instructions: `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`,
}

const getLastUsedAssistantId = (assistants: Assistant[]): string => {
  let lastUsedId
  try {
    lastUsedId = localStorage.getItem(localStorageKey.lastUsedAssistant)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  if (lastUsedId) {
    const lastUsedAssistant = assistants.find((a) => a.id === lastUsedId)
    if (lastUsedAssistant) {
      return lastUsedId
    }
  }

  if (lastUsedId === '') return ''

  return defaultAssistant.id
}

const getDefaultAssistantId = (): string | null => {
  let defaultAssistantId: string | null = null

  try {
    defaultAssistantId = localStorage.getItem(
      localStorageKey.defaultAssistantId
    )
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  return defaultAssistantId
}

const setDefaultAssistantId = (assistantId: string) => {
  try {
    if (!assistantId) {
      localStorage.removeItem(localStorageKey.defaultAssistantId)
    } else {
      localStorage.setItem(localStorageKey.defaultAssistantId, assistantId)
    }
  } catch (error) {
    console.debug('Failed to set default assistant in localStorage:', error)
  }
}

// Platform-aware initial state
const getInitialAssistantState = () => {
  return {
    assistants: [defaultAssistant],
    currentAssistant: defaultAssistant,
    defaultAssistantId: '',
    loading: true,
  }
}

const pendingAssistantIds = new Set<string>()
let selectionVersion = 0
const availableAssistants = (assistants: Assistant[]) =>
  mergeAvailableAssistants(assistants, useCharacterStore.getState().profiles)
const resolvedAssistant = (assistant: Assistant | undefined) => {
  const id = characterIdFromAssistantId(assistant?.id)
  if (!id) return assistant
  const profile = useCharacterStore
    .getState()
    .profiles.find((item) => item.id === id)
  return profile ? toCharacterAssistant(profile) : undefined
}

export const useAssistant = create<AssistantState>((set, get) => ({
  ...getInitialAssistantState(),
  addAssistant: async (assistant) => {
    if (assistant.id.startsWith('character:'))
      throw new Error(
        'Los personajes se guardan desde su editor; no se duplican como archivos de asistente.'
      )
    if (
      pendingAssistantIds.has(assistant.id) ||
      get().assistants.some((existing) => existing.id === assistant.id)
    ) {
      throw new Error(
        'El identificador del asistente ya existe. No se reemplazó ningún asistente.'
      )
    }
    pendingAssistantIds.add(assistant.id)
    try {
      await getServiceHub()
        .assistants()
        .createAssistant(assistant as unknown as CoreAssistant)
      set({ assistants: [...get().assistants, assistant] })
    } finally {
      pendingAssistantIds.delete(assistant.id)
    }
  },
  updateAssistant: (assistant) => {
    if (assistant.id.startsWith('character:'))
      throw new Error(
        'Edita este personaje desde su configuración para conservar su perfil y memoria.'
      )
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to update assistant:', error)
      })
  },
  deleteAssistant: (id) => {
    if (id.startsWith('character:'))
      throw new Error(
        'Los perfiles de personajes se administran desde su configuración.'
      )
    const state = get()
    getServiceHub()
      .assistants()
      .deleteAssistant(
        state.assistants.find((e) => e.id === id) as unknown as CoreAssistant
      )
      .catch((error) => {
        console.error('Failed to delete assistant:', error)
      })

    // Check if we're deleting the current or default assistant
    const wasCurrentAssistant = state.currentAssistant?.id === id
    const wasDefaultAssistant = state.defaultAssistantId === id

    set({ assistants: state.assistants.filter((a) => a.id !== id) })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      set({
        currentAssistant: state.assistants.find(
          (a) => a.id === defaultAssistant.id
        ),
      })
      setLastUsedAssistantId(defaultAssistant.id)
    }

    // If the deleted assistant was the default, reset to the built-in default
    if (wasDefaultAssistant) {
      setDefaultAssistantId(defaultAssistant.id)
    }
  },
  setDefaultAssistant: (id) => {
    selectionVersion += 1
    const newAssistant = availableAssistants(get().assistants).find(
      (a) => a.id === id
    )
    if (newAssistant) {
      set({ defaultAssistantId: id, currentAssistant: newAssistant })
      setLastUsedAssistantId(id)
    } else {
      set({ defaultAssistantId: id })
    }
    setDefaultAssistantId(id)
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    selectionVersion += 1
    assistant = resolvedAssistant(assistant)
    const currentAssistant = get().currentAssistant
    if (currentAssistant !== assistant) {
      set({ currentAssistant: assistant })
      if (saveToStorage) {
        setLastUsedAssistantId(assistant?.id || '')
      }
    }
  },
  setAssistants: (assistants) => {
    if (assistants) {
      assistants = assistants
        .filter(
          (assistant) => !assistant.id?.toString().startsWith('character:')
        )
        .map((assistant) => ({ ...assistant, id: assistant.id?.toString() }))
      const available = availableAssistants(assistants)
      const lastUsedId = getLastUsedAssistantId(available)
      const lastUsedAssist = available.find((a) => a.id === lastUsedId)
      const defaultAssistantId = getDefaultAssistantId() || ''
      const selectedDefaultAssistant = available.find(
        (a) => a.id === defaultAssistantId
      )
      set({
        assistants,
        currentAssistant: selectedDefaultAssistant || lastUsedAssist,
        defaultAssistantId,
        loading: false,
      })
      const version = selectionVersion
      void useCharacterStore
        .getState()
        .load()
        .then(() => {
          if (version !== selectionVersion) return
          const fresh = availableAssistants(get().assistants)
          const defaultId = getDefaultAssistantId() || ''
          const restored =
            fresh.find((item) => item.id === defaultId) ||
            fresh.find((item) => item.id === getLastUsedAssistantId(fresh))
          set({ currentAssistant: restored })
        })
        .catch(() => {})
    } else {
      set({ loading: false })
    }
  },
}))
