import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'

const h = vi.hoisted(() => ({
  native: true,
  saved: null as string | null,
  read: vi.fn(),
  invoke: vi.fn(),
  validate: vi.fn(),
  error: vi.fn(),
  running: {} as Record<string, string>,
  modelState: {
    selectedProvider: '',
    selectedModel: null as { id: string } | null,
    providers: [] as Array<{ provider: string; active: boolean; models: Array<{ id: string; capabilities: string[] }> }>,
  },
}))

vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => h.native }))
vi.mock('@/lib/agentTools', () => ({ validateCoworkFolder: h.validate }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => h.modelState } }))
vi.mock('sonner', () => ({ toast: { error: h.error } }))
vi.mock('../useCoworkRun', () => ({ useCoworkRun: { getState: () => ({ runId: h.running }) } }))
vi.mock('@/lib/backendStorage', () => ({ backendStorage: {
  getItem: h.read,
  setItem: async (_name: string, value: string) => { h.saved = value },
  removeItem: async () => { h.saved = null },
} }))

import { useCoworkFolderPicker } from '../useCoworkFolderPicker'
import { useCoworkSessions } from '../useCoworkSessions'

const rawFolder = 'c:/projects/project-qa'
const canonicalFolder = 'C:\\Projects\\Project-QA'
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TranslationContext.Provider value={{ t: i18n.t, i18n }}>{children}</TranslationContext.Provider>
)
const mount = (opened = vi.fn()) => renderHook(() => useCoworkFolderPicker(opened), { wrapper })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.native = true
  h.running = {}
  h.modelState = { selectedProvider: '', selectedModel: null, providers: [] }
  useCoworkSessions.setState({ sessions: [], currentId: null })
  h.saved = null
  h.read.mockImplementation(async () => h.saved)
  h.invoke.mockResolvedValue(rawFolder)
  h.validate.mockResolvedValue(canonicalFolder)
  i18n.changeLanguage('es')
  await useCoworkSessions.persist.rehydrate()
})

describe('selector compartido de carpeta con sesión persistida', () => {
  it('rechaza una ruta guardada que ahora corresponde a otra carpeta', async () => {
    const opened = vi.fn()
    const view = mount(opened)
    const saved = 'C:\\Projects\\Ruta previa'
    await act(() => view.result.current.openFolder(saved))
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.validate).toHaveBeenCalledWith(saved)
    expect(h.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ description: expect.stringContaining('otra carpeta') }))
    expect(opened).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState().sessions).toEqual([])
  })

  it('treats cancellation as no change and leaves navigation alone', async () => {
    h.invoke.mockResolvedValue(null)
    const opened = vi.fn()
    const view = mount(opened)
    await act(() => view.result.current.openFolder())
    expect(h.invoke).toHaveBeenCalledWith('open_dialog', { options: { directory: true, multiple: false } })
    expect(h.validate).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(h.error).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState()).toMatchObject({ currentId: null, sessions: [] })
  })

  it('blocks duplicate pickers across views, stores the canonical folder, and rehydrates the empty session', async () => {
    const model = { provider: 'local-qa', id: 'selected-qa' }
    h.modelState = {
      selectedProvider: model.provider,
      selectedModel: { id: model.id },
      providers: [{ provider: model.provider, active: true, models: [{ id: model.id, capabilities: ['tools'] }] }],
    }
    const pick = deferred<string>()
    h.invoke.mockReturnValue(pick.promise)
    const opened = vi.fn()
    const first = mount(opened)
    const second = mount()
    let opening: Promise<void>
    act(() => { opening = first.result.current.openFolder() })
    expect(first.result.current.picking).toBe(true)
    expect(second.result.current.picking).toBe(true)
    await act(() => second.result.current.openFolder())
    await act(async () => { pick.resolve(rawFolder); await opening! })
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.validate).toHaveBeenCalledExactlyOnceWith(rawFolder)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(first.result.current.picking).toBe(false)
    const id = useCoworkSessions.getState().currentId
    expect(id).toBeTruthy()
    expect(useCoworkSessions.getState().sessions).toEqual([expect.objectContaining({ id, folder: canonicalFolder, model, turns: [], messages: [] })])
    const saved = h.saved
    useCoworkSessions.setState({ sessions: [], currentId: null })
    h.saved = saved
    await useCoworkSessions.persist.rehydrate()
    expect(useCoworkSessions.getState()).toMatchObject({ currentId: id, sessions: [{ id, folder: canonicalFolder, model }] })
  })

  it.each([
    { active: false, capabilities: ['tools'] },
    { active: true, capabilities: [] },
  ])('leaves an ineligible model unbound without choosing an alternate provider', async ({ active, capabilities }) => {
    h.modelState = {
      selectedProvider: 'selected-provider',
      selectedModel: { id: 'selected-model' },
      providers: [
        { provider: 'selected-provider', active, models: [{ id: 'selected-model', capabilities }] },
        { provider: 'other-provider', active: true, models: [{ id: 'other-model', capabilities: ['tools'] }] },
      ],
    }
    const view = mount()
    await act(() => view.result.current.openFolder())
    expect(useCoworkSessions.getState().sessions[0]).toMatchObject({ folder: canonicalFolder })
    expect(useCoworkSessions.getState().sessions[0].model).toBeUndefined()
  })

  it('shows actionable picker errors and keeps the prior session', async () => {
    const prior = useCoworkSessions.getState().openFolder('C:\\Projects\\Prior', [])
    h.invoke.mockRejectedValue(new Error('native dialog failed'))
    const opened = vi.fn()
    const view = mount(opened)
    await act(() => view.result.current.openFolder())
    expect(h.error).toHaveBeenCalledWith('No se pudo abrir la carpeta de trabajo', { description: 'No se pudo mostrar el selector. Vuelve a pulsar Abrir carpeta.' })
    expect(opened).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState()).toMatchObject({ currentId: prior, sessions: [{ id: prior, folder: 'C:\\Projects\\Prior' }] })
  })

  it('retains the prior folder when native validation rejects the selection', async () => {
    const prior = useCoworkSessions.getState().openFolder('C:\\Projects\\Prior', [])
    h.validate.mockRejectedValue('Elige una carpeta local existente.')
    const view = mount()
    await act(() => view.result.current.openFolder())
    expect(h.error).toHaveBeenCalledWith('No se pudo abrir la carpeta de trabajo', { description: 'Elige una carpeta local existente.' })
    expect(useCoworkSessions.getState()).toMatchObject({ currentId: prior, sessions: [{ id: prior, folder: 'C:\\Projects\\Prior' }] })
  })

  it('waits for session hydration before opening and before committing a selection', async () => {
    const pick = deferred<string>()
    const read = deferred<string | null>()
    h.invoke.mockReturnValue(pick.promise)
    const opened = vi.fn()
    const view = mount(opened)
    let opening: Promise<void>
    act(() => { opening = view.result.current.openFolder() })
    h.read.mockReturnValueOnce(read.promise)
    const rehydration = useCoworkSessions.persist.rehydrate()
    expect(useCoworkSessions.persist.hasHydrated()).toBe(false)
    await act(async () => { pick.resolve(rawFolder); await opening! })
    await act(() => view.result.current.openFolder())
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.error).toHaveBeenCalledTimes(2)
    expect(opened).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState().sessions).toEqual([])
    read.resolve(null)
    await rehydration
  })

  it('keeps an occupied folder session and explains how to follow it', async () => {
    const id = useCoworkSessions.getState().openFolder(canonicalFolder, [])!
    h.running = { [id]: 'run-in-progress' }
    const opened = vi.fn()
    const view = mount(opened)
    await act(() => view.result.current.openFolder())
    expect(h.error).toHaveBeenCalledWith('No se pudo abrir la carpeta de trabajo', { description: expect.stringContaining('sesión en curso') })
    expect(opened).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
    expect(useCoworkSessions.getState().currentId).toBe(id)
  })

  it('discards a late selection after leaving the view and releases the picker', async () => {
    const pick = deferred<string>()
    h.invoke.mockReturnValue(pick.promise)
    const opened = vi.fn()
    const view = mount(opened)
    let opening: Promise<void>
    act(() => { opening = view.result.current.openFolder() })
    view.unmount()
    await act(async () => { pick.resolve(rawFolder); await opening! })
    expect(h.validate).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(useCoworkSessions.getState().sessions).toEqual([])
    const next = mount()
    await waitFor(() => expect(next.result.current.picking).toBe(false))
  })

  it('requires the desktop bridge before invoking a local folder picker', async () => {
    h.native = false
    const view = mount()
    expect(view.result.current.available).toBe(false)
    await act(() => view.result.current.openFolder())
    expect(h.invoke).not.toHaveBeenCalled()
  })
})
