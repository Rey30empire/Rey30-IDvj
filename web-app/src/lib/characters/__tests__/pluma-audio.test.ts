import { describe, expect, it } from 'vitest'
import { createPlumaPcmEncoder, createPlumaTurnDetector, decodePlumaPcm, encodePlumaDictation, encodePlumaWav, isVoiceLike, plumaLowPass, voicePeriodicity } from '../pluma-audio'

describe('grabación en WAV', () => {
  const view = (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    return new DataView(bytes.buffer)
  }

  it('escribe PCM mono de 16 bits a la frecuencia pedida y recorta los picos', () => {
    const wav = view(encodePlumaWav([Float32Array.of(0.5), Float32Array.of(2, -2)], 24000))
    expect(wav.getUint32(0, false)).toBe(0x52494646)
    expect(wav.getUint32(8, false)).toBe(0x57415645)
    expect(wav.getUint16(22, true)).toBe(1)
    expect(wav.getUint32(24, true)).toBe(24000)
    expect(wav.getUint32(40, true)).toBe(6)
    expect([wav.getInt16(44, true), wav.getInt16(46, true), wav.getInt16(48, true)]).toEqual([16384, 32767, -32767])
  })

  it('aguanta una canción entera sin desbordar la pila', () => {
    const seconds = 150
    const wav = encodePlumaWav([new Float32Array(48000 * seconds)], 48000)
    expect(wav.length).toBe(Math.ceil((44 + 48000 * seconds * 2) / 3) * 4)
  })
})

// A voiced vowel: a 150 Hz pitch with its first harmonics.
const voice = (length: number, rate = 48000, gain = 0.1, start = 0) => Float32Array.from({ length }, (_, index) => {
  const at = (start + index) / rate
  return gain * (Math.sin(2 * Math.PI * 150 * at) + 0.5 * Math.sin(2 * Math.PI * 300 * at) + 0.3 * Math.sin(2 * Math.PI * 450 * at)) / 1.8
})
// Breath and room noise: loud, broadband and aperiodic (seeded, so stable).
const breath = (length: number, gain = 0.1, seed = 7) => {
  let state = seed
  return Float32Array.from({ length }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return gain * ((state >>> 0) / 2147483648 - 1)
  })
}

describe('audio de la llamada de Pluma', () => {
  it('ignora silencio inicial, conserva el inicio de un saludo y detecta su final', () => {
    const detector = createPlumaTurnDetector(48000)
    const silence = new Float32Array(1920)
    const speech = voice(1920)
    for (let index = 0; index < 50; index++) expect(detector.push(silence).chunks).toHaveLength(0)
    expect(detector.push(speech).chunks).toHaveLength(0)
    expect(detector.push(speech).chunks).toHaveLength(0)
    // 400 ms of what came before the voice is kept: the soft start of the word.
    expect(detector.push(speech).chunks).toEqual([...Array(7).fill(silence), speech, speech, speech])
    for (let index = 0; index < 11; index++) expect(detector.push(silence).ended).toBe(false)
    expect(detector.push(silence).ended).toBe(true)
    detector.reset()
    expect(detector.push(silence)).toMatchObject({ chunks: [], ended: false })
  })

  it('mantiene el remuestreo entre paquetes con límites desalineados', () => {
    const samples = Float32Array.from({ length: 3401 }, (_, index) => Math.sin(index / 17) * 0.1)
    const encode = createPlumaPcmEncoder(44100, 16000)
    const chunks = [samples.subarray(0, 193), samples.subarray(193, 2048), samples.subarray(2048)]
    const streamed = chunks.flatMap(chunk => Array.from(decodePlumaPcm(encode(chunk))))
    const full = Array.from(decodePlumaPcm(createPlumaPcmEncoder(44100, 16000)(samples)))
    expect(streamed).toEqual(full)
  })

  it('decodifica PCM16 con signo y rechaza fragmentos incompletos', () => {
    const decode = (value: number[]) => decodePlumaPcm(btoa(String.fromCharCode(...value)))
    expect(Array.from(decode([0, 128, 0, 0, 255, 127]))).toEqual([-1, 0, 32767 / 32768])
    expect(() => decode([1])).toThrow(/incompleto/)
  })

  it('agrupa la grabación como PCM16 mono de 16 kHz para el dictado local', () => {
    const chunks = [new Float32Array(480).fill(-0.5), new Float32Array(480).fill(0.5)]
    const samples = decodePlumaPcm(encodePlumaDictation(chunks, 48000))
    expect(samples).toHaveLength(320)
    // The low-pass settles within a few samples and keeps the level.
    expect(samples[100]).toBeCloseTo(-0.5, 3)
    expect(samples[300]).toBeCloseTo(0.5, 3)
  })

  it('filtra el silbido agudo antes de bajar a 16 kHz para que no ensucie la voz', () => {
    const tone = (hz: number) => Float32Array.from({ length: 48000 }, (_, index) => 0.5 * Math.sin(2 * Math.PI * hz * index / 48000))
    const rms = (samples: Float32Array) => Math.sqrt(samples.slice(200).reduce((sum, value) => sum + value * value, 0) / (samples.length - 200))
    const voiceBand = decodePlumaPcm(createPlumaPcmEncoder(48000, 16000)(tone(1000)))
    const hiss = decodePlumaPcm(createPlumaPcmEncoder(48000, 16000)(tone(10000)))
    expect(rms(voiceBand)).toBeCloseTo(0.5 / Math.SQRT2, 2)
    // A 10 kHz hiss would come back at 6 kHz at full level; now it is nearly gone.
    expect(rms(hiss)).toBeLessThan(0.02)
    expect(Array.from(plumaLowPass(16000, 16000))).toEqual([1])
  })

  it('un «sí» corto abre el turno y conserva su consonante inicial', () => {
    const detector = createPlumaTurnDetector(48000)
    const silence = new Float32Array(2048)
    for (let index = 0; index < 20; index++) detector.push(silence)
    const hiss = breath(2048, 0.05, 3)
    expect(detector.push(hiss).chunks).toHaveLength(0)
    expect(detector.push(voice(2048)).chunks).toHaveLength(0)
    const opened = detector.push(voice(2048, 48000, 0.1, 2048)).chunks
    expect(opened).toContain(hiss)
    expect(opened.reduce((ms, chunk) => ms + chunk.length / 48, 0)).toBeGreaterThanOrEqual(400)
  })

  it('un sonido sin voz en mitad de la palabra no borra lo ya oído', () => {
    const detector = createPlumaTurnDetector(48000)
    const start = voice(1920)
    detector.push(start)
    detector.push(breath(1920, 0.05, 9))
    detector.push(voice(1920, 48000, 0.1, 1920))
    const opened = detector.push(voice(1920, 48000, 0.1, 3840)).chunks
    expect(detector.started).toBe(true)
    expect(opened[0]).toBe(start)
  })

  it('en una frase larga espera una pausa más larga antes de cortarla', () => {
    const detector = createPlumaTurnDetector(48000)
    const silence = new Float32Array(1920)
    for (let index = 0; index < 30; index++) detector.push(voice(1920, 48000, 0.1, index * 1920))
    for (let index = 0; index < 18; index++) expect(detector.push(silence).ended).toBe(false)
    expect(detector.push(silence).ended).toBe(true)
  })

  it('distingue una voz de la respiración y el ruido aunque suenen igual de fuerte', () => {
    for (const rate of [16000, 44100, 48000]) {
      expect(voicePeriodicity(voice(2048, rate), rate)).toBeGreaterThan(0.8)
      expect(isVoiceLike(voice(2048, rate), rate)).toBe(true)
      expect(voicePeriodicity(breath(2048), rate)).toBeLessThan(0.3)
      expect(isVoiceLike(breath(2048, 0.3), rate)).toBe(false)
    }
    expect(isVoiceLike(new Float32Array(2048).fill(0.2), 48000)).toBe(false)
    expect(isVoiceLike(new Float32Array(2048), 48000)).toBe(false)
  })

  it('no abre un turno por una respiración fuerte', () => {
    const detector = createPlumaTurnDetector(48000)
    for (let index = 0; index < 20; index++) {
      expect(detector.push(breath(1920, 0.2, index + 1))).toMatchObject({ chunks: [], voiced: false, ended: false })
    }
    expect(detector.started).toBe(false)
  })

  it('una respiración entre frases no corta el turno ya iniciado', () => {
    const detector = createPlumaTurnDetector(48000)
    for (let index = 0; index < 3; index++) detector.push(voice(1920, 48000, 0.1, index * 1920))
    expect(detector.started).toBe(true)
    for (let index = 0; index < 10; index++) expect(detector.push(breath(1920, 0.05, index + 1)).ended).toBe(false)
    expect(detector.push(voice(1920)).ended).toBe(false)
  })
})
