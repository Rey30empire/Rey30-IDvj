import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ invoke: vi.fn(), answer: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (event: unknown) => void = () => {} } }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: mock.invoke }) }) }))
vi.mock('../pluma-gemma', async original => ({ ...await original<typeof import('../pluma-gemma')>(), answerWithGemma: mock.answer, warmPlumaGemma: vi.fn(async () => undefined) }))
vi.mock('../pluma-realtime', () => ({ supportsPlumaCall: () => true, describeStartError: (cause: unknown) => String(cause) }))

import { decodePlumaCloneAudio, startPlumaClone } from '../pluma-clone'
import { PlumaAudioNotUnderstoodError } from '../pluma-gemma'

function floatAudio(values: number[]) {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return btoa(String.fromCharCode(...bytes))
}

const processor = { onaudioprocess: null as ((event: unknown) => void) | null, connect: vi.fn(), disconnect: vi.fn() }
const source = { onended: null as (() => void) | null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null }
const track = { stop: vi.fn(), addEventListener: vi.fn(), getSettings: vi.fn() }
const microphone = vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }))
let audioClock = 0
let canSing = false
class FakeAudioContext {
  sampleRate = 48000
  get currentTime() { return audioClock }
  destination = {}
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn() })
  createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData: vi.fn() })
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  createScriptProcessor = () => processor
  createBuffer = (_channels: number, size: number, rate: number) => ({ duration: size / rate, getChannelData: () => new Float32Array(size) })
  createBufferSource = () => source
  resume = async () => {}
  close = async () => {}
}

const frameLength = 2048
const frameRate = 48000
function capture(samples: Float32Array) {
  audioClock += samples.length / frameRate
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } })
}

function captureTone(frequency: number, origin: number, gain: number) {
  capture(Float32Array.from({ length: frameLength }, (_, index) => {
    const at = audioClock + index / frameRate - origin
    return at < 0 ? 0 : gain * Math.sin(2 * Math.PI * frequency * at)
  }))
}

// A voiced vowel (150 Hz pitch and harmonics) on the capture clock.
function captureVoice(gain = 0.1) {
  capture(Float32Array.from({ length: frameLength }, (_, index) => {
    const at = audioClock + index / frameRate
    return gain * (Math.sin(2 * Math.PI * 150 * at) + 0.5 * Math.sin(2 * Math.PI * 300 * at)) / 1.5
  }))
}

// Breath or room noise: loud but aperiodic.
let noiseState = 12345
function captureBreath(gain: number) {
  capture(Float32Array.from({ length: frameLength }, () => {
    noiseState ^= noiseState << 13
    noiseState ^= noiseState >>> 17
    noiseState ^= noiseState << 5
    return gain * ((noiseState >>> 0) / 2147483648 - 1)
  }))
}

function simulateTurn() {
  for (let index = 0; index < 3; index++) captureVoice()
  for (let index = 0; index < 24; index++) capture(new Float32Array(frameLength))
}

beforeEach(() => {
  vi.clearAllMocks()
  audioClock = 0
  canSing = false
  processor.onaudioprocess = null
  source.onended = null
  track.getSettings.mockReturnValue({ echoCancellation: 'all' })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } })
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === 'pluma_clone_reference_status') return { ready: true, format: 'wav' }
    if (command === 'pluma_clone_start') { args.events.onmessage({ type: 'clone.ready', canSing }); return 'sesión' }
    if (command === 'character_audio_transcribe') return { text: 'Hola, Pluma' }
    if (command === 'pluma_clone_speak') {
      args.events.onmessage({ sampleRate: 24000, data: floatAudio([0.1, 0.2]) })
      args.events.onmessage({ done: true })
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('llamada clonada de Pluma sin dispositivos ni modelos reales', () => {
  it('envía audio WAV a Gemma, sintetiza texto limpio y vuelve a escuchar', async () => {
    mock.answer.mockResolvedValue({ text: '**Hola**..... ¿¿ Qué tal ???', messages: [] })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      const request = mock.answer.mock.calls[0][0]
      expect(atob(request.audioWav).slice(0, 4)).toBe('RIFF')
      expect(mock.invoke.mock.calls.some(([command]) => command === 'character_audio_transcribe')).toBe(false)
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: 'Hola… ¿Qué tal?' }))
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
    } finally { call.stop() }
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_stop', { sessionId: 'sesión' })
  })

  it.each([true, false])('solo conserva el canto que el motor pudo reproducir (éxito=%s)', async success => {
    canSing = true
    const song = { lyrics: 'Cae la lluvia. La noche canta.', style: 'bolero' }
    mock.answer.mockResolvedValueOnce({ text: '', song, messages: [{ role: 'user', content: 'Canta un bolero.' }] })
      .mockResolvedValueOnce({ text: 'Seguimos.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    mock.invoke.mockImplementation(async (command, args) => {
      if (command !== 'pluma_clone_sing') return nativeInvoke(command, args)
      args.events.onmessage({ sampleRate: 48000, data: floatAudio(success ? [0.1, 0.2] : [0, 0]) })
      args.events.onmessage({ done: true })
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn(), onSongCapability: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      expect(callbacks.onSongCapability).toHaveBeenCalledWith(true)
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith(success ? 'singing' : 'speaking'))
      expect(callbacks.onPhase).toHaveBeenCalledWith('composing')
      expect(mock.answer).toHaveBeenNthCalledWith(1, expect.objectContaining({ turnId: 1, canSing: true }))
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_sing', expect.objectContaining({ ...song, turnId: 1, sessionId: 'sesión' }))
      if (success) expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_speak', expect.anything())
      else expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: 'No pude generar el audio cantado. Seguimos en la llamada.' }))
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      const history = [
        { role: 'user', content: 'Canta un bolero.' },
        { role: 'assistant', content: success ? `Generé una canción con esta letra:\n${song.lyrics}` : 'No pude generar el audio cantado. Seguimos en la llamada.' },
      ]
      await vi.waitFor(() => expect(mock.answer).toHaveBeenNthCalledWith(2, expect.objectContaining({ turnId: 2, previousMessages: history })))
      expect(callbacks.onError).not.toHaveBeenCalled()
    } finally { call.stop() }
  })

  it.each([true, false])('responde directamente solo al primer saludo verificado (saludo=%s)', async greeting => {
    mock.answer.mockResolvedValue({ text: 'Respuesta de Gemma.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    let recognition: { onmessage: (event: unknown) => void } | undefined
    mock.invoke.mockImplementation(async (command, args) => {
      if (command === 'pluma_first_asr_start') {
        recognition = args.events
        recognition!.onmessage({ type: 'ready' })
        return 'reconocimiento'
      }
      if (command === 'pluma_first_asr_finish') {
        const words = greeting ? ['hola', 'pluma'] : ['hola', 'canta']
        recognition!.onmessage({ type: 'result', text: words.join(' '), words: words.map((word, index) => ({
          word, start: index * 0.08, end: (index + 1) * 0.08, conf: 0.9,
        })) })
        return
      }
      return nativeInvoke(command, args)
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      expect(mock.answer).toHaveBeenCalledTimes(greeting ? 0 : 1)
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: greeting ? 'Hola, ¿qué tal?' : 'Respuesta de Gemma.' }))
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(mock.answer).toHaveBeenCalledTimes(greeting ? 1 : 2))
      if (greeting) expect(mock.answer.mock.lastCall?.[0].previousMessages).toMatchObject([
        { role: 'user', content: [expect.anything(), { input_audio: { format: 'wav' } }] },
        { role: 'assistant', content: 'Hola, ¿qué tal?' },
      ])
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_realtime_start', expect.anything())
      expect(mock.invoke).toHaveBeenCalledWith('pluma_first_asr_stop', { sessionId: 'reconocimiento' })
    } finally { call.stop() }
  })

  it('recurre al dictado solo cuando Gemma señala que no entendió el audio', async () => {
    mock.answer.mockResolvedValueOnce({ text: 'No entendí la frase.', messages: [] }).mockResolvedValueOnce({ text: 'Hola.', messages: [] })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      expect(mock.invoke).toHaveBeenCalledWith('character_audio_transcribe', expect.objectContaining({ pcmBase64: expect.any(String) }))
      expect(mock.invoke).toHaveBeenCalledWith('character_audio_transcribe', expect.objectContaining({ pcmBase64: expect.any(String) }))
      expect(mock.answer).toHaveBeenNthCalledWith(2, expect.objectContaining({ transcript: 'Hola, Pluma' }))
    } finally { call.stop() }
  })

  it('espera el audio y el cierre del canal si la llamada IPC termina antes', async () => {
    mock.answer.mockResolvedValue({ text: 'Hola.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    let events: { onmessage: (event: unknown) => void } | undefined
    mock.invoke.mockImplementation(async (command, args) => {
      if (command === 'pluma_clone_speak') { events = args.events; return }
      return nativeInvoke(command, args)
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(events).toBeDefined())
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('thinking')
      events!.onmessage({ sampleRate: 24000, data: floatAudio([0.1, 0.2]) })
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking')
      source.onended?.()
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('thinking')
      events!.onmessage({ done: true })
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
    } finally { call.stop() }
  })

  it('sintetiza la primera frase útil antes de que termine Gemma y lee el resto una vez', async () => {
    let emit: ((text: string) => void) | undefined
    let finishGemma: (() => void) | undefined
    const response = 'Claro. La lluvia marca el ritmo. La última frase cambia el tono.'
    mock.answer.mockImplementation(({ onTextDelta }) => {
      emit = onTextDelta
      return new Promise(resolve => { finishGemma = () => resolve({ text: response, messages: [] }) })
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(emit).toBeDefined())
      emit!('Claro. La lluvia marca')
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_speak', expect.anything())
      emit!(' el ritmo.')
      await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: 'La lluvia marca el ritmo.' })))
      source.onended?.()
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('thinking')
      finishGemma!()
      await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: 'La última frase cambia el tono.' })))
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      expect(callbacks.onFirstAudio).toHaveBeenCalledOnce()
      expect(callbacks.onError).not.toHaveBeenCalled()
    } finally { call.stop(); finishGemma?.() }
  })

  it('lee cada tramo de frases mientras Gemma sigue escribiendo, en orden', async () => {
    let emit: ((text: string) => void) | undefined
    let finishGemma: (() => void) | undefined
    const second = 'Después cruzamos el puente viejo hasta llegar al río.'
    const third = 'Allí esperamos juntos a que bajara la marea.'
    const response = `Hola. Te cuento una historia corta. ${second} ${third} Fin.`
    mock.answer.mockImplementation(({ onTextDelta }) => {
      emit = onTextDelta
      return new Promise(resolve => { finishGemma = () => resolve({ text: response, messages: [] }) })
    })
    const spoken = () => mock.invoke.mock.calls.filter(([command]) => command === 'pluma_clone_speak').map(([, args]) => args.text)
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(emit).toBeDefined())
      emit!('Hola. Te cuento una historia corta. ')
      await vi.waitFor(() => expect(spoken()).toEqual(['Hola. Te cuento una historia corta.']))
      emit!(`${second} Allí esperamos`)
      await vi.waitFor(() => expect(spoken()).toEqual(['Hola. Te cuento una historia corta.', second]))
      emit!(' juntos a que bajara la marea. ')
      await vi.waitFor(() => expect(spoken()).toEqual(['Hola. Te cuento una historia corta.', second, third]))
      finishGemma!()
      await vi.waitFor(() => expect(spoken()).toEqual(['Hola. Te cuento una historia corta.', second, third, 'Fin.']))
      expect(callbacks.onError).not.toHaveBeenCalled()
    } finally { call.stop(); finishGemma?.() }
  })

  it('no se interrumpe por una respiración o ruido fuerte mientras habla', async () => {
    mock.answer.mockResolvedValueOnce({ text: 'Primera respuesta.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    let finishSpeech: (() => void) | undefined
    mock.invoke.mockImplementation(async (command, args) => {
      if (command !== 'pluma_clone_speak') return nativeInvoke(command, args)
      args.events.onmessage({ sampleRate: 24000, data: floatAudio(Array.from({ length: 3000 }, (_, index) => 0.4 * Math.sin(2 * Math.PI * 440 * index / 24000))) })
      await new Promise<void>(resolve => { finishSpeech = resolve })
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      for (let index = 0; index < 20; index++) captureBreath(0.2)
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_cancel_turn', expect.anything())
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking')
      for (let index = 0; index < 6; index++) captureVoice(0.12)
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_cancel_turn', { sessionId: 'sesión', turnId: 1 })
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening')
    } finally { call.stop(); finishSpeech?.() }
  })

  it('descarta paquetes tardíos al pausar aunque la síntesis IPC siga pendiente', async () => {
    mock.answer.mockResolvedValue({ text: 'Hola.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    let events: { onmessage: (event: unknown) => void } | undefined
    let finishInvoke: (() => void) | undefined
    mock.invoke.mockImplementation(async (command, args) => {
      if (command !== 'pluma_clone_speak') return nativeInvoke(command, args)
      events = args.events
      await new Promise<void>(resolve => { finishInvoke = resolve })
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(events).toBeDefined())
      const handler = events!.onmessage
      call.stop()
      await vi.waitFor(() => expect(events!.onmessage).not.toBe(handler))
      events!.onmessage({ sampleRate: 24000, data: floatAudio([0.1, 0.2]) })
      events!.onmessage({ done: true })
      expect(callbacks.onFirstAudio).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_stop', { sessionId: 'sesión' })
    } finally { call.stop(); finishInvoke?.() }
  })

  it('lee float32 little-endian y rechaza paquetes truncados', () => {
    expect(Array.from(decodePlumaCloneAudio(floatAudio([-2, 0.25, 2, NaN])))).toEqual([-1, 0.25, 1, 0])
    expect(() => decodePlumaCloneAudio(btoa('x'))).toThrow(/incompleto/)
  })

  it.each([false, true])('ignora el eco e interrumpe el audio ante una voz nueva sostenida (canto=%s)', async singing => {
    canSing = singing
    const firstCommand = singing ? 'pluma_clone_sing' : 'pluma_clone_speak'
    const firstPhase = singing ? 'singing' : 'speaking'
    mock.answer.mockResolvedValueOnce(singing
      ? { text: '', song: { lyrics: 'La tarde canta.', style: 'bolero' }, messages: [{ role: 'user', content: 'Canta.' }] }
      : { text: 'Primera respuesta.', messages: [{ role: 'assistant', content: 'Incompleta' }] })
      .mockResolvedValueOnce({ text: 'Segunda respuesta.', messages: [{ role: 'assistant', content: 'Completada' }] })
      .mockResolvedValueOnce({ text: 'Tercera respuesta.', messages: [] })
    const nativeInvoke = mock.invoke.getMockImplementation()!
    const output = floatAudio(Array.from({ length: 3000 }, (_, index) => 0.4 * Math.sin(2 * Math.PI * 440 * index / 24000)))
    let staleEvents: { onmessage: (event: unknown) => void } | undefined
    let finishCanceled: (() => void) | undefined
    mock.invoke.mockImplementation(async (command, args) => {
      if (command !== firstCommand || args.turnId !== 1) return nativeInvoke(command, args)
      staleEvents = args.events
      for (let index = 0; index < 12; index++) args.events.onmessage({ sampleRate: 24000, data: output })
      await new Promise<void>(resolve => { finishCanceled = resolve })
    })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith(firstPhase))
      const start = source.start.mock.calls[0][0]
      const staleEnded = source.onended
      for (let index = 0; index < 11; index++) captureTone(440, start + 0.052, 0.1)
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_cancel_turn', expect.anything())
      for (let index = 0; index < 3; index++) captureTone(720, 0, 0.12)
      expect(callbacks.onPhase).toHaveBeenLastCalledWith(firstPhase)
      for (let index = 0; index < 3; index++) captureTone(720, 0, 0.12)
      if (singing) {
        // A song takes close to a full second of voice before it stops, so a
        // quarter second of bleed or a stray word does not cut it.
        expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_cancel_turn', expect.anything())
        for (let index = 0; index < 16; index++) captureTone(720, 0, 0.12)
      }
      expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_cancel_turn', { sessionId: 'sesión', turnId: 1 })
      expect(source.stop).toHaveBeenCalled()
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening')
      staleEvents!.onmessage({ sampleRate: 24000, data: output })
      staleEvents!.onmessage({ done: true })
      finishCanceled?.()
      for (let index = 0; index < 24; index++) capture(new Float32Array(frameLength))
      await vi.waitFor(() => expect(mock.answer).toHaveBeenNthCalledWith(2, expect.objectContaining({ turnId: 2, previousMessages: [] })))
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      staleEnded?.()
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking')
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(mock.answer).toHaveBeenNthCalledWith(3, expect.objectContaining({ turnId: 3, previousMessages: [{ role: 'assistant', content: 'Completada' }] })))
      expect(callbacks.onError).not.toHaveBeenCalled()
    } finally { call.stop(); finishCanceled?.() }
  })

  it('permite terminar el turno y volver a escuchar si falla el reconocimiento', async () => {
    mock.answer.mockRejectedValueOnce(new PlumaAudioNotUnderstoodError())
    const nativeInvoke = mock.invoke.getMockImplementation()!
    mock.invoke.mockImplementation(async (command, args) => command === 'character_audio_transcribe' ? { text: '' } : nativeInvoke(command, args))
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('pluma_clone_speak', expect.objectContaining({ text: 'No te entendí bien. ¿Puedes repetirlo?' })))
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_stop', expect.anything())
    } finally { call.stop() }
  })

  it('no descarta la respuesta por un sonido mientras todavía la prepara', async () => {
    mock.answer.mockImplementation(() => new Promise(() => undefined))
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(mock.answer).toHaveBeenCalled())
      for (let index = 0; index < 16; index++) captureTone(720, 0, 0.12)
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_cancel_turn', expect.anything())
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('thinking')
    } finally { call.stop() }
  })

  it('mantiene turnos alternados si el dispositivo no ofrece cancelación de eco', async () => {
    track.getSettings.mockReturnValue({ echoCancellation: false })
    mock.answer.mockResolvedValue({ text: 'Hola.', messages: [] })
    const callbacks = { isCurrent: () => true, onPhase: vi.fn(), onAmplitude: vi.fn(), onError: vi.fn(), onFirstAudio: vi.fn() }
    const call = startPlumaClone(callbacks, 0.8)
    try {
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
      simulateTurn()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking'))
      for (let index = 0; index < 9; index++) captureTone(720, 0, 0.12)
      expect(mock.invoke).not.toHaveBeenCalledWith('pluma_clone_cancel_turn', expect.anything())
      expect(callbacks.onPhase).toHaveBeenLastCalledWith('speaking')
      source.onended?.()
      await vi.waitFor(() => expect(callbacks.onPhase).toHaveBeenLastCalledWith('listening'))
    } finally { call.stop() }
  })
})
