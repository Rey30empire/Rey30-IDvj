import { describe, expect, it } from 'vitest'
import { normalizePlumaDisplayText, normalizePlumaSpeech } from '../pluma-text'

describe('normalización del texto de Pluma', () => {
  it('limpia repeticiones y marcas aisladas con puntuación española', () => {
    expect(normalizePlumaDisplayText('¿¿ Qué tal ??? * Hola..... ¡¡ Bien !!')).toBe('¿Qué tal? Hola… ¡Bien!')
    expect(normalizePlumaDisplayText('Hola... ¿todo bien?')).toBe('Hola... ¿todo bien?')
  })

  it('conserva énfasis, listas, código, cálculo y destinos de enlaces', () => {
    const original = [
      '* **Pluma** usa **`a ?? b`**.....',
      '***',
      '2 * 3',
      '[fuente](./título....md) y https://ejemplo.test/a....b',
      '~~~ts',
      'const x = "....!!"',
      '~~~',
      '    script !!!',
    ].join('\n')
    expect(normalizePlumaDisplayText(original)).toBe(original.replace('**.....', '**…'))
  })

  it('produce una lectura sin Markdown, código extenso ni enlaces técnicos', () => {
    expect(normalizePlumaSpeech('**Hola**... * ¡¡ Lee esto !! [fuente](https://example.com)')).toBe('Hola... ¡Lee esto! fuente')
    expect(normalizePlumaSpeech('~~~js\nconsole.log("hola")\n~~~\n- **Terminé**.....')).toBe('Bloque de código omitido. \nTerminé…')
  })
})
