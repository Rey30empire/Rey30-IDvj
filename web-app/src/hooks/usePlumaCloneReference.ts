import { useCallback, useEffect, useRef, useState } from 'react'
import { choosePlumaReference, clearPlumaReference, plumaReferenceStatus, type PlumaReference } from '@/lib/characters/pluma-clone'
import { applyLoreVoice, loreVoiceFolder, loreVoices, openLoreFolder, saveLoreVoice, type LoreVoice, type LoreVoiceGroups, type LoreVoices } from '@/lib/characters/lore'

const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback

/**
 * The speaking sample, or with `singing` the optional sample she sings with,
 * and the voices waiting in the project's Lore folder to replace it: those of
 * the assistant's own folder and its gender's (`groups`), never another's.
 * `owner` is the assistant when it is not Pluma: each keeps its own sample.
 */
export function usePlumaCloneReference(enabled: boolean, singing = false, groups?: LoreVoiceGroups, owner?: string) {
  const [reference, setReference] = useState<PlumaReference>()
  const [lore, setLore] = useState<LoreVoices>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const requests = useRef({ latest: 0 })
  const own = groups?.own
  const gender = groups?.gender

  const run = useCallback(async (action: () => Promise<PlumaReference>) => {
    const state = requests.current
    const request = ++state.latest
    setBusy(true)
    setError(undefined)
    try {
      const next = await action()
      if (state.latest === request) setReference(next)
    } catch (cause) {
      if (state.latest === request) setError(message(cause, 'No se pudo comprobar la muestra de voz.'))
    } finally {
      if (state.latest === request) setBusy(false)
    }
  }, [])

  // The list is a convenience: without Lore the sample still works as before.
  const refreshLore = useCallback(async () => {
    try {
      setLore(await loreVoices(singing, own && gender ? { own, gender } : undefined, owner))
    } catch {
      setLore(undefined)
    }
  }, [singing, own, gender, owner])

  useEffect(() => {
    const state = requests.current
    if (enabled) {
      void run(() => plumaReferenceStatus(singing, owner))
      void refreshLore()
    }
    return () => { state.latest++ }
  }, [enabled, singing, owner, run, refreshLore])

  return {
    reference,
    lore,
    /** The assistant's folders, for the list to say where each voice is. */
    groups: own && gender ? { own, gender } : undefined,
    busy,
    error,
    choose: () => run(() => choosePlumaReference(singing, owner)),
    clear: () => run(() => clearPlumaReference(singing, owner)),
    pickLore: (voice: Pick<LoreVoice, 'group' | 'file'>) => run(() => applyLoreVoice(voice, singing, undefined, owner)),
    /** Keeps a recording in the assistant's Lore folder and starts using it; the list then shows it selected. */
    saveRecording: async (name: string, wav: string) => {
      await run(() => saveLoreVoice(name, wav, singing, own, owner))
      await refreshLore()
    },
    refreshLore,
    openLore: () => openLoreFolder(own ? loreVoiceFolder(own, singing) : singing ? 'voces/cantar' : 'voces/hablar')
      .catch(cause => setError(message(cause, 'No se pudo abrir la carpeta de voces.'))),
  }
}
