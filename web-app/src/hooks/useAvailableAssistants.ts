import { useEffect, useMemo } from 'react'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { useCharacterStore } from '@/stores/useCharacterStore'
import {
  characterIdFromAssistantId,
  mergeAvailableAssistants,
  toCharacterAssistant,
} from '@/lib/characters/assistant-integration'

export function useAvailableAssistants(): Assistant[] {
  const assistants = useAssistant((state) => state.assistants)
  const currentId = useAssistant((state) => state.currentAssistant?.id)
  const profiles = useCharacterStore((state) => state.profiles)
  useEffect(() => {
    void useCharacterStore
      .getState()
      .load()
      .catch(() => {})
  }, [])
  useEffect(() => {
    const id = characterIdFromAssistantId(currentId)
    const profile = profiles.find((item) => item.id === id)
    if (profile)
      useAssistant
        .getState()
        .setCurrentAssistant(toCharacterAssistant(profile), false)
  }, [currentId, profiles])
  return useMemo(
    () => mergeAvailableAssistants(assistants, profiles),
    [assistants, profiles]
  )
}

export function useActiveCharacter() {
  const current = useAssistant((state) => state.currentAssistant?.id)
  const threadId = useThreads((state) => state.currentThreadId)
  const thread = useThreads((state) =>
    threadId ? state.threads[threadId] : undefined
  )
  const profiles = useCharacterStore((state) => state.profiles)
  const loaded = useCharacterStore((state) => state.loaded)
  const id = characterIdFromAssistantId(
    threadId ? thread?.assistants?.[0]?.id : current
  )
  return loaded ? profiles.find((profile) => profile.id === id) : undefined
}
