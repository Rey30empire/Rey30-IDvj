import { vi } from 'vitest'

vi.mock('@rey30-idvj/tauri-plugin-vector-db-api', () => ({
  getStatus: vi.fn(),
  createCollection: vi.fn().mockResolvedValue(undefined),
  insertChunks: vi.fn().mockResolvedValue(undefined),
  searchCollection: vi.fn().mockResolvedValue([]),
  deleteChunks: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  createFile: vi.fn(),
  listAttachments: vi.fn().mockResolvedValue([]),
  getChunks: vi.fn().mockResolvedValue([]),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  chunkText: vi.fn().mockResolvedValue([]),
}))

vi.mock('@rey30-idvj/tauri-plugin-rag-api', () => ({
  parseDocument: vi.fn().mockResolvedValue(''),
}))

// The embedding helpers are taken from the real module rather than stubbed:
// they are the shared implementation this extension delegates to, so stubbing
// them would leave the delegation untested on both sides.
vi.mock('@rey30-idvj/core', async () => {
  const actual = await vi.importActual<typeof import('@rey30-idvj/core')>('@rey30-idvj/core')
  return {
    VectorDBExtension: class {},
    embedTexts: actual.embedTexts,
    getEmbeddingEngine: actual.getEmbeddingEngine,
    isEmbeddingEngine: actual.isEmbeddingEngine,
  }
})

const getByName = vi.fn()

// `@rey30-idvj/core` reads `globalThis.core`; the extension code reads `window.core`.
// They are the same object in the browser, so both names point at one here.
const core = { extensionManager: { getByName } }

Object.defineProperty(globalThis, 'window', {
  value: { core },
  writable: true,
  configurable: true,
})

Object.defineProperty(globalThis, 'core', {
  value: core,
  writable: true,
  configurable: true,
})
