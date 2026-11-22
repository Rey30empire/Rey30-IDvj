import { describe, expect, it } from 'vitest'
import { modelTier, providerTier, providerTiers } from '../providerTiers'

describe('modelos separados en locales, nube gratis y nube de pago', () => {
  it('clasifica los proveedores conocidos', () => {
    expect(providerTier({ provider: 'llamacpp' })).toBe('local')
    for (const provider of ['openrouter', 'nvidia', 'huggingface', 'groq', 'gemini']) expect(providerTier({ provider })).toBe('free')
    for (const provider of ['anthropic', 'openai', 'mistral', 'xai', 'minimax', 'azure']) expect(providerTier({ provider })).toBe('paid')
  })

  it('clasifica los proveedores añadidos a mano por su dirección', () => {
    expect(providerTier({ provider: 'Mi Ollama', base_url: 'http://localhost:11434/v1' })).toBe('local')
    expect(providerTier({ provider: 'Otro router', base_url: 'https://openrouter.ai/api/v1' })).toBe('free')
    expect(providerTier({ provider: 'Empresa', base_url: 'https://api.ejemplo.com/v1' })).toBe('paid')
    expect(providerTier({ provider: 'Sin dirección', base_url: 'no es una url' })).toBe('paid')
  })

  it('reparte OpenRouter: sus modelos :free en la nube gratis y el resto en la de pago', () => {
    const openrouter = { provider: 'openrouter' }
    expect(modelTier(openrouter, 'qwen/qwen3-30b-a3b:free')).toBe('free')
    expect(modelTier(openrouter, 'anthropic/claude-sonnet-5-5')).toBe('paid')
    expect(providerTiers(openrouter)).toEqual(['free', 'paid'])
    expect(modelTier({ provider: 'nvidia' }, 'meta/llama-4')).toBe('free')
    expect(providerTiers({ provider: 'anthropic' })).toEqual(['paid'])
  })
})
