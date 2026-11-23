import { getServiceHub } from '@/hooks/useServiceHub'
import { openAIProviderSettings } from '@/constants/providers'
import cloneDeep from 'lodash/cloneDeep'

/**
 * Strata, the local engine for large mixture-of-experts models: it keeps the
 * experts in use in VRAM, more in RAM and reads the rest from the SSD. The
 * editor starts the Strata server installed on this computer and uses it as a
 * local, OpenAI-compatible provider named `strata`.
 */
export type StrataSetup = { file: string; model: string; port: number }
/** `gpu`: the card it runs on, `amd` or `nvidia`; empty when Strata chose. */
export type StrataRunning = { setup: string; model: string; port: number; baseUrl: string; apiKey: string; gpu?: string }
export type StrataCard = 'amd' | 'nvidia'
export type StrataStatus = {
  installed: boolean
  engines: string[]
  setups: StrataSetup[]
  running: StrataRunning | null
  ready: boolean
  stopped: string | null
}

export const STRATA_PROVIDER = 'strata'

const invoke = <T>(command: string, args?: Record<string, unknown>) => getServiceHub().core().invoke<T>(command, args)

export const strataStatus = () => invoke<StrataStatus>('strata_status')
/** Without a card, the editor uses the AMD one when Strata has its engine. */
export const startStrata = (setup: string, gpu?: StrataCard) => invoke<StrataRunning>('strata_start', { setup, gpu })
export const stopStrata = () => invoke<void>('strata_stop')

/** The Strata server this editor started; only its address counts as local under «Solo local». */
let appStrata: StrataRunning | null = null
export function rememberAppStrata(running: StrataRunning | null) { appStrata = running }

/** A provider pointing at the Strata server the editor started and still runs. */
export function isAppStrata(provider: { provider: string; base_url?: string }): boolean {
  return provider.provider.toLowerCase() === STRATA_PROVIDER && !!appStrata && provider.base_url === appStrata.baseUrl
}

/** Asks the app which Strata server runs now and remembers it (none if it stopped). */
export async function refreshAppStrata(): Promise<StrataRunning | null> {
  try {
    rememberAppStrata((await strataStatus()).running ?? null)
  } catch {
    rememberAppStrata(null)
  }
  return appStrata
}

/** A Strata provider with the address and key of the server running now, which change on each start. */
export async function withLiveStrata(provider: ProviderObject): Promise<ProviderObject> {
  const live = await refreshAppStrata()
  return live ? { ...provider, base_url: live.baseUrl, api_key: live.apiKey } : provider
}

/** Strata's engines are per graphics card: a HIP build (rx9070, rdna…) runs on AMD, a CUDA build on NVIDIA. */
export function strataGpu(engines: string[]): 'amd' | 'nvidia' | 'both' | 'none' {
  const amd = engines.some(name => /hip|rx9070|rdna|rocm/i.test(name))
  const nvidia = engines.some(name => /cuda/i.test(name))
  return amd && nvidia ? 'both' : amd ? 'amd' : nvidia ? 'nvidia' : 'none'
}

/** Adds or refreshes the `strata` provider with the running server's address, key and model. */
export async function registerStrataProvider(running: StrataRunning) {
  const { useModelProvider } = await import('@/hooks/useModelProvider')
  const store = useModelProvider.getState()
  const existing = store.getProviderByName(STRATA_PROVIDER)
  const next = strataProvider(running, existing)
  if (existing) store.updateProvider(STRATA_PROVIDER, next)
  else store.addProvider(next)
}

/**
 * Lists a Strata model in the `strata` provider even while Strata is stopped,
 * so an assistant bound to it can be chosen and the picker shows it; sending
 * a message starts Strata with it.
 */
export async function listStrataModel(model: string) {
  const { useModelProvider } = await import('@/hooks/useModelProvider')
  const store = useModelProvider.getState()
  const existing = store.getProviderByName(STRATA_PROVIDER)
  if (existing?.models.some(item => item.id === model)) return
  const entry: Model = { id: model, name: model, capabilities: ['completion', 'tools'] }
  if (existing) store.updateProvider(STRATA_PROVIDER, { ...existing, models: [...existing.models, entry] })
  else store.addProvider({ provider: STRATA_PROVIDER, active: true, base_url: '', api_key: '', settings: cloneDeep(openAIProviderSettings) as ProviderSetting[], models: [entry] })
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const loadLimitMs = 15 * 60_000

type ServingOptions = {
  signal?: AbortSignal
  load?: typeof strataStatus
  start?: typeof startStrata
  stop?: typeof stopStrata
  register?: (running: StrataRunning) => unknown
  wait?: (ms: number) => Promise<void>
}

/**
 * Makes Strata serve `model` for an assistant bound to it: started from its
 * setup when Strata is stopped, switched when it serves another model, and
 * waited for until the model answers. Registers the `strata` provider with the
 * new address and key so the message can go out.
 */
export async function ensureStrataServing(model: string, options: ServingOptions = {}): Promise<StrataRunning> {
  const load = options.load ?? strataStatus
  const wait = options.wait ?? pause
  const aborted = () => { if (options.signal?.aborted) throw new DOMException('Se canceló el envío.', 'AbortError') }
  let status = await load()
  if (!status.installed) throw new Error('Strata no está instalado en este equipo, y este asistente usa un modelo de Strata. Elige otro modelo en su configuración.')
  let running = status.running
  if (running && running.model !== model) {
    await (options.stop ?? stopStrata)()
    running = null
    status = { ...status, running: null, ready: false }
  }
  if (!running) {
    const setup = status.setups.find(item => item.model === model)
    if (!setup) throw new Error(`Strata ya no tiene preparado ${model}. Elige otro modelo para este asistente.`)
    aborted()
    running = await (options.start ?? startStrata)(setup.file)
    status = { ...status, running, ready: false }
  }
  rememberAppStrata(running)
  await (options.register ?? registerStrataProvider)(running)
  const deadline = Date.now() + loadLimitMs
  while (!status.ready) {
    aborted()
    if (Date.now() > deadline) throw new Error(`Strata tardó demasiado en cargar ${model}.`)
    await wait(2000)
    status = await load()
    if (!status.running) throw new Error(status.stopped ?? `Strata se detuvo mientras cargaba ${model}.`)
  }
  rememberAppStrata(status.running)
  return status.running ?? running
}

/** The provider entry for a running server: its address, its key and the one model it serves. */
export function strataProvider(running: StrataRunning, existing?: ProviderObject): ProviderObject {
  const settings = cloneDeep(existing?.settings?.length ? existing.settings : openAIProviderSettings) as ProviderSetting[]
  for (const setting of settings) {
    if (setting.key === 'base-url') (setting.controller_props as { value: string }).value = running.baseUrl
    if (setting.key === 'api-key') (setting.controller_props as { value: string }).value = running.apiKey
  }
  const model: Model = { id: running.model, name: running.model, capabilities: ['completion', 'tools'] }
  return { ...existing, provider: STRATA_PROVIDER, active: true, base_url: running.baseUrl, api_key: running.apiKey, settings, models: [model] }
}
