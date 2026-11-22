import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  rememberAppStrata,
  startStrata,
  STRATA_PROVIDER,
  strataGpu,
  strataProvider,
  strataStatus,
  stopStrata,
  type StrataCard,
  type StrataRunning,
  type StrataStatus,
} from '@/lib/strata'

const CARD_NAMES: Record<StrataCard, string> = { amd: 'AMD (motor rx9070)', nvidia: 'NVIDIA (motor CUDA)' }

const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback

/** Adds or refreshes the `strata` provider with the running server's address, key and model. */
function registerProvider(running: StrataRunning) {
  const store = useModelProvider.getState()
  const existing = store.getProviderByName(STRATA_PROVIDER)
  const next = strataProvider(running, existing)
  if (existing) store.updateProvider(STRATA_PROVIDER, next)
  else store.addProvider(next)
}

/**
 * Strata in the local models dialog: start the Strata server installed on this
 * computer with one of its models, watch it load, and stop it.
 */
export function StrataPanel({ onReady, load = strataStatus, start = startStrata, stop = stopStrata }: {
  /** The model answers: the picker can select it. */
  onReady?: (model: string) => void
  load?: () => Promise<StrataStatus>
  start?: (setup: string, gpu?: StrataCard) => Promise<StrataRunning>
  stop?: () => Promise<void>
}) {
  const [status, setStatus] = useState<StrataStatus>()
  const [setup, setSetup] = useState('')
  // The AMD card has the most memory here, so it goes first when Strata has both engines.
  const [card, setCard] = useState<StrataCard>('amd')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const wasReady = useRef(false)
  // The latest callbacks, so a parent's new function never starts another round of checks.
  const latest = useRef({ load, onReady })
  latest.current = { load, onReady }

  const refresh = useCallback(async () => {
    try {
      const next = await latest.current.load()
      setStatus(next)
      rememberAppStrata(next.running)
      if (next.running) registerProvider(next.running)
      if (next.ready && next.running && !wasReady.current) latest.current.onReady?.(next.running.model)
      wasReady.current = next.ready
      setSetup(current => current || next.running?.setup || next.setups[0]?.file || '')
    } catch (cause) {
      setError(message(cause, 'No se pudo consultar Strata.'))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // While the model loads, check every two seconds until it answers or stops.
  const loading = !!status?.running && !status.ready
  useEffect(() => {
    if (!loading) return
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [loading, refresh])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (cause) {
      setError(message(cause, 'Strata no respondió.'))
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const gpu = strataGpu(status?.engines ?? [])
  const running = status?.running
  return <section data-testid="strata-panel" className="mt-4 space-y-2 rounded-md border p-3">
    <div>
      <h3 className="text-sm font-medium">Strata · modelos grandes</h3>
      <p className="text-xs text-muted-foreground">Reparte un modelo MoE grande entre la VRAM, la RAM y el SSD, para que funcione aunque no quepa entero en la tarjeta. Lo trata como un modelo local.</p>
    </div>
    {!status ? <p role="status" className="text-xs text-muted-foreground">Buscando Strata…</p>
      : !status.installed ? <p role="status" className="text-xs text-muted-foreground">Strata no está instalado en este equipo. Instálalo desde github.com/Niko1221/Strata y prepara un modelo en él: aparecerá aquí.</p>
        : <>
          {gpu === 'nvidia' && <p className="text-xs text-amber-600 dark:text-amber-400">Strata tiene ahora el motor para NVIDIA (CUDA). Para usar la AMD Radeon AI PRO R9700 de 32 GB, elige esa tarjeta en Strata: descargará su motor rx9070.</p>}
          {!status.setups.length ? <p role="status" className="text-xs text-muted-foreground">Abre Strata y prepara un modelo: sus modelos aparecen aquí.</p>
            : <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Modelo de Strata"
                value={setup}
                disabled={busy || !!running}
                className="min-w-0 flex-1 cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:cursor-not-allowed"
                onChange={event => setSetup(event.target.value)}
              >
                {status.setups.map(item => <option key={item.file} value={item.file}>{item.model} · puerto {item.port}</option>)}
              </select>
              {gpu === 'both' && <select
                aria-label="Tarjeta de Strata"
                value={card}
                disabled={busy || !!running}
                className="cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:cursor-not-allowed"
                onChange={event => setCard(event.target.value as StrataCard)}
              >
                <option value="amd">{CARD_NAMES.amd}</option>
                <option value="nvidia">{CARD_NAMES.nvidia}</option>
              </select>}
              {running
                ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(stop)}>Detener Strata</Button>
                : <Button type="button" size="sm" disabled={busy || !setup} onClick={() => void run(async () => { registerProvider(await start(setup, gpu === 'both' ? card : undefined)) })}>{busy ? 'Iniciando…' : 'Iniciar Strata'}</Button>}
            </div>}
          {running && <p role="status" className="text-xs text-muted-foreground">
            {status.ready ? `Listo: ${running.model} en 127.0.0.1:${running.port}${running.gpu ? ` · tarjeta ${running.gpu === 'amd' ? 'AMD' : 'NVIDIA'}` : ''}. Elígelo en «Modelos locales» del selector.` : `Cargando ${running.model} en Strata${running.gpu === 'amd' ? ' (tarjeta AMD)' : running.gpu === 'nvidia' ? ' (tarjeta NVIDIA)' : ''}… un modelo grande puede tardar unos minutos.`}
          </p>}
          {!running && status.stopped && <p role="alert" className="text-xs text-destructive">{status.stopped}</p>}
        </>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>
}
