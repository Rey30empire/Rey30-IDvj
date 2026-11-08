import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fs } from '@rey30-idvj/core'
import Rey30AssistantExtension from './index'

// In-memory filesystem backing the mocked @rey30-idvj/core fs. Keys are the
// virtual paths the extension builds (joinPath joins with '/').
const ROOT = 'file://assistants'

let files: Map<string, string>
let dirs: Set<string>

function installFs() {
  files = new Map()
  dirs = new Set()

  vi.mocked(fs.existsSync).mockImplementation(async (p: string) =>
    dirs.has(p) || files.has(p)
  )
  vi.mocked(fs.mkdir).mockImplementation(async (p: string) => {
    dirs.add(p)
  })
  vi.mocked(fs.writeFileSync).mockImplementation(
    async (p: string, data: string) => {
      files.set(p, data)
    }
  )
  vi.mocked(fs.readFileSync).mockImplementation(async (p: string) => {
    if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
    return files.get(p) as string
  })
  vi.mocked(fs.rm).mockImplementation(async (p: string) => {
    files.delete(p)
  })
  vi.mocked(fs.readdirSync).mockImplementation(async (p: string) => {
    const prefix = `${p}/`
    const names = new Set<string>()
    const keys = Array.from(files.keys()).concat(Array.from(dirs))
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0])
      }
    }
    return Array.from(names)
  })
}

// The mocked base class ignores constructor args; the two positional args
// satisfy BaseExtension's real type signature under tsc.
function makeExt(): Rey30AssistantExtension {
  return new Rey30AssistantExtension('', '')
}

function seedAssistant(id: string, data: Record<string, unknown>) {
  dirs.add(ROOT)
  dirs.add(`${ROOT}/${id}`)
  files.set(`${ROOT}/${id}/assistant.json`, JSON.stringify(data))
}

function readAssistant(id: string): any {
  return JSON.parse(files.get(`${ROOT}/${id}/assistant.json`) as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  installFs()
})

describe('getAssistants', () => {
  it('returns the default assistant when the assistants dir does not exist', async () => {
    const ext = makeExt()
    const result = await ext.getAssistants()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rey30')
    expect(result[0].name).toBe('Rey30 IDvj')
  })

  it('falls back to the default assistant when the dir exists but is empty', async () => {
    dirs.add(ROOT)
    const ext = makeExt()
    const result = await ext.getAssistants()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rey30')
  })

  it('reads and parses stored assistants', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    seedAssistant('beta', { id: 'beta', name: 'Beta' })
    const ext = makeExt()
    const result = await ext.getAssistants()
    expect(result.map((a) => a.id).sort()).toEqual(['alpha', 'beta'])
  })

  it('skips directories without an assistant.json', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    dirs.add(`${ROOT}/orphan`)
    const ext = makeExt()
    const result = await ext.getAssistants()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('alpha')
  })

  it('skips assistants whose json fails to parse and keeps the valid ones', async () => {
    seedAssistant('alpha', { id: 'alpha', name: 'Alpha' })
    dirs.add(`${ROOT}/broken`)
    files.set(`${ROOT}/broken/assistant.json`, '{not valid json')
    const ext = makeExt()
    const result = await ext.getAssistants()
    expect(result.map((a) => a.id)).toEqual(['alpha'])
  })
})

describe('createAssistant', () => {
  it('creates the assistant folder and writes assistant.json', async () => {
    const ext = makeExt()
    await ext.createAssistant({ id: 'new', name: 'New' } as any)
    expect(dirs.has(`${ROOT}/new`)).toBe(true)
    expect(readAssistant('new')).toMatchObject({ id: 'new', name: 'New' })
  })

  it('does not recreate an existing folder but still writes the file', async () => {
    dirs.add(`${ROOT}/existing`)
    const ext = makeExt()
    await ext.createAssistant({ id: 'existing', name: 'X' } as any)
    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(readAssistant('existing')).toMatchObject({ id: 'existing' })
  })

  it('serializes the assistant as pretty-printed JSON', async () => {
    const ext = makeExt()
    await ext.createAssistant({ id: 'p', name: 'P' } as any)
    const raw = files.get(`${ROOT}/p/assistant.json`) as string
    expect(raw).toContain('\n  ')
  })
})

describe('deleteAssistant', () => {
  it('removes assistant.json when it exists', async () => {
    seedAssistant('gone', { id: 'gone' })
    const ext = makeExt()
    await ext.deleteAssistant({ id: 'gone' } as any)
    expect(files.has(`${ROOT}/gone/assistant.json`)).toBe(false)
  })

  it('is a no-op when the assistant does not exist', async () => {
    const ext = makeExt()
    await ext.deleteAssistant({ id: 'missing' } as any)
    expect(fs.rm).not.toHaveBeenCalled()
  })
})

describe('onLoad', () => {
  it('creates the assistants dir when missing', async () => {
    const ext = makeExt()
    await ext.onLoad()
    expect(fs.mkdir).toHaveBeenCalledWith(ROOT)
    expect(dirs.has(ROOT)).toBe(true)
  })

  it('seeds the default assistant with parameters when none are persisted', async () => {
    const ext = makeExt()
    await ext.onLoad()
    const seeded = readAssistant((ext as any).defaultAssistant.id)
    expect(seeded.id).toBe((ext as any).defaultAssistant.id)
    expect(seeded.parameters).toEqual({
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      repeat_penalty: 1.12,
    })
  })

  it('does not overwrite an existing persisted assistant on load', async () => {
    seedAssistant('rey30', { id: 'rey30', name: 'Custom', instructions: 'mine' })
    const ext = makeExt()
    await ext.onLoad()
    expect(readAssistant('rey30').name).toBe('Custom')
  })
})
