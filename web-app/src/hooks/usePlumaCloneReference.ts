import { useCallback, useEffect, useRef, useState } from 'react'
import { choosePlumaReference, clearPlumaReference, plumaReferenceStatus, type PlumaReference } from '@/lib/characters/pluma-clone'
import { applyLoreVoice, loreVoices, openLoreFolder, type LoreVoices } from '@/lib/characters/lore'

const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback

/**
 * The speaking sample, or with `singing` the optional sample she sings with,
 * and the voices waiting in the project's Lore folder to replace it.
 */
export function usePlumaCloneReference(enabled: boolean, singing = false) {
  const [reference, setReference] = useState<PlumaReference>()
  const [lore, setLore] = useState<LoreVoices>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const requests = useRef({ latest: 0 })

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
      setLore(await loreVoices(singing))
    } catch {
      setLore(undefined)
    }
  }, [singing])

  useEffect(() => {
    const state = requests.current
    if (enabled) {
      void run(() => plumaReferenceStatus(singing))
      void refreshLore()
    }
    return () => { state.latest++ }
  }, [enabled, singing, run, refreshLore])

  return {
    reference,
    lore,
    busy,
    error,
    choose: () => run(() => choosePlumaReference(singing)),
    clear: () => run(() => clearPlumaReference(singing)),
    pickLore: (file: string) => run(() => applyLoreVoice(file, singing)),
    refreshLore,
    openLore: () => openLoreFolder(singing ? 'voces/cantar' : 'voces/hablar').catch(cause => setError(message(cause, 'No se pudo abrir la carpeta de voces.'))),
  }
}
