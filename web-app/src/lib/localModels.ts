/**
 * "Modelos del PC": the GGUF models the Rust side found on this computer
 * (`local_models_scan`), and loading one on the GPU in one step: grant the
 * file, register it in place in llama.cpp if it is not yet, then start it.
 */
import { i18n } from '@/i18n/react-i18next-compat'
import { parseEngineError, describeEngineError } from '@/lib/engineError'

/** One model found on disk, as `local_models_scan` returns it. */
export type LocalModel = {
  name: string
  fileName: string
  path: string
  folder: string
  sizeBytes: number
  shardCount: number
  projectorPath?: string | null
  installedModelId?: string | null
}

export type LocalModelScan = {
  models: LocalModel[]
  searchedFolders: string[]
  truncated: boolean
  elapsedMs: number
}

export type AllowedLocalModel = {
  path: string
  projectorPath?: string | null
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function scanLocalModels(invoke: Invoke): Promise<LocalModelScan> {
  return invoke<LocalModelScan>('local_models_scan')
}

export function allowLocalModel(
  invoke: Invoke,
  path: string
): Promise<AllowedLocalModel> {
  return invoke<AllowedLocalModel>('local_models_allow', { path })
}

/** Failures this flow names itself, each with a plain Spanish message. */
export type LocalModelErrorKind =
  | 'providerDisabled'
  | 'notListed'
  | 'invalidFile'
  /** Switching the GPU failed; the detail is already a sentence for the user. */
  | 'gpu'

export class LocalModelError extends Error {
  readonly kind: LocalModelErrorKind
  constructor(kind: LocalModelErrorKind, detail?: string) {
    super(detail ?? kind)
    this.kind = kind
  }
}

/** Model ids are folder names on disk; on Windows `\` and `/` both appear. */
export function normalizeModelId(id: string): string {
  return id.replace(/\\/g, '/')
}

export function sameModelId(a: string, b: string): boolean {
  return normalizeModelId(a) === normalizeModelId(b)
}

/**
 * A model id for a newly registered file: its name with only the characters
 * llama.cpp ids allow, and a number appended when another model already uses
 * it (compared ignoring case, as the Windows folder it becomes does).
 */
export function suggestModelId(name: string, takenIds: string[]): string {
  const base =
    name
      .replace(/\.gguf$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'modelo-local'
  const taken = new Set(takenIds.map((id) => normalizeModelId(id).toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** The id of the llama.cpp model that `model` is, if it is registered. */
export function installedIdFor(
  model: LocalModel,
  provider: ModelProvider | undefined
): string | undefined {
  const id = model.installedModelId
  if (!id) return undefined
  return provider?.models.find((entry) => sameModelId(entry.id, id))?.id ?? id
}

export function isModelLoaded(id: string | undefined, activeModels: string[]) {
  return Boolean(id) && activeModels.some((active) => sameModelId(active, id!))
}

export type LoadStage = 'preparing' | 'loading'

export interface LoadLocalModelDeps {
  /** Grants the files of a model the last scan found (`local_models_allow`). */
  allow: (path: string) => Promise<AllowedLocalModel>
  validate: (path: string) => Promise<{ isValid: boolean; error?: string }>
  /** Registers the file in place (the import dialog's `pullModel` path). */
  install: (id: string, path: string, projectorPath?: string) => Promise<void>
  /** Re-reads the llama.cpp provider after a model was registered. */
  refreshProvider: () => Promise<ModelProvider | undefined>
  start: (provider: ModelProvider, id: string) => Promise<unknown>
  onStage?: (stage: LoadStage) => void
}

export type LoadLocalModelResult = {
  modelId: string
  /** Registered now, rather than already installed before. */
  installed: boolean
  /** An embedding model: registered, but not loaded (it cannot chat). */
  embedding: boolean
}

/**
 * Loads a model found on the PC: registers it in llama.cpp in place first
 * when it is not yet (the file stays where it is), then starts it.
 */
export async function loadLocalModel(
  model: LocalModel,
  provider: ModelProvider | undefined,
  deps: LoadLocalModelDeps
): Promise<LoadLocalModelResult> {
  if (!provider || provider.active === false) {
    throw new LocalModelError('providerDisabled')
  }

  let modelId = installedIdFor(model, provider)
  let installed = false
  let current: ModelProvider | undefined = provider

  if (modelId && !current.models.some((entry) => entry.id === modelId)) {
    current = await deps.refreshProvider()
    modelId = installedIdFor(model, current)
  }

  if (!modelId) {
    deps.onStage?.('preparing')
    const allowed = await deps.allow(model.path)
    const validation = await deps.validate(allowed.path)
    if (!validation.isValid) {
      throw new LocalModelError('invalidFile', validation.error)
    }
    const taken = current?.models.map((entry) => entry.id) ?? []
    // A folder left behind by an earlier, unfinished install also takes a
    // name; try the next one instead of failing.
    for (let attempt = 0; ; attempt++) {
      const id = suggestModelId(model.name, taken)
      try {
        await deps.install(id, allowed.path, allowed.projectorPath ?? undefined)
        modelId = id
        break
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (attempt >= 3 || !/already exists/i.test(text)) throw error
        taken.push(id)
      }
    }
    installed = true
    current = await deps.refreshProvider()
  }

  const entry = current?.models.find((item) => item.id === modelId)
  if (!current || !entry) throw new LocalModelError('notListed')
  if (current.active === false) throw new LocalModelError('providerDisabled')
  if (entry.embedding) {
    return { modelId: entry.id, installed, embedding: true }
  }

  deps.onStage?.('loading')
  await deps.start(current, entry.id)
  return { modelId: entry.id, installed, embedding: false }
}

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`providers:localModels.${key}`, options)

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/** A plain Spanish sentence for anything that went wrong in this flow. */
export function describeLocalModelError(error: unknown): string {
  if (error instanceof LocalModelError) {
    if (error.kind === 'gpu') return t('errors.gpu', { detail: error.message })
    if (error.kind === 'invalidFile') {
      return /clip/i.test(error.message)
        ? t('errors.projector')
        : t('errors.invalidFile')
    }
    return t(`errors.${error.kind}`)
  }
  if (parseEngineError(error)) return describeEngineError(error)

  const text = messageOf(error).trim()
  if (!text) return t('errors.unknown')
  if (/fs_read_denied/i.test(text)) return t('errors.denied')
  if (/file not found|no such file|cannot find the file|not found:/i.test(text))
    return t('errors.notFound')
  if (/clip architecture/i.test(text)) return t('errors.projector')
  if (/invalid gguf|failed to read model metadata|not a valid gguf/i.test(text))
    return t('errors.invalidFile')
  if (/already exists/i.test(text)) return t('errors.exists')
  if (/out of memory|\boom\b|cudaMalloc|failed to allocate/i.test(text))
    return t('errors.outOfMemory')
  if (/engine is not running|engine.*not.*(ready|available)|motor local no está disponible/i.test(text))
    return t('errors.engine')
  if (/no active session/i.test(text)) return t('errors.notLoaded')
  // The Rust commands of this feature already answer in Spanish.
  if (looksSpanish(text)) return text
  return t('errors.generic', { detail: text })
}

function looksSpanish(text: string): boolean {
  return (
    /[áéíóúñ¿¡]/i.test(text) ||
    /\b(de|del|los|las|que|desde|para|ese|esa|ya|no se)\b/i.test(text)
  )
}
