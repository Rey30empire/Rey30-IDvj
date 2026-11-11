import { beforeEach, describe, expect, it, vi } from 'vitest'

const hub = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: hub.invoke }) }) }))

import { usePlumaReading } from '@/stores/usePlumaReading'
import { loadPlumaBook, openPlumaBook, plumaReader, plumaReadingChunks, readingPercent } from '../pluma-reading'

beforeEach(() => {
  vi.clearAllMocks()
  usePlumaReading.setState({ book: null, positions: {} })
})

describe('textos para el modo lectura', () => {
  it('lee párrafos completos, une las líneas cortadas del PDF y salta los números de página', () => {
    const chunks = plumaReadingChunks([{ title: 'Uno', text: 'Era una no-\nche oscura\ny fría.\n\n  12  \n\nLlovía.' }])
    expect(chunks).toEqual(['Era una noche oscura y fría.', 'Llovía.'])
  })

  it('agrupa frases sin pasar del límite y nunca mezcla archivos distintos', () => {
    const sentence = 'Una frase corta.'
    const chunks = plumaReadingChunks([{ title: 'a', text: Array(10).fill(sentence).join(' ') }, { title: 'b', text: 'Otro archivo.' }], 40)
    expect(chunks.every(chunk => chunk.length <= 40)).toBe(true)
    expect(chunks.at(-1)).toBe('Otro archivo.')
    expect(chunks.slice(0, -1).join(' ')).toBe(Array(10).fill(sentence).join(' '))
  })

  it('corta una frase enorme por las comas o entre palabras', () => {
    const long = `${'palabra, '.repeat(80)}fin.`
    const chunks = plumaReadingChunks([{ title: 'a', text: long }], 60)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every(chunk => chunk.length <= 60)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.trim())
  })

  it('calcula el avance sin pasarse de los límites', () => {
    expect(readingPercent(0, 0)).toBe(0)
    expect(readingPercent(5, 10)).toBe(50)
    expect(readingPercent(20, 10)).toBe(100)
  })
})

describe('libro del modo lectura', () => {
  const book = { title: 'Rayuela', sections: [{ title: 'Rayuela', text: 'Uno.\n\nDos.\n\nTres.' }] }

  it('abre el libro, recuerda dónde quedó y no vuelve a leer el archivo para seguir', async () => {
    hub.invoke.mockResolvedValue(book)
    await openPlumaBook('  C:\\Libros\\Rayuela.pdf ')
    expect(hub.invoke).toHaveBeenCalledWith('pluma_reading_open', { path: 'C:\\Libros\\Rayuela.pdf' })
    expect(usePlumaReading.getState().book).toEqual({ path: 'C:\\Libros\\Rayuela.pdf', title: 'Rayuela', total: 3 })
    expect(plumaReader.current()).toEqual({ title: 'Rayuela', percent: 0 })
    plumaReader.save(2, 3)
    expect(plumaReader.position()).toBe(2)
    expect(plumaReader.current()).toEqual({ title: 'Rayuela', percent: 67 })
    await expect(plumaReader.load()).resolves.toEqual({ title: 'Rayuela', chunks: ['Uno.', 'Dos.', 'Tres.'] })
    expect(hub.invoke).toHaveBeenCalledTimes(1)
  })

  it('una ruta que no se puede leer no reemplaza el libro cargado', async () => {
    hub.invoke.mockResolvedValueOnce(book).mockRejectedValueOnce(new Error('No encontré ese archivo o carpeta.'))
    await openPlumaBook('C:\\Libros\\Rayuela.pdf')
    await expect(openPlumaBook('C:\\no-existe')).rejects.toThrow('No encontré ese archivo o carpeta.')
    expect(usePlumaReading.getState().book?.title).toBe('Rayuela')
  })

  it('rechaza un archivo sin palabras', async () => {
    hub.invoke.mockResolvedValue({ title: 'Vacío', sections: [{ title: 'Vacío', text: '1\n\n2' }] })
    await expect(loadPlumaBook('C:\\vacio.txt', true)).rejects.toThrow('No encontré texto')
  })

  it('sin libro no ofrece nada que leer', async () => {
    expect(plumaReader.current()).toBeUndefined()
    expect(plumaReader.position()).toBe(0)
    await expect(plumaReader.load()).rejects.toThrow('No hay ningún libro')
  })
})
