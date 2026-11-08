import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'

// Mock the services
vi.mock('@/services/assistants', () => ({
  createAssistant: vi.fn(() => Promise.resolve()),
  deleteAssistant: vi.fn(() => Promise.resolve()),
}))

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store to default state
    act(() => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
        loading: true,
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.assistants).toEqual([defaultAssistant])
    expect(result.current.currentAssistant).toEqual(defaultAssistant)
  })

  it('renames only the legacy default assistant and retains its model and custom instructions', () => {
    const legacy = {
      ...defaultAssistant,
      name: 'Jan',
      model: { id: 'Jan-v3.5-4B-Q4_K_XL', engine: 'llamacpp' },
      instructions: 'Keep my custom instructions.',
      description: 'My saved description.',
    }
    const custom = { ...defaultAssistant, id: 'custom', name: 'My assistant' }
    act(() => useAssistant.getState().setAssistants([legacy, custom]))

    const restored = useAssistant.getState().assistants
    expect(restored[0]).toEqual({ ...legacy, name: 'Rey30 IDvj' })
    expect(restored[1]).toEqual(custom)
  })

  it('should add assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Assistant',
      avatar: '🤖',
      description: 'A new assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    await act(async () => {
      await result.current.addAssistant(newAssistant)
    })

    expect(result.current.assistants).toHaveLength(2)
    expect(result.current.assistants).toContain(newAssistant)
  })

  it.each(
    ['Jan', 'Rey30 IDvj'].flatMap((legacyName) =>
      ["'", '\u2019'].map((apostrophe) => ({ legacyName, apostrophe }))
    )
  )(
    'migrates only the exact $legacyName default description with apostrophe $apostrophe while keeping custom instructions and parameters',
    ({ legacyName, apostrophe }) => {
      const legacy = {
        ...defaultAssistant,
        name: legacyName,
        avatar: '👋',
        description: `${legacyName} is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user${apostrophe}s behalf.`,
        instructions: 'Instrucciones propias que deben conservarse.',
        parameters: { temperature: 0.37 },
        model: { id: 'owned-model', engine: 'llamacpp' },
      }
      act(() => useAssistant.getState().setAssistants([legacy]))
      expect(useAssistant.getState().assistants[0]).toEqual({
        ...legacy,
        name: defaultAssistant.name,
        avatar: '/images/rey30-idvj.svg',
        description: defaultAssistant.description,
      })
    }
  )

  it('preserves a customized Jan avatar/description and leaves other assistants unchanged', () => {
    const custom = {
      ...defaultAssistant,
      name: 'Mi asistente',
      avatar: '/images/owned.svg',
      description:
        'Rey30 IDvj is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\u2019s behalf. Mi descripción personalizada.',
    }
    const other = {
      ...custom,
      id: 'owned-assistant',
      name: 'Jan',
      avatar: '👋',
    }
    act(() => useAssistant.getState().setAssistants([custom, other]))
    expect(useAssistant.getState().assistants).toEqual([custom, other])
  })

  it('should update assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const updatedAssistant = {
      ...defaultAssistant,
      name: 'Updated Rey30 IDvj',
      description: 'Updated description',
    }

    await act(async () => {
      await result.current.updateAssistant(updatedAssistant)
    })

    expect(result.current.assistants[0].name).toBe('Updated Rey30 IDvj')
    expect(result.current.assistants[0].description).toBe('Updated description')
  })

  it('should delete assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const assistant2 = {
      id: 'assistant-2',
      name: 'Assistant 2',
      avatar: '🤖',
      description: 'Second assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    await act(async () => {
      await result.current.addAssistant(assistant2)
    })

    expect(result.current.assistants).toHaveLength(2)

    await act(async () => {
      result.current.deleteAssistant('assistant-2')
    })

    expect(result.current.assistants).toHaveLength(1)
    expect(result.current.assistants[0].id).toBe('jan')
  })

  it('should set current assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Current Assistant',
      avatar: '🤖',
      description: 'New current assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.setCurrentAssistant(newAssistant)
    })

    expect(result.current.currentAssistant).toEqual(newAssistant)
  })

  it('should set assistants', () => {
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      {
        id: 'assistant-1',
        name: 'Assistant 1',
        avatar: '🤖',
        description: 'First assistant',
        instructions: 'Help the user',
        created_at: Date.now(),
        parameters: {},
      },
      {
        id: 'assistant-2',
        name: 'Assistant 2',
        avatar: '🔧',
        description: 'Second assistant',
        instructions: 'Help with tasks',
        created_at: Date.now(),
        parameters: {},
      },
    ]

    expect(result.current.loading).toBe(true)

    act(() => {
      result.current.setAssistants(assistants)
    })

    expect(result.current.loading).toBe(false)

    expect(result.current.assistants).toEqual(assistants)
    expect(result.current.assistants).toHaveLength(2)
  })

  it('should maintain assistant structure', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.currentAssistant.id).toBe('jan')
    expect(result.current.currentAssistant.name).toBe('Rey30 IDvj')
    expect(result.current.currentAssistant.avatar).toBe(
      '/images/rey30-idvj.svg'
    )
    expect(result.current.currentAssistant.instructions).toContain(
      'Before engaging any tools, articulate your complete thought process in natural language'
    )
    expect(typeof result.current.currentAssistant.created_at).toBe('number')
    expect(typeof result.current.currentAssistant.parameters).toBe('object')
  })

  it('should handle empty assistants list', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([])
    })

    expect(result.current.assistants).toEqual([])
  })

  it('should update assistant in current assistant if it matches', async () => {
    const { result } = renderHook(() => useAssistant())

    const updatedDefaultAssistant = {
      ...defaultAssistant,
      name: 'Updated Rey30 IDvj Name',
    }

    await act(async () => {
      await result.current.updateAssistant(updatedDefaultAssistant)
    })

    expect(result.current.currentAssistant.name).toBe('Updated Rey30 IDvj Name')
  })
})
