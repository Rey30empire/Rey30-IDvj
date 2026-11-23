import { describe, expect, it } from 'vitest'
import { applyVoiceStyle, cleanPlumaStyle, plumaStyleInstructions, stretchVoice, styleChangesAudio } from '../pluma-voice-style'

const rate = 24000
const tone = (hz: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, index) => 0.5 * Math.sin(2 * Math.PI * hz * index / rate))
/** The pitch of a clean tone, from its zero crossings. */
const pitchOf = (samples: Float32Array) => {
  let crossings = 0
  for (let index = 1; index < samples.length; index++) if (samples[index - 1] < 0 && samples[index] >= 0) crossings++
  return crossings * rate / samples.length
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)

describe('estilo de la voz de Pluma', () => {
  it('más rápido o más lento sin cambiar el tono', () => {
    const voice = tone(200, 2)
    const fast = stretchVoice(voice, rate, 1.25)
    const slow = stretchVoice(voice, rate, 0.8)
    expect(fast.length / rate).toBeCloseTo(1.6, 1)
    expect(slow.length / rate).toBeCloseTo(2.5, 1)
    expect(pitchOf(fast)).toBeCloseTo(200, -1)
    expect(pitchOf(slow)).toBeCloseTo(200, -1)
    // The windows add up to the original level, without dips or doubling.
    expect(rms(fast.subarray(2000, -2000))).toBeCloseTo(rms(voice), 1)
  })

  it('más agudo o más grave sin cambiar la duración', () => {
    const voice = tone(200, 2)
    const higher = applyVoiceStyle(voice, rate, { speed: 1, pitch: 3 })
    const lower = applyVoiceStyle(voice, rate, { speed: 1, pitch: -3 })
    expect(higher.length / rate).toBeCloseTo(2, 1)
    expect(lower.length / rate).toBeCloseTo(2, 1)
    expect(pitchOf(higher) / 200).toBeCloseTo(2 ** (3 / 12), 1)
    expect(pitchOf(lower) / 200).toBeCloseTo(2 ** (-3 / 12), 1)
  })

  it('sin cambios deja el audio tal cual', () => {
    const voice = tone(200, 0.5)
    expect(styleChangesAudio({ speed: 1, pitch: 0 })).toBe(false)
    expect(applyVoiceStyle(voice, rate, { speed: 1, pitch: 0 })).toBe(voice)
  })

  it('el ánimo y el acento van a lo que dice; normal y neutro no añaden nada', () => {
    expect(plumaStyleInstructions({ emotion: 'normal', accent: 'neutro' })).toBe('')
    const hidden = plumaStyleInstructions({ emotion: 'susurro', accent: 'cuba' })
    expect(hidden).toMatch(/susurros, como escondida/)
    expect(hidden).toMatch(/persona de Cuba/)
    expect(plumaStyleInstructions({ emotion: 'enojada', accent: 'neutro' })).toMatch(/Nunca insultes/)
  })

  it('un ajuste guardado raro vuelve a valores seguros', () => {
    expect(cleanPlumaStyle({ emotion: 'furiosa' as never, accent: 'marte' as never, speed: 9, pitch: Number.NaN })).toEqual({ emotion: 'normal', accent: 'neutro', speed: 1.4, pitch: 0 })
    expect(cleanPlumaStyle(undefined)).toEqual({ emotion: 'normal', accent: 'neutro', speed: 1, pitch: 0 })
  })
})
