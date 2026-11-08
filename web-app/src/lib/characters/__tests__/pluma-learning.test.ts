import { describe, expect, it } from 'vitest'
import { forgetPlumaNote, plumaMemoryPrompt, PLUMA_NOTES_PER_PROMPT, selectPlumaMemory, type PlumaMemoryStorage } from '../pluma-memory'
import { plumaMusicTasteStyle } from '../pluma-gemma'

function memoryStore(notes: string[]): PlumaMemoryStorage & { value: string | null } {
  return {
    value: JSON.stringify({ notes }),
    async read() { return this.value },
    async write(value) { this.value = value },
  }
}

describe('aprendizaje de Plumita', () => {
  const filler = Array.from({ length: 60 }, (_, index) => `Comentó el tema número ${index}`)

  it('siempre recuerda nombre, correcciones y gustos aunque haya muchas notas', () => {
    const notes = ['Se llama Reinier', 'Corrección: 5 + 5 es 10', ...filler, 'Gusto musical: bachata romántica']
    const selected = selectPlumaMemory(notes, 'hola')
    expect(selected).toHaveLength(PLUMA_NOTES_PER_PROMPT)
    expect(selected).toEqual(expect.arrayContaining(['Se llama Reinier', 'Corrección: 5 + 5 es 10', 'Gusto musical: bachata romántica']))
  })

  it('trae las notas del tema de la conversación antes que las antiguas sin relación', () => {
    const notes = ['Le encantan las novelas de Dostoievski', ...filler]
    expect(selectPlumaMemory(notes, 'háblame de novelas rusas')).toContain('Le encantan las novelas de Dostoievski')
    expect(selectPlumaMemory(notes, 'qué tal el clima')).not.toContain('Le encantan las novelas de Dostoievski')
  })

  it('pide aplicar las correcciones guardadas', () => {
    expect(plumaMemoryPrompt(['Corrección: 5 + 5 es 10'])).toContain('Las correcciones guardadas mandan')
    expect(plumaMemoryPrompt([])).toBe('')
  })

  it('olvida exactamente la nota elegida en ajustes', async () => {
    const store = memoryStore(['Le gusta el jazz', 'Le gusta el jazz de los 50'])
    expect(await forgetPlumaNote('Le gusta el jazz', store)).toEqual(['Le gusta el jazz de los 50'])
  })

  it('canta en el estilo musical que la persona dijo que le gusta', () => {
    expect(plumaMusicTasteStyle(['Gusto musical: rock', 'Gusto musical: bachata romántica con guitarra'])).toBe('Spanish female vocals, bachata romántica con guitarra')
    expect(plumaMusicTasteStyle(['Se llama Reinier'])).toBeUndefined()
  })
})
