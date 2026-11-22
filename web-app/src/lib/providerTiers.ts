/**
 * Where a model runs and who pays: on this computer, in the cloud for free, or
 * in the cloud on a paid account. Settings and the model picker show the three
 * apart so they are not mixed in one long list.
 */
export type ProviderTier = 'local' | 'free' | 'paid'

export const PROVIDER_TIERS: { tier: ProviderTier; title: string; description: string }[] = [
  { tier: 'local', title: 'Modelos locales', description: 'Corren en este equipo, sin internet ni costo.' },
  { tier: 'free', title: 'Nube gratis', description: 'Cuentas o modelos gratuitos, con límites de uso.' },
  { tier: 'paid', title: 'Nube de pago', description: 'Cobran por uso desde tu cuenta, como Claude o Codex.' },
]

const LOCAL_PROVIDERS = new Set(['llamacpp', 'mlx', 'strata'])
/** Providers whose main offer is a free tier or free models. */
const FREE_PROVIDERS = new Set(['openrouter', 'nvidia', 'huggingface', 'groq', 'gemini'])
const FREE_HOSTS = ['openrouter.ai', 'integrate.api.nvidia.com', 'router.huggingface.co', 'api.groq.com', 'generativelanguage.googleapis.com']
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']
/** OpenRouter sells most of its catalog and gives some models away, marked `:free`. */
const MIXED_PROVIDERS = new Set(['openrouter'])

type ProviderLike = { provider: string; base_url?: string }

function host(url: string | undefined) {
  try { return url ? new URL(url).hostname.toLowerCase() : '' } catch { return '' }
}

export function providerTier({ provider, base_url }: ProviderLike): ProviderTier {
  const name = provider.toLowerCase()
  if (LOCAL_PROVIDERS.has(name)) return 'local'
  if (FREE_PROVIDERS.has(name)) return 'free'
  const address = host(base_url)
  if (LOCAL_HOSTS.includes(address) || address.endsWith('.localhost')) return 'local'
  if (FREE_HOSTS.some(free => address === free || address.endsWith(`.${free}`))) return 'free'
  return 'paid'
}

/** A model's tier; for OpenRouter the free models and the paid ones go apart. */
export function modelTier(provider: ProviderLike, modelId: string): ProviderTier {
  if (MIXED_PROVIDERS.has(provider.provider.toLowerCase())) return /:free$/i.test(modelId) ? 'free' : 'paid'
  return providerTier(provider)
}

/** Tiers a provider appears under: OpenRouter in both clouds, the rest in one. */
export function providerTiers(provider: ProviderLike): ProviderTier[] {
  return MIXED_PROVIDERS.has(provider.provider.toLowerCase()) ? ['free', 'paid'] : [providerTier(provider)]
}
