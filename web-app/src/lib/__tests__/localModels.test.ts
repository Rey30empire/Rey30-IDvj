import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/setup'
import {
  LocalModelError,
  describeLocalModelError,
  installedIdFor,
  isModelLoaded,
  loadLocalModel,
  suggestModelId,
  type LoadLocalModelDeps,
  type LocalModel,
} from '../localModels'

const model = (overrides: Partial<LocalModel> = {}): LocalModel => ({
  name: 'Qwen3.5-9B-Q4_K_M',
  fileName: 'model.gguf',
  path: 'C:\\Modelos IA Rey30\\Qwen3.5-9B-Q4_K_M\\model.gguf',
  folder: 'C:\\Modelos IA Rey30\\Qwen3.5-9B-Q4_K_M',
  sizeBytes: 6_000_000_000,
  shardCount: 1,
  projectorPath: null,
  installedModelId: null,
  ...overrides,
})

const provider = (
  models: Partial<Model>[] = [],
  overrides: Partial<ModelProvider> = {}
): ModelProvider =>
  ({
    provider: 'llamacpp',
    active: true,
    settings: [],
    models: models.map((m) => ({ id: 'x', ...m })) as Model[],
    ...overrides,
  }) as ModelProvider

function deps(after: ModelProvider, overrides: Partial<LoadLocalModelDeps> = {}) {
  return {
    allow: vi.fn(async (path: string) => ({
      path,
      projectorPath: 'C:\\m\\mmproj-f16.gguf',
    })),
    validate: vi.fn(async () => ({ isValid: true })),
    install: vi.fn(async () => undefined),
    refreshProvider: vi.fn(async () => after),
    start: vi.fn(async () => undefined),
    onStage: vi.fn(),
    ...overrides,
  }
}

describe('suggestModelId', () => {
  it('keeps only the characters llama.cpp ids allow', () => {
    expect(suggestModelId('Qwen3.5 9B (Q4_K_M).gguf', [])).toBe('Qwen3.5-9B-Q4_K_M')
    expect(suggestModelId('Modelo ñandú', [])).toBe('Modelo-nandu')
    expect(suggestModelId('***', [])).toBe('modelo-local')
  })

  it('adds a number when the id is taken, ignoring case like Windows folders', () => {
    expect(suggestModelId('phi-4', ['PHI-4'])).toBe('phi-4-2')
    expect(suggestModelId('phi-4', ['phi-4', 'phi-4-2'])).toBe('phi-4-3')
  })
})

describe('installed and loaded state', () => {
  it('maps the scanned id onto the provider id even with other slashes', () => {
    const found = model({ installedModelId: 'org/qwen' })
    expect(installedIdFor(found, provider([{ id: 'org\\qwen' }]))).toBe('org\\qwen')
    expect(installedIdFor(model(), provider([{ id: 'qwen' }]))).toBeUndefined()
  })

  it('tells loaded models apart', () => {
    expect(isModelLoaded('qwen', ['qwen'])).toBe(true)
    expect(isModelLoaded('org/qwen', ['org\\qwen'])).toBe(true)
    expect(isModelLoaded('qwen', ['phi'])).toBe(false)
    expect(isModelLoaded(undefined, ['qwen'])).toBe(false)
  })
})

describe('loadLocalModel', () => {
  it('registers a new file in place with its projector, then starts it', async () => {
    const after = provider([{ id: 'Qwen3.5-9B-Q4_K_M' }])
    const d = deps(after)

    const result = await loadLocalModel(model(), provider(), d)

    expect(d.allow).toHaveBeenCalledWith(model().path)
    expect(d.validate).toHaveBeenCalledWith(model().path)
    expect(d.install).toHaveBeenCalledWith(
      'Qwen3.5-9B-Q4_K_M',
      model().path,
      'C:\\m\\mmproj-f16.gguf'
    )
    expect(d.start).toHaveBeenCalledWith(after, 'Qwen3.5-9B-Q4_K_M')
    expect(d.onStage.mock.calls.map(([stage]) => stage)).toEqual(['preparing', 'loading'])
    expect(result).toEqual({ modelId: 'Qwen3.5-9B-Q4_K_M', installed: true, embedding: false })
  })

  it('starts an installed model without registering it again', async () => {
    const current = provider([{ id: 'qwen-local' }])
    const d = deps(current)

    const result = await loadLocalModel(
      model({ installedModelId: 'qwen-local' }),
      current,
      d
    )

    expect(d.allow).not.toHaveBeenCalled()
    expect(d.install).not.toHaveBeenCalled()
    expect(d.refreshProvider).not.toHaveBeenCalled()
    expect(d.start).toHaveBeenCalledWith(current, 'qwen-local')
    expect(result.installed).toBe(false)
  })

  it('re-reads the provider when an installed id is missing from the store', async () => {
    const fresh = provider([{ id: 'qwen-local' }])
    const d = deps(fresh)

    await loadLocalModel(model({ installedModelId: 'qwen-local' }), provider(), d)

    expect(d.refreshProvider).toHaveBeenCalledTimes(1)
    expect(d.install).not.toHaveBeenCalled()
    expect(d.start).toHaveBeenCalledWith(fresh, 'qwen-local')
  })

  it('does not load an embedding model', async () => {
    const after = provider([{ id: 'Qwen3.5-9B-Q4_K_M', embedding: true }])
    const d = deps(after)

    const result = await loadLocalModel(model(), provider(), d)

    expect(d.start).not.toHaveBeenCalled()
    expect(result.embedding).toBe(true)
  })

  it('picks the next name when a leftover folder already uses it', async () => {
    const after = provider([{ id: 'Qwen3.5-9B-Q4_K_M-2' }])
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error('Model Qwen3.5-9B-Q4_K_M already exists'))
      .mockResolvedValueOnce(undefined)
    const d = deps(after, { install })

    const result = await loadLocalModel(model(), provider(), d)

    expect(install.mock.calls.map(([id]) => id)).toEqual([
      'Qwen3.5-9B-Q4_K_M',
      'Qwen3.5-9B-Q4_K_M-2',
    ])
    expect(result.modelId).toBe('Qwen3.5-9B-Q4_K_M-2')
  })

  it('refuses a file the validator rejects, before registering it', async () => {
    const d = deps(provider(), {
      validate: vi.fn(async () => ({
        isValid: false,
        error: 'This model has CLIP architecture and cannot be imported',
      })),
    })

    const error = await loadLocalModel(model(), provider(), d).catch((e) => e)

    expect(error).toBeInstanceOf(LocalModelError)
    expect(d.install).not.toHaveBeenCalled()
    i18n.changeLanguage('es')
    expect(describeLocalModelError(error)).toBe(
      'Ese archivo es un proyector de visión, no un modelo para chatear.'
    )
  })

  it('stops when llama.cpp is turned off', async () => {
    const d = deps(provider())
    const error = await loadLocalModel(
      model(),
      provider([], { active: false }),
      d
    ).catch((e) => e)
    expect(error).toBeInstanceOf(LocalModelError)
    expect((error as LocalModelError).kind).toBe('providerDisabled')
    expect(d.allow).not.toHaveBeenCalled()
  })

  it('says so when the registered model does not show up', async () => {
    const d = deps(provider())
    const error = await loadLocalModel(model(), provider(), d).catch((e) => e)
    expect((error as LocalModelError).kind).toBe('notListed')
    expect(d.start).not.toHaveBeenCalled()
  })
})

describe('describeLocalModelError', () => {
  beforeEach(() => {
    i18n.changeLanguage('es')
  })

  it('explains the usual failures in plain Spanish', () => {
    expect(
      describeLocalModelError(
        new Error('fs_read_denied: C:\\x is outside the Rey30 IDvj data folder')
      )
    ).toBe(
      'La app no tiene permiso para leer ese archivo. Vuelve a buscar los modelos e inténtalo otra vez.'
    )
    expect(describeLocalModelError(new Error('File not found: C:\\x.gguf'))).toMatch(
      /^No se encontró el archivo/
    )
    expect(describeLocalModelError('CUDA error: out of memory')).toMatch(
      /^No hay memoria suficiente en la GPU/
    )
    expect(
      describeLocalModelError(new Error('The llama.cpp engine is not running. Please restart the app.'))
    ).toMatch(/^El motor local todavía no está listo/)
    expect(describeLocalModelError(new LocalModelError('providerDisabled'))).toMatch(
      /^El motor local \(llama\.cpp\) está desactivado/
    )
    expect(describeLocalModelError(undefined)).toBe('Algo salió mal y no se pudo terminar.')
  })

  it('uses the engine error codes the app already translates', () => {
    const engineError = { code: 'OUT_OF_MEMORY', message: 'oom' }
    expect(describeLocalModelError(engineError)).toBe(
      i18n.t('model-errors:engine.OUT_OF_MEMORY')
    )
  })

  it('passes on messages that are already Spanish and wraps the rest', () => {
    expect(
      describeLocalModelError(
        'Ese modelo no salió en la última búsqueda. Vuelve a buscar los modelos del PC.'
      )
    ).toBe('Ese modelo no salió en la última búsqueda. Vuelve a buscar los modelos del PC.')
    expect(
      describeLocalModelError('Busca los modelos del PC desde la ventana principal.')
    ).toBe('Busca los modelos del PC desde la ventana principal.')
    expect(describeLocalModelError(new Error('socket hang up'))).toBe(
      'No se pudo terminar. Detalle técnico: socket hang up'
    )
    expect(describeLocalModelError(new Error('No space left on device'))).toBe(
      'No se pudo terminar. Detalle técnico: No space left on device'
    )
    expect(
      describeLocalModelError(new LocalModelError('gpu', 'El motor local todavía no está listo.'))
    ).toBe('No se pudo cambiar de GPU: El motor local todavía no está listo.')
  })
})
