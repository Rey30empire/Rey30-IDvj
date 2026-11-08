import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ assistants: () => ({ createAssistant: h.create }) }) }))
import { useAssistant, defaultAssistant } from '../useAssistant'

describe('assistant creation persists before becoming visible', () => {
  beforeEach(() => {
    h.create.mockReset().mockResolvedValue(undefined)
    useAssistant.setState({ assistants: [defaultAssistant], currentAssistant: defaultAssistant })
  })
  const draft = () => ({ ...defaultAssistant, id: 'fixture-copy', name: 'Copia de revisión' })
  it('keeps the existing assistant and list intact when saving fails', async () => {
    h.create.mockRejectedValueOnce(new Error('fixture disk failure'))
    await expect(useAssistant.getState().addAssistant(draft())).rejects.toThrow('fixture disk failure')
    expect(useAssistant.getState().assistants).toEqual([defaultAssistant])
  })
  it('rejects a conflicting ID before reaching the persistence service', async () => {
    await expect(useAssistant.getState().addAssistant({ ...defaultAssistant, name: 'No reemplazar' })).rejects.toThrow('ya existe')
    expect(h.create).not.toHaveBeenCalled()
    expect(useAssistant.getState().assistants[0]).toEqual(defaultAssistant)
  })
  it('reserves an ID while a create operation is still pending', async () => {
    let finish!: () => void
    h.create.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const first = useAssistant.getState().addAssistant(draft())
    expect(useAssistant.getState().assistants).toHaveLength(1)
    await expect(useAssistant.getState().addAssistant(draft())).rejects.toThrow('ya existe')
    expect(h.create).toHaveBeenCalledTimes(1)
    finish()
    await first
    expect(useAssistant.getState().assistants).toHaveLength(2)
  })

})
