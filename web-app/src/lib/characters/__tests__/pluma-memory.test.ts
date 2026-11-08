import { describe, expect, it } from 'vitest'
import {
  clearPlumaMemory, forgetForPluma, loadPlumaMemory, MAX_PLUMA_NOTES, normalizePlumaNote,
  plumaMemoryPrompt, rememberForPluma, withoutPlumaNotes, withPlumaNote, type PlumaMemoryStorage,
} from '../pluma-memory'

function memoryStore(initial: string | null = null): PlumaMemoryStorage & { value: string | null } {
  return {
    value: initial,
    async read() { return this.value },
    async write(value) { this.value = value },
  }
}

describe('memoria de Pluma entre llamadas', () => {
  it('guarda, recuerda en la siguiente lectura y respeta el orden', async () => {
    const store = memoryStore()
    await rememberForPluma('Se llama Reinier', store)
    await rememberForPluma('  Prefiere   respuestas cortas ', store)
    expect(await loadPlumaMemory(store)).toEqual(['Se llama Reinier', 'Prefiere respuestas cortas'])
  })

  it('un dato que repite o amplía otro lo reemplaza en vez de duplicarlo', () => {
    let notes = withPlumaNote([], 'Le gusta el jazz')
    notes = withPlumaNote(notes, 'le gusta el JAZZ')
    expect(notes).toEqual(['le gusta el JAZZ'])
    notes = withPlumaNote(notes, 'Le gusta el jazz de los años 50')
    expect(notes).toEqual(['Le gusta el jazz de los años 50'])
  })

  it('no guarda secretos, números de tarjeta ni textos vacíos o enormes', () => {
    expect(normalizePlumaNote('Su contraseña es hola123')).toBeUndefined()
    expect(normalizePlumaNote('Tarjeta 4111 1111 1111 1111')).toBeUndefined()
    expect(normalizePlumaNote('  ')).toBeUndefined()
    expect(normalizePlumaNote('x'.repeat(201))).toBeUndefined()
    expect(normalizePlumaNote('- Escribe novela negra')).toBe('Escribe novela negra')
  })

  it('olvida lo que coincide con el tema pedido y nada más', async () => {
    const store = memoryStore(JSON.stringify({ notes: ['Le gusta el jazz', 'Vive en Madrid', 'Escribe poesía'] }))
    expect(await forgetForPluma('el jazz', store)).toEqual(['Vive en Madrid', 'Escribe poesía'])
    expect(withoutPlumaNotes(['Vive en Madrid'], 'de')).toEqual(['Vive en Madrid'])
    expect(await clearPlumaMemory(store)).toEqual([])
  })

  it('conserva solo las notas más recientes', () => {
    let notes: string[] = []
    for (let index = 0; index < MAX_PLUMA_NOTES + 5; index++) notes = withPlumaNote(notes, `Dato número ${index} sobre la persona`)
    expect(notes).toHaveLength(MAX_PLUMA_NOTES)
    expect(notes.at(-1)).toBe(`Dato número ${MAX_PLUMA_NOTES + 4} sobre la persona`)
  })

  it('tolera un almacén vacío, dañado o que falla', async () => {
    expect(await loadPlumaMemory(memoryStore('no es json'))).toEqual([])
    expect(await loadPlumaMemory({ read: async () => { throw new Error('sin disco') }, write: async () => {} })).toEqual([])
    expect(plumaMemoryPrompt([])).toBe('')
  })
})
