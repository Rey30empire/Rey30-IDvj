import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), started: [] as number[] }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
vi.mock('@/lib/platform/utils', async original => ({ ...(await original<typeof import('@/lib/platform/utils')>()), isPlatformTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (event: unknown) => void = () => {} } }))
vi.mock('@/lib/characters/voice-recorder', () => ({ audioToVoiceSample: vi.fn(async () => 'UklGRg==') }))

const { PlumaDebatePlayer } = await import('../PlumaDebatePlayer')
const { usePlumaDebate } = await import('@/lib/characters/pluma-debate')
const { useDebateStage } = await import('@/stores/useDebateStage')
const { encodeWav } = await import('@/lib/characters/pluma-debate-player')

const frame = btoa(String.fromCharCode(...new Uint8Array(new Float32Array(480).fill(0.1).buffer)))
// Time runs fifty times faster than the clock, so a debate ends in milliseconds.
class FakeContext {
  t0 = performance.now()
  get currentTime() { return (performance.now() - this.t0) / 1000 * 50 }
  destination = {}
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createAnalyser = () => ({ fftSize: 1024, connect: vi.fn(), getFloatTimeDomainData: (data: Float32Array) => data.fill(0.05) })
  createBuffer = (_: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) })
  createBufferSource = () => {
    const source = { buffer: null, onended: null as null | (() => void), connect: vi.fn(), start: (at = 0) => { h.started.push(at); setTimeout(() => source.onended?.(), 5) }, stop: vi.fn() }
    return source
  }
  decodeAudioData = vi.fn(async () => ({ duration: 0.1 }))
}

const script = 'Pluma: Hoy comentamos «La lluvia».\nCrítico: El final me parece flojo.\nPluma: A mí me conmovió.'
const voices = [{ group: 'Pluma', file: 'Pluma v4.mpeg', name: 'Pluma v4', bytes: 1 }, { group: 'Beto', file: 'Veto 1.mpeg', name: 'Veto 1', bytes: 1 }]
const wav = btoa(String.fromCharCode(...encodeWav(new Float32Array(100), 48000)))

describe('escuchar el debate', () => {
  beforeEach(() => {
    localStorage.clear()
    h.invoke.mockReset()
    h.started = []
    usePlumaDebate.getState().reset()
    usePlumaDebate.getState().setAgent('critico', { tone: 'enojada' })
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    vi.stubGlobal('AudioContext', FakeContext)
    h.invoke.mockImplementation(async (command: string, args: { events?: { onmessage: (event: unknown) => void }; folder?: string }) => {
      if (command === 'lore_voices') return { root: 'C:\\Lore', voices, selected: null }
      if (command === 'lore_voice_read') return btoa('audio de Beto')
      if (command === 'voice_reference_load') return 'voz-beto'
      if (command === 'voice_read_aloud') {
        args.events?.onmessage({ data: frame, sampleRate: 48000 })
        args.events?.onmessage({ done: true })
      }
      if (command === 'debate_save') return { folder: '2026-11-23 21.40 Debate de Pluma y Crítico', files: [] }
      if (command === 'debate_files') return ['Crítico.wav', 'Debate completo.wav', 'Guion.md', 'Pluma.wav', 'debate.json']
      if (command === 'debate_read') return wav
      return undefined
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('no aparece bajo una respuesta normal', () => {
    render(<PlumaDebatePlayer text="Una respuesta normal sin participantes." />)
    expect(screen.queryByTestId('pluma-debate-player')).toBeNull()
  })

  it('lee cada intervención con la voz de su agente, la graba y la guarda en Lore', async () => {
    render(<PlumaDebatePlayer text={script} />)
    expect(screen.getByText('Debate · 3 intervenciones · Pluma, Crítico')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Escuchar debate' })) })
    await waitFor(() => expect(useDebateStage.getState().agents.map(agent => agent.name)).toEqual(['Pluma', 'Crítico']))
    expect(useDebateStage.getState().agents.map(agent => agent.portrait)).toEqual(['pluma', 'blaster'])
    await waitFor(() => expect(screen.getByText(/Guardado en Lore › debates › 2026-11-23 21.40 Debate de Pluma y Crítico/)).toBeInTheDocument())
    const reads = h.invoke.mock.calls.filter(([command]) => command === 'voice_read_aloud').map(([, args]) => args)
    expect(reads).toHaveLength(3)
    expect(reads[0]).toMatchObject({ text: 'Hoy comentamos «La lluvia».' })
    expect(reads[0]).not.toHaveProperty('reference')
    // The man speaks with Beto's voice, the only man's voice in Lore, and angry.
    expect(reads[1]).toMatchObject({ reference: 'voz-beto', text: 'El final me parece flojo.', description: 'angry and annoyed, sharp and firm' })
    expect(h.invoke).toHaveBeenCalledWith('lore_voice_read', { singing: false, group: 'Beto', file: 'Veto 1.mpeg' })
    const save = h.invoke.mock.calls.find(([command]) => command === 'debate_save')?.[1] as { title: string; files: { name: string; data: string }[] }
    expect(save.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Debate de Pluma y Crítico$/)
    expect(save.files.map(file => file.name)).toEqual(['Debate completo.wav', 'Pluma.wav', 'Crítico.wav', 'Guion.md', 'debate.json'])
    // Pluma's track has her two turns; the whole one has all three with pauses.
    const bytes = (name: string) => atob(save.files.find(file => file.name === name)!.data).length - 44
    expect(bytes('Pluma.wav')).toBe((480 * 2 + Math.round(0.35 * 48000)) * 2)
    expect(bytes('Debate completo.wav')).toBe((480 * 3 + Math.round(0.35 * 48000) * 2) * 2)
    const text = (name: string) => new TextDecoder().decode(Uint8Array.from(atob(save.files.find(file => file.name === name)!.data), c => c.charCodeAt(0)))
    expect(text('Guion.md')).toContain('**Crítico:** El final me parece flojo.')
    const timing = JSON.parse(text('debate.json'))
    expect(timing.agents.map((agent: { file: string }) => agent.file)).toEqual(['Pluma.wav', 'Crítico.wav'])
    expect(timing.timing.map((line: { agent: number }) => line.agent)).toEqual([0, 1, 0])
    // The cards go once it ends, and the saved debate offers each voice apart.
    expect(useDebateStage.getState().agents).toEqual([])
    expect(screen.getByRole('button', { name: 'Solo Pluma' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solo Crítico' })).toBeInTheDocument()
  })

  it('un debate ya guardado se escucha desde Lore, completo o una sola voz', async () => {
    localStorage.setItem('rey30-pluma-debate-audio', JSON.stringify({}))
    const { scriptKey } = await import('@/lib/characters/pluma-debate-files')
    localStorage.setItem('rey30-pluma-debate-audio', JSON.stringify({ [scriptKey(script)]: {
      folder: 'Debate guardado',
      agents: [{ name: 'Pluma', gender: 'mujer', portrait: 'pluma', file: 'Pluma.wav' }, { name: 'Crítico', gender: 'hombre', portrait: 'blaster', file: 'Crítico.wav' }],
      timing: [{ agent: 0, start: 0, end: 1 }, { agent: 1, start: 1.35, end: 2 }],
    } }))
    render(<PlumaDebatePlayer text={script} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Solo Crítico' })).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Solo Crítico' })) })
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('debate_read', { folder: 'Debate guardado', file: 'Crítico.wav' }))
    const again = await screen.findByRole('button', { name: /Escuchar debate/ })
    await act(async () => { fireEvent.click(again) })
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('debate_read', { folder: 'Debate guardado', file: 'Debate completo.wav' }))
    // Nothing is generated again.
    expect(h.invoke.mock.calls.some(([command]) => command === 'voice_read_aloud')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir carpeta' }))
    expect(h.invoke).toHaveBeenCalledWith('debate_open', { folder: 'Debate guardado' })
  })

  it('detener corta la lectura y no guarda nada', async () => {
    h.invoke.mockImplementation((command: string) => command === 'voice_read_aloud' ? new Promise(() => undefined)
      : Promise.resolve(command === 'lore_voices' ? { root: null, voices, selected: null } : command === 'lore_voice_read' ? btoa('audio') : command === 'voice_reference_load' ? 'voz-beto' : undefined))
    render(<PlumaDebatePlayer text={script} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Escuchar debate' })) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detener' })).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Detener' })) })
    expect(h.invoke).toHaveBeenCalledWith('assistant_voice_cancel', {})
    expect(screen.getByRole('button', { name: 'Escuchar debate' })).toBeInTheDocument()
    expect(h.invoke.mock.calls.some(([command]) => command === 'debate_save')).toBe(false)
  })
})
