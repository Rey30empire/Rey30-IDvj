import { describe, expect, it } from 'vitest'
import { createSpeechEndpoint } from '../audio'

describe('final de turno por silencio', () => {
  const frame = (amplitude: number, ms = 100) => new Float32Array(ms * 16).fill(amplitude)
  it('no envía silencio ni un golpe breve como una frase', () => {
    const endpoint = createSpeechEndpoint()
    for (let i = 0; i < 50; i++) expect(endpoint(frame(0), 16000)).toBe(false)
    expect(endpoint(frame(0.03), 16000)).toBe(false)
    for (let i = 0; i < 20; i++) expect(endpoint(frame(0), 16000)).toBe(false)
  })
  it('espera 1,2 segundos de silencio después de voz suficiente', () => {
    const endpoint = createSpeechEndpoint()
    for (let i = 0; i < 4; i++) expect(endpoint(frame(0.03), 16000)).toBe(false)
    for (let i = 0; i < 11; i++) expect(endpoint(frame(0), 16000)).toBe(false)
    expect(endpoint(frame(0), 16000)).toBe(true)
  })
  it('permite pausas dentro de la frase y reinicia el silencio al hablar', () => {
    const endpoint = createSpeechEndpoint()
    endpoint(frame(0.03, 300), 16000)
    expect(endpoint(frame(0, 1000), 16000)).toBe(false)
    expect(endpoint(frame(0.03, 100), 16000)).toBe(false)
    expect(endpoint(frame(0, 1100), 16000)).toBe(false)
    expect(endpoint(frame(0, 100), 16000)).toBe(true)
  })
  it('ignora bloques vacíos y frecuencias inválidas', () => {
    const endpoint = createSpeechEndpoint()
    expect(endpoint(new Float32Array(), 16000)).toBe(false)
    expect(endpoint(frame(0.03), 0)).toBe(false)
    expect(endpoint(frame(0.03), NaN)).toBe(false)
  })
})
