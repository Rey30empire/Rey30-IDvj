import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true, started: [] as number[] }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
vi.mock('@/lib/platform/utils', async original => ({ ...(await original<typeof import('@/lib/platform/utils')>()), isPlatformTauri: () => h.tauri }))
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (event: unknown) => void = () => {} } }))

const { useCharacterAudio, clonedVoices } = await import('../audio')
const { getOriginalProfile } = await import('../profiles')

/** Half a 24 kHz frame of float32 PCM, base64, as Qwen3-TTS streams it. */
const frame = btoa(String.fromCharCode(...new Uint8Array(new Float32Array(1200).fill(0.1).buffer)))

class FakeContext {
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
  createAnalyser = () => ({ fftSize: 1024, connect: vi.fn(), disconnect: vi.fn(), getFloatTimeDomainData: vi.fn() })
  createBuffer = (_: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) })
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: (at: number) => { h.started.push(at) } })
}

describe('voz clonada de cada asistente', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.started = []
    h.tauri = true
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })
  afterEach(() => {
    useCharacterAudio.getState().stop()
    vi.unstubAllGlobals()
  })

  it('solo en la app de escritorio para Windows', () => {
    expect(clonedVoices()).toBe(true)
    h.tauri = false
    expect(clonedVoices()).toBe(false)
  })

  it('Beto habla con su propia muestra por Qwen3-TTS, nunca con la voz sintética', async () => {
    h.invoke.mockImplementation(async (command: string, args: { events: { onmessage: (event: unknown) => void } }) => {
      if (command !== 'assistant_voice_speak') return undefined
      args.events.onmessage({ data: frame, sampleRate: 24000 })
      args.events.onmessage({ data: frame, sampleRate: 24000 })
      args.events.onmessage({ done: true })
    })
    await useCharacterAudio.getState().speak('Hola, soy Beto.', getOriginalProfile('beto'))
    expect(h.invoke).toHaveBeenCalledWith('assistant_voice_speak', expect.objectContaining({ owner: 'beto', text: 'Hola, soy Beto.' }))
    expect(h.invoke.mock.calls.some(([command]) => command === 'character_audio_synthesize')).toBe(false)
    // The two parts play back to back, without a gap or an overlap.
    expect(h.started).toHaveLength(2)
    expect(h.started[1] - h.started[0]).toBeCloseTo(1200 / 24000, 5)
    expect(useCharacterAudio.getState()).toMatchObject({ status: 'idle', error: null })
  })

  it('Pluma usa sus muestras, que no llevan dueño', async () => {
    h.invoke.mockResolvedValue(undefined)
    await useCharacterAudio.getState().speak('Hola.', getOriginalProfile('literatura'))
    const call = h.invoke.mock.calls.find(([command]) => command === 'assistant_voice_speak')
    expect(call?.[1]).not.toHaveProperty('owner')
  })

  it('sin muestra de voz avisa qué hacer en vez de usar una voz robótica', async () => {
    h.invoke.mockRejectedValue('Este asistente todavía no tiene voz: elige una de Lore, graba la tuya o elige un archivo en Configurar personaje → Voz.')
    await useCharacterAudio.getState().speak('Hola.', getOriginalProfile('coder'))
    expect(useCharacterAudio.getState().status).toBe('error')
    expect(h.invoke.mock.calls.some(([command]) => command === 'character_audio_synthesize')).toBe(false)
  })

  it('detener corta también la voz que todavía se está generando', async () => {
    let finish!: () => void
    h.invoke.mockImplementation((command: string) => command === 'assistant_voice_speak' ? new Promise<void>(done => { finish = done }) : Promise.resolve())
    const speaking = useCharacterAudio.getState().speak('Una frase larga.', getOriginalProfile('beto'))
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledWith('assistant_voice_speak', expect.anything()))
    useCharacterAudio.getState().stop()
    expect(h.invoke).toHaveBeenCalledWith('assistant_voice_cancel', {})
    finish()
    await speaking
    expect(useCharacterAudio.getState().status).toBe('idle')
  })
})
