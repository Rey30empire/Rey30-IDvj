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
