import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ providers: [] as ProviderObject[] }))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      getProviderByName: (name: string) => store.providers.find(p => p.provider === name),
      addProvider: (provider: ProviderObject) => { store.providers.push(provider) },
      updateProvider: (name: string, next: ProviderObject) => { store.providers = store.providers.map(p => p.provider === name ? next : p) },
    }),
  },
}))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: vi.fn() }) }) }))

const { StrataPanel } = await import('../StrataPanel')
const { isAppStrata } = await import('@/lib/strata')
import type { StrataStatus } from '@/lib/strata'

const setup = { file: 'strata-iq3_s.json', model: 'qwen3.8-flash-next-iq3_s', port: 8080 }
const running = { setup: setup.file, model: setup.model, port: 8080, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'clave' }
const status = (over: Partial<StrataStatus> = {}): StrataStatus => ({ installed: true, engines: ['0.1.60-windows-x86_64-cuda-cuda13'], setups: [setup], running: null, ready: false, stopped: null, ...over })

describe('Strata en Buscar modelos en el PC', () => {
  beforeEach(() => { store.providers = [] })

  it('arranca un modelo de Strata, lo registra como proveedor local y avisa cuando responde', async () => {
    let current = status()
    const load = vi.fn(async () => current)
    const start = vi.fn(async () => { current = status({ running }); return running })
    const onReady = vi.fn()
    render(<StrataPanel load={load} start={start} stop={vi.fn()} onReady={onReady} />)
    expect(await screen.findByRole('combobox', { name: 'Modelo de Strata' })).toHaveValue(setup.file)
    expect(screen.getByText(/elige esa tarjeta en Strata: descargará su motor rx9070/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Iniciar Strata' })) })
    expect(start).toHaveBeenCalledWith(setup.file, undefined)
    expect(store.providers[0]).toMatchObject({ provider: 'strata', base_url: running.baseUrl, api_key: 'clave' })
    expect(screen.getByRole('status')).toHaveTextContent('Cargando qwen3.8-flash-next-iq3_s en Strata')
    expect(isAppStrata({ provider: 'strata', base_url: running.baseUrl })).toBe(true)
    current = status({ running, ready: true })
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(setup.model), { timeout: 4000 })
    expect(screen.getByRole('status')).toHaveTextContent('Listo: qwen3.8-flash-next-iq3_s en 127.0.0.1:8080')
  })

  it('lo detiene y dice por qué se cerró si terminó solo', async () => {
    let current = status({ running, ready: true })
    const stop = vi.fn(async () => { current = status({ stopped: 'Strata se cerró solo (exit code: 1).' }) })
    render(<StrataPanel load={async () => current} start={vi.fn()} stop={stop} />)
    const stopButton = await screen.findByRole('button', { name: 'Detener Strata' })
    await act(async () => { fireEvent.click(stopButton) })
    expect(stop).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Strata se cerró solo')
    expect(isAppStrata({ provider: 'strata', base_url: running.baseUrl })).toBe(false)
  })

  it('con los dos motores deja elegir la tarjeta y usa la AMD salvo que elijas otra', async () => {
    const both = ['0.1.60-windows-x86_64-cuda-cuda13', '0.1.65-windows-x86_64-hip-rx9070']
    const start = vi.fn(async () => ({ ...running, gpu: 'nvidia' }))
    render(<StrataPanel load={async () => status({ engines: both })} start={start} stop={vi.fn()} />)
    const card = await screen.findByRole('combobox', { name: 'Tarjeta de Strata' })
    expect(card).toHaveValue('amd')
    expect(screen.queryByText(/descargará su motor rx9070/)).toBeNull()
    fireEvent.change(card, { target: { value: 'nvidia' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Iniciar Strata' })) })
    expect(start).toHaveBeenCalledWith(setup.file, 'nvidia')
  })

  it('con un solo motor no pregunta la tarjeta', async () => {
    const start = vi.fn(async () => running)
    render(<StrataPanel load={async () => status({ engines: ['0.1.65-windows-x86_64-hip-rx9070'] })} start={start} stop={vi.fn()} />)
    const startButton = await screen.findByRole('button', { name: 'Iniciar Strata' })
    expect(screen.queryByRole('combobox', { name: 'Tarjeta de Strata' })).toBeNull()
    await act(async () => { fireEvent.click(startButton) })
    expect(start).toHaveBeenCalledWith(setup.file, undefined)
  })

  it('explica qué falta si Strata no está instalado', async () => {
    render(<StrataPanel load={async () => status({ installed: false, setups: [] })} start={vi.fn()} stop={vi.fn()} />)
    expect(await screen.findByText(/Strata no está instalado en este equipo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar Strata' })).toBeNull()
  })

  it('muestra el error si no puede iniciar', async () => {
    render(<StrataPanel load={async () => status()} start={async () => { throw new Error('El puerto 8080 ya está en uso') }} stop={vi.fn()} />)
    const startButton = await screen.findByRole('button', { name: 'Iniciar Strata' })
    await act(async () => { fireEvent.click(startButton) })
    expect(screen.getByRole('alert')).toHaveTextContent('El puerto 8080 ya está en uso')
  })
})
