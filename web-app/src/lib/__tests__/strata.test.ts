import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: vi.fn() }) }) }))

const { ensureStrataServing, isAppStrata, rememberAppStrata, strataGpu, strataProvider } = await import('../strata')
import type { StrataStatus } from '../strata'
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

describe('un asistente con un modelo de Strata', () => {
  const inkling = { file: 'strata-inkling-2-mini-sq-20.json', model: 'inkling-2-mini-sq-20', port: 8080 }
  const hy4 = { file: 'strata-hy4-flash-sq-64.json', model: 'hy4-flash-sq-64', port: 8080 }
  const status = (over: Partial<StrataStatus> = {}): StrataStatus => ({ installed: true, engines: [], setups: [inkling, hy4], running: null, ready: false, stopped: null, ...over })
  const serving = (setup: typeof inkling) => ({ setup: setup.file, model: setup.model, port: 8080, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'nueva' })
  const noWait = async () => undefined

  it('enciende Strata con su modelo y espera a que responda', async () => {
    const states = [status(), status({ running: serving(inkling) }), status({ running: serving(inkling), ready: true })]
    const load = vi.fn(async () => states.shift()!)
    const start = vi.fn(async () => serving(inkling))
    const register = vi.fn()
    const result = await ensureStrataServing(inkling.model, { load, start, register, wait: noWait })
    expect(start).toHaveBeenCalledWith(inkling.file)
    expect(register).toHaveBeenCalledWith(serving(inkling))
    expect(load).toHaveBeenCalledTimes(3)
    expect(result.model).toBe(inkling.model)
    expect(isAppStrata({ provider: 'strata', base_url: 'http://127.0.0.1:8080/v1' })).toBe(true)
    rememberAppStrata(null)
  })

  it('si Strata sirve otro modelo, lo cambia por el del asistente', async () => {
    const states = [status({ running: serving(hy4), ready: true }), status({ running: serving(inkling), ready: true })]
    const stop = vi.fn(async () => undefined)
    const start = vi.fn(async () => serving(inkling))
    await ensureStrataServing(inkling.model, { load: async () => states.shift()!, start, stop, register: vi.fn(), wait: noWait })
    expect(stop).toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith(inkling.file)
  })

  it('si ya lo sirve y responde, no lo reinicia', async () => {
    const start = vi.fn()
    await ensureStrataServing(inkling.model, { load: async () => status({ running: serving(inkling), ready: true }), start, register: vi.fn(), wait: noWait })
    expect(start).not.toHaveBeenCalled()
  })

  it('dice qué pasó si Strata no está, no tiene el modelo o se cierra al cargar', async () => {
    await expect(ensureStrataServing(inkling.model, { load: async () => status({ installed: false }) })).rejects.toThrow(/no está instalado/)
    await expect(ensureStrataServing('otro', { load: async () => status() })).rejects.toThrow(/ya no tiene preparado otro/)
    const states = [status(), status({ stopped: 'Strata se cerró solo (exit code: 1).' })]
    await expect(ensureStrataServing(inkling.model, { load: async () => states.shift()!, start: async () => serving(inkling), register: vi.fn(), wait: noWait })).rejects.toThrow('Strata se cerró solo')
  })

  it('un envío cancelado deja de esperar', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(ensureStrataServing(inkling.model, { signal: abort.signal, load: async () => status(), start: vi.fn() })).rejects.toThrow(/cancel/)
  })
})
