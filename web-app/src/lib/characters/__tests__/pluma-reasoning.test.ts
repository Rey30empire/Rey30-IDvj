import { beforeEach, describe, expect, it, vi } from 'vitest'
import { answerWithPluma } from '../pluma-reasoning'

const fixtures = vi.hoisted(() => ({
  getProviderByName: vi.fn<(providerName: string) => ModelProvider | undefined>(),
  literaryLibraryContext: vi.fn<(query: string) => Promise<string | undefined>>(),
  createModel: vi.fn(),
  generateText: vi.fn(),
}))

vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => fixtures } }))
vi.mock('@/lib/literaryLibrary', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/literaryLibrary')>()),
  literaryLibraryContext: fixtures.literaryLibraryContext,
}))
vi.mock('@/lib/model-factory', () => ({ ModelFactory: { createModel: fixtures.createModel } }))
vi.mock('ai', () => ({ generateText: fixtures.generateText }))

const jan = 'Jan-v3.5-4B-Q4_K_XL'
const sessionId = 'pluma-realtime-fixture'
const localProvider = {
  provider: 'llamacpp', active: true, settings: [],
  models: [{ id: 'Jan-v3.5-4B-Q8_0' }, { id: jan }, { id: 'otro-modelo' }],
} satisfies ModelProvider

describe('razonamiento de Pluma por voz', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fixtures.getProviderByName.mockReturnValue(localProvider)
    fixtures.literaryLibraryContext.mockResolvedValue('Fuente: poemas/lluvia.md. Fragmento: cae la lluvia.')
    fixtures.createModel.mockResolvedValue('motor local')
    fixtures.generateText.mockResolvedValue({ text: '  La lluvia marca el ritmo del poema.  ' })
  })

  it('usa Jan nativo con los fragmentos locales y devuelve solo la respuesta visible', async () => {
    const signal = new AbortController().signal
    await expect(answerWithPluma(' Analiza el poema de la lluvia. ', sessionId, signal)).resolves.toBe('La lluvia marca el ritmo del poema.')
    expect(fixtures.getProviderByName).toHaveBeenCalledWith('llamacpp')
    expect(fixtures.literaryLibraryContext).toHaveBeenCalledWith('Analiza el poema de la lluvia.', { kind: 'realtime', sessionId })
    expect(fixtures.createModel).toHaveBeenCalledWith(jan, localProvider, expect.objectContaining({ thread_id: 'background:pluma-voz' }), true)
    expect(fixtures.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'motor local', system: expect.stringContaining('poemas/lluvia.md'),
      prompt: 'Analiza el poema de la lluvia.', abortSignal: signal,
    }))
    expect(fixtures.generateText.mock.calls[0]?.[0]).not.toHaveProperty('tools')
  })

  it.each([
    { ...localProvider, provider: 'openai' },
    { ...localProvider, active: false },
    { ...localProvider, models: [{ id: jan, embedding: true }] },
    { ...localProvider, models: [{ id: 'otro-modelo' }] },
  ])('rechaza proveedores remotos o modelos no aptos sin abrir la biblioteca', async provider => {
    fixtures.getProviderByName.mockReturnValue(provider)
    await expect(answerWithPluma('Lee un poema.', sessionId)).rejects.toThrow()
    expect(fixtures.literaryLibraryContext).not.toHaveBeenCalled()
    expect(fixtures.createModel).not.toHaveBeenCalled()
  })

  it('interrumpe el turno tras la búsqueda si se cierra la llamada', async () => {
    const controller = new AbortController()
    fixtures.literaryLibraryContext.mockImplementation(async () => {
      controller.abort()
      return 'resultado de una llamada cerrada'
    })
    await expect(answerWithPluma('Lee un poema.', sessionId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixtures.createModel).not.toHaveBeenCalled()
  })
})
