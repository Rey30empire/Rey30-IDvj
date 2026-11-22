import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: vi.fn() }) }) }))

const { isAppStrata, rememberAppStrata, strataGpu, strataProvider } = await import('../strata')
const { providerTier } = await import('../providerTiers')

const running = { setup: 'strata-iq3_s.json', model: 'qwen3.8-flash-next-iq3_s', port: 8080, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'clave-del-editor' }

describe('Strata como motor local del editor', () => {
  it('registra el servidor como proveedor local con su clave y su modelo', () => {
    const provider = strataProvider(running)
    expect(provider).toMatchObject({ provider: 'strata', active: true, base_url: running.baseUrl, api_key: running.apiKey })
    expect(provider.models.map(model => model.id)).toEqual(['qwen3.8-flash-next-iq3_s'])
    const setting = (key: string) => (provider.settings.find(item => item.key === key)?.controller_props as { value: string }).value
    expect(setting('base-url')).toBe(running.baseUrl)
    expect(setting('api-key')).toBe(running.apiKey)
    expect(providerTier(provider)).toBe('local')
  })

  it('«Solo local» solo confía en el Strata que arrancó el editor', () => {
    rememberAppStrata(null)
    expect(isAppStrata({ provider: 'strata', base_url: running.baseUrl })).toBe(false)
    rememberAppStrata(running)
    expect(isAppStrata({ provider: 'strata', base_url: running.baseUrl })).toBe(true)
    expect(isAppStrata({ provider: 'strata', base_url: 'http://127.0.0.1:9999/v1' })).toBe(false)
    expect(isAppStrata({ provider: 'openai', base_url: running.baseUrl })).toBe(false)
    rememberAppStrata(null)
  })

  it('sabe qué tarjeta usa por el motor descargado', () => {
    expect(strataGpu(['0.1.60-windows-x86_64-cuda-cuda13'])).toBe('nvidia')
    expect(strataGpu(['0.1.60-windows-x86_64-hip-rx9070'])).toBe('amd')
    expect(strataGpu(['0.1.60-windows-x86_64-cuda-cuda13', '0.1.60-windows-x86_64-hip-rx9070'])).toBe('both')
    expect(strataGpu([])).toBe('none')
  })
})
