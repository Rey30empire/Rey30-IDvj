import { describe, expect, it } from 'vitest'
import { prepareVoiceSample, VOICE_SAMPLE_MAX_SECONDS } from '../voice-recorder'

const rate = 1_000
/** `quiet` seconds of silence, `voice` seconds of a tone at `loudness`, then silence again. */
function take(quiet: number, voice: number, loudness = 0.3) {
  const samples = new Float32Array(Math.round((quiet * 2 + voice) * rate))
  for (let index = quiet * rate; index < (quiet + voice) * rate; index++) samples[index] = Math.sin(index / 3) * loudness
  return samples
}

describe('muestra de voz grabada', () => {
  it('recorta el silencio de los bordes y deja un margen corto', () => {
    const sample = prepareVoiceSample(take(2, 8), rate)
    expect(sample.length / rate).toBeGreaterThan(8)
    expect(sample.length / rate).toBeLessThan(8.4)
  })

  it('iguala el volumen de una grabación baja', () => {
    const sample = prepareVoiceSample(take(0, 6, 0.1), rate)
    expect(Math.max(...sample.map(Math.abs))).toBeGreaterThan(0.35)
    expect(Math.max(...sample.map(Math.abs))).toBeLessThanOrEqual(0.9)
  })

  it('pide más voz si es demasiado corta y avisa si no se oye nada', () => {
    expect(() => prepareVoiceSample(take(3, 2), rate)).toThrow(/al menos 5 segundos/)
    expect(() => prepareVoiceSample(new Float32Array(10 * rate), rate)).toThrow(/No se oye tu voz/)
  })

  it('se queda con medio minuto como mucho', () => {
    const sample = prepareVoiceSample(take(0, 50), rate)
    expect(sample.length / rate).toBeLessThanOrEqual(VOICE_SAMPLE_MAX_SECONDS)
  })
})
