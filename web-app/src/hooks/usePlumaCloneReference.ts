import { useCallback, useEffect, useRef, useState } from 'react'
import { choosePlumaReference, clearPlumaReference, plumaReferenceStatus, type PlumaReference } from '@/lib/characters/pluma-clone'

export function usePlumaCloneReference(enabled: boolean) {
  const [reference, setReference] = useState<PlumaReference>()
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
      if (state.latest === request) setError(cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'No se pudo comprobar la muestra de voz.')
    } finally {
      if (state.latest === request) setBusy(false)
    }
  }, [])

  useEffect(() => {
    const state = requests.current
    if (enabled) void run(plumaReferenceStatus)
    return () => { state.latest++ }
  }, [enabled, run])

  return { reference, busy, error, choose: () => run(choosePlumaReference), clear: () => run(clearPlumaReference) }
}
