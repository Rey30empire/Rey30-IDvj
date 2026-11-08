import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultCharacterData } from '../profiles'
import {
  createSpeechEndpoint,
  defaultVoiceId,
  resamplePcm16,
  speechChunks,
  speechText,
  useCharacterAudio,
} from '../audio'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke }) }),
}))
describe('audio local de personajes', () => {
  beforeEach(() => {
    useCharacterAudio.getState().stop()
    invoke.mockReset()
    useCharacterAudio.setState({
      catalogLoaded: false,
      voices: [],
      error: null,
    })
  })
  afterEach(() => {
    useCharacterAudio.getState().stop()
    vi.unstubAllGlobals()
  })
  it('asigna a los once asistentes variantes de las seis voces locales instaladas', () => {
    const ids = createDefaultCharacterData().profiles.map(defaultVoiceId)
    expect(new Set(ids).size).toBe(6)
    expect(ids.every((id) => /^espeak:es-419\+(m[1-5]|f3)$/.test(id))).toBe(true)
    expect(ids).toHaveLength(11)
  })
  it('omite código, enlaces y marcas sin leer contenido de herramientas', () => {
    expect(
      speechText(
        '**Hola** [fuente](https://example.com) ```sh\nrm archivo\n```'
      )
    ).toBe('Hola fuente  Bloque de código omitido.')
    expect(speechText('![imagen](https://example.com/a.png)')).toBe('')
  })
  it('lee en fragmentos acotados sin truncar el final', () => {
    const original = 'palabra '.repeat(1100).trim()
    const chunks = speechChunks(original)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true)
    expect(chunks.join(' ')).toBe(original)
    expect(() => speechChunks('a'.repeat(24001))).toThrow('demasiado larga')
  })
  it('convierte mono a PCM16 little-endian y recorta a 30 segundos', () => {
    const pcm = resamplePcm16([new Float32Array([-2, -1, 0, 1, 2])], 16000)
    const view = new DataView(pcm.buffer)
    expect(
      Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true))
    ).toEqual([-32768, -32768, 0, 32767, 32767])
    expect(resamplePcm16([new Float32Array(48000)], 48000).byteLength).toBe(
      32000
    )
    expect(
      resamplePcm16([new Float32Array(16000 * 31)], 16000).byteLength
    ).toBe(960000)
    expect(() => resamplePcm16([], 0)).toThrow('no válida')
  })
  it('comparte la consulta de catálogo en curso y permite reintentar un fallo', async () => {
    let resolve!: (value: unknown) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const first = useCharacterAudio.getState().loadCatalog()
    const second = useCharacterAudio.getState().loadCatalog()
    expect(invoke).toHaveBeenCalledTimes(1)
    resolve({ voices: [], dictation: true })
    await Promise.all([first, second])
    expect(useCharacterAudio.getState().dictation).toBe(true)
    useCharacterAudio.setState({ catalogLoaded: false })
    invoke.mockRejectedValueOnce(new Error('offline'))
    await useCharacterAudio.getState().loadCatalog()
    expect(useCharacterAudio.getState().catalogLoaded).toBe(false)
    expect(useCharacterAudio.getState().error).toContain(
      'chat sigue disponible'
    )
  })
  it('al detener síntesis pendiente cancela el job y descarta audio tardío', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const decode = vi.fn()
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = vi.fn().mockResolvedValue(undefined)
        close = close
        decodeAudioData = decode
      }
    )
    let resolve!: (value: unknown) => void
    invoke.mockImplementation((name: string) =>
      name === 'character_audio_synthesize'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve()
    )
    const speaking = useCharacterAudio
      .getState()
      .speak('Hola', createDefaultCharacterData().profiles[0])
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'character_audio_synthesize',
        expect.anything()
      )
    )
    const jobId = invoke.mock.calls.find(
      ([name]) => name === 'character_audio_synthesize'
    )![1].jobId
    useCharacterAudio.getState().stop()
    resolve({ audioBase64: 'invalid-late-audio' })
    await speaking
    expect(invoke).toHaveBeenCalledWith('character_audio_cancel', { jobId })
    expect(decode).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(useCharacterAudio.getState().status).toBe('idle')
    expect(useCharacterAudio.getState().autoplayCancelled).toBe(true)
    vi.unstubAllGlobals()
  })

  it('solo finaliza tras voz suficiente y silencio sostenido, no al recibir silencio inicial', () => {
    const ended = createSpeechEndpoint()
    expect(ended(new Float32Array(16000 * 2), 16000)).toBe(false)
    expect(ended(new Float32Array(16000 / 2).fill(0.1), 16000)).toBe(false)
    expect(ended(new Float32Array(16000), 16000)).toBe(false)
    expect(ended(new Float32Array(3200), 16000)).toBe(true)
  })

  it('un propietario obsoleto no inicia audio ni detiene el trabajo de una sesión nueva', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const decode = vi.fn()
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = vi.fn().mockResolvedValue(undefined)
        close = close
        decodeAudioData = decode
      }
    )
    let resolve!: (value: unknown) => void
    invoke.mockImplementation((name: string) =>
      name === 'character_audio_synthesize'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve()
    )
    const speaking = useCharacterAudio
      .getState()
      .speak('Hola', createDefaultCharacterData().profiles[0], {
        owner: 'avatar:new',
        isCurrent: () => true,
      })
    await vi.waitFor(() =>
      expect(useCharacterAudio.getState().status).toBe('preparing')
    )
    await useCharacterAudio
      .getState()
      .speak('Texto obsoleto', createDefaultCharacterData().profiles[1], {
        owner: 'avatar:old',
        isCurrent: () => false,
      })
    useCharacterAudio.getState().stop('avatar:old')
    expect(useCharacterAudio.getState()).toMatchObject({
      owner: 'avatar:new',
      status: 'preparing',
    })
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === 'character_audio_synthesize'
      )
    ).toHaveLength(1)
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === 'character_audio_cancel'
      )
    ).toHaveLength(0)
    useCharacterAudio.getState().stop('avatar:new')
    resolve({ audioBase64: 'invalid-late-audio' })
    await speaking
    expect(decode).not.toHaveBeenCalled()
    expect(useCharacterAudio.getState()).toMatchObject({
      owner: null,
      status: 'idle',
    })
  })

  it('descarta la síntesis al revocarse autorización durante await sin reproducir ni publicar error tardío', async () => {
    let allowed = true
    const close = vi.fn().mockResolvedValue(undefined)
    const decode = vi.fn()
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = vi.fn().mockResolvedValue(undefined)
        close = close
        decodeAudioData = decode
      }
    )
    let resolve!: (value: unknown) => void
    invoke.mockImplementation((name: string) =>
      name === 'character_audio_synthesize'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve()
    )
    const speaking = useCharacterAudio
      .getState()
      .speak('Texto propio QA', createDefaultCharacterData().profiles[0], {
        owner: 'avatar:owned',
        isCurrent: () => allowed,
      })
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'character_audio_synthesize',
        expect.anything()
      )
    )
    allowed = false
    resolve({ audioBase64: 'invalid-after-authorization-revoked' })
    await speaking
    expect(decode).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(useCharacterAudio.getState()).toMatchObject({
      status: 'idle',
      owner: null,
      error: null,
    })
  })

  it('cierra un permiso de micrófono que llega tarde sin tocar el audio de la sesión siguiente', async () => {
    let grant!: (stream: MediaStream) => void
    const stopped = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              grant = resolve
            })
        ),
      },
    })
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = vi.fn().mockResolvedValue(undefined)
        close = close
      }
    )
    let resolveAudio!: (value: unknown) => void
    invoke.mockImplementation((name: string) =>
      name === 'character_audio_synthesize'
        ? new Promise((resolve) => {
            resolveAudio = resolve
          })
        : Promise.resolve()
    )
    useCharacterAudio.setState({ dictation: true })
    const callback = vi.fn()
    const recording = useCharacterAudio
      .getState()
      .startDictation(callback, { owner: 'avatar:old' })
    useCharacterAudio.getState().stop('avatar:old')
    const speaking = useCharacterAudio
      .getState()
      .speak('Sesión nueva', createDefaultCharacterData().profiles[0], {
        owner: 'avatar:new',
      })
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'character_audio_synthesize',
        expect.anything()
      )
    )
    grant({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream)
    await recording
    expect(stopped).toHaveBeenCalledOnce()
    expect(callback).not.toHaveBeenCalled()
    expect(useCharacterAudio.getState()).toMatchObject({
      owner: 'avatar:new',
      status: 'preparing',
    })
    useCharacterAudio.getState().stop()
    resolveAudio({ audioBase64: 'late' })
    await speaking
  })

  it('una transcripción tardía no escribe en otro chat ni cancela el micrófono nuevo', async () => {
    const nodes: Array<{
      onaudioprocess: ((event: unknown) => void) | null
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }> = []
    const stopped = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopped }],
        })),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 16000
        destination = {}
        resume = vi.fn().mockResolvedValue(undefined)
        close = vi.fn().mockResolvedValue(undefined)
        createMediaStreamSource() {
          return { connect: vi.fn() }
        }
        createScriptProcessor() {
          const node = {
            onaudioprocess: null,
            connect: vi.fn(),
            disconnect: vi.fn(),
          }
          nodes.push(node)
          return node
        }
        createGain() {
          return { gain: { value: 0 }, connect: vi.fn() }
        }
      }
    )
    let transcript!: (value: unknown) => void
    invoke.mockImplementation((name: string) =>
      name === 'character_audio_transcribe'
        ? new Promise((resolve) => {
            transcript = resolve
          })
        : Promise.resolve()
    )
    useCharacterAudio.setState({ dictation: true })
    const oldText = vi.fn()
    const newText = vi.fn()
    await useCharacterAudio
      .getState()
      .startDictation(oldText, { owner: 'avatar:old' })
    nodes[0].onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(16000).fill(0.1) },
    })
    const processing = useCharacterAudio.getState().finishDictation()
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'character_audio_transcribe',
        expect.anything()
      )
    )
    useCharacterAudio.getState().stop('avatar:old')
    await useCharacterAudio
      .getState()
      .startDictation(newText, { owner: 'avatar:new' })
    transcript({ text: 'Texto del chat viejo que no debe enviarse' })
    await processing
    expect(oldText).not.toHaveBeenCalled()
    expect(newText).not.toHaveBeenCalled()
    expect(useCharacterAudio.getState()).toMatchObject({
      owner: 'avatar:new',
      status: 'listening',
    })
    useCharacterAudio.getState().stop('avatar:old')
    expect(useCharacterAudio.getState().status).toBe('listening')
    useCharacterAudio.getState().stop()
    expect(useCharacterAudio.getState()).toMatchObject({
      status: 'idle',
      owner: null,
    })
  })

  it('limita la captura por muestras a 30 segundos aunque el temporizador todavía no haya vencido', async () => {
    const stopped = vi.fn()
    let process!: (event: unknown) => void
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopped }],
        })),
      },
    })
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 16000
        destination = {}
        resume = vi.fn().mockResolvedValue(undefined)
        close = vi.fn().mockResolvedValue(undefined)
        createMediaStreamSource() {
          return { connect: vi.fn() }
        }
        createScriptProcessor() {
          const node = {
            onaudioprocess: null as ((event: unknown) => void) | null,
            connect: vi.fn(),
            disconnect: vi.fn(),
          }
          Object.defineProperty(node, 'onaudioprocess', {
            set: (callback) => {
              if (callback) process = callback
            },
          })
          return node
        }
        createGain() {
          return { gain: { value: 0 }, connect: vi.fn() }
        }
      }
    )
    invoke.mockResolvedValue({ text: 'Texto simulado propio QA' })
    useCharacterAudio.setState({ dictation: true })
    const callback = vi.fn()
    await useCharacterAudio
      .getState()
      .startDictation(callback, { owner: 'owned-cap' })
    process({
      inputBuffer: {
        getChannelData: () => new Float32Array(16000 * 31).fill(0.1),
      },
    })
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith('Texto simulado propio QA')
    )
    const request = invoke.mock.calls.find(
      ([command]) => command === 'character_audio_transcribe'
    )![1]
    expect(atob(request.pcmBase64).length).toBe(960000)
    expect(stopped).toHaveBeenCalledOnce()
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === 'character_audio_transcribe'
      )
    ).toHaveLength(1)
  })
})
