import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), started: [] as number[] }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
vi.mock('@/lib/platform/utils', async original => ({ ...(await original<typeof import('@/lib/platform/utils')>()), isPlatformTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (event: unknown) => void = () => {} } }))
vi.mock('@/lib/characters/voice-recorder', () => ({ audioToVoiceSample: vi.fn(async () => 'UklGRg==') }))

const { PlumaDebatePlayer } = await import('../PlumaDebatePlayer')
const { usePlumaDebate } = await import('@/lib/characters/pluma-debate')

const frame = btoa(String.fromCharCode(...new Uint8Array(new Float32Array(480).fill(0.1).buffer)))
class FakeContext {
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createBuffer = (_: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) })
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: (at: number) => { h.started.push(at) } })
}

const script = 'Pluma: Hoy comentamos «La lluvia».\nCrítico: El final me parece flojo.\nPluma: A mí me conmovió.'

describe('escuchar el debate', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.started = []
    usePlumaDebate.getState().reset()
    usePlumaDebate.getState().setAgent(1, { tone: 'enojada', voice: { group: 'Beto', file: 'Veto 1.mpeg' } })
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    vi.stubGlobal('AudioContext', FakeContext)
    h.invoke.mockImplementation(async (command: string, args: { events?: { onmessage: (event: unknown) => void } }) => {
      if (command === 'lore_voice_read') return btoa('audio de Beto')
      if (command === 'voice_reference_load') return 'voz-beto'
      if (command === 'voice_read_aloud') {
        args.events?.onmessage({ data: frame, sampleRate: 48000 })
        args.events?.onmessage({ done: true })
      }
      return undefined
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('no aparece bajo una respuesta normal', () => {
    render(<PlumaDebatePlayer text="Una respuesta normal sin participantes." />)
    expect(screen.queryByTestId('pluma-debate-player')).toBeNull()
  })

  it('lee cada intervención con la voz y el tono de su participante', async () => {
    render(<PlumaDebatePlayer text={script} />)
    expect(screen.getByText('Debate · 3 intervenciones · Pluma, Crítico')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Escuchar debate' })) })
    await waitFor(() => expect(h.invoke.mock.calls.filter(([command]) => command === 'voice_read_aloud')).toHaveLength(3))
    const reads = h.invoke.mock.calls.filter(([command]) => command === 'voice_read_aloud').map(([, args]) => args)
    expect(reads[0]).toMatchObject({ text: 'Hoy comentamos «La lluvia».' })
    expect(reads[0]).not.toHaveProperty('reference')
    expect(reads[1]).toMatchObject({ reference: 'voz-beto', text: 'El final me parece flojo.', description: 'angry and annoyed, sharp and firm' })
    expect(h.invoke).toHaveBeenCalledWith('lore_voice_read', { singing: false, group: 'Beto', file: 'Veto 1.mpeg' })
    expect(h.invoke).toHaveBeenCalledWith('voice_reference_load', { audio: 'UklGRg==' })
    // One after another, with a pause between speakers.
    expect(h.started).toHaveLength(3)
    expect(h.started[1] - h.started[0]).toBeCloseTo(480 / 48000 + 0.35, 5)
  })

  it('detener corta la lectura', async () => {
    h.invoke.mockImplementation((command: string) => command === 'voice_read_aloud' ? new Promise(() => undefined)
      : Promise.resolve(command === 'lore_voice_read' ? btoa('audio') : command === 'voice_reference_load' ? 'voz-beto' : undefined))
    render(<PlumaDebatePlayer text={script} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Escuchar debate' })) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detener' })).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Detener' })) })
    expect(h.invoke).toHaveBeenCalledWith('assistant_voice_cancel', {})
    expect(screen.getByRole('button', { name: 'Escuchar debate' })).toBeInTheDocument()
  })
})
