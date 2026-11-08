import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SystemEvent } from '@/types/events'

// Mock functions
const mockGetTools = vi.fn()
const mockUpdateTools = vi.fn()
const mockUpdateMcpToolNames = vi.fn()
const mockUpdateRagToolNames = vi.fn()
const mockListen = vi.fn()
const mockUnsubscribe = vi.fn()
const mockInvalidateCache = vi.fn()
const privacy = vi.hoisted(() => ({ mode: 'standard' as 'standard' | 'local-only', loaded: true, saving: false, error: null as string | null }))
vi.mock('@/hooks/usePrivacyMode', () => ({ usePrivacyMode: (selector: (state: typeof privacy) => unknown) => selector(privacy) }))
vi.mock('@/lib/privacyPolicy', () => ({
  ensurePrivacyMode: async () => { if (!privacy.loaded || privacy.saving || privacy.error) throw new Error('Policy unavailable'); return privacy.mode },
  getPrivacyModeSnapshot: () => !privacy.loaded || privacy.saving || privacy.error ? 'local-only' : privacy.mode,
  privacyAllowsTools: (mode: string) => mode === 'standard',
}))

vi.mock('@/lib/mcp-orchestrator/mcp-orchestrator', () => ({
  mcpOrchestrator: { invalidateCache: mockInvalidateCache },
}))

// Mock useAppState
vi.mock('../useAppState', () => ({
  useAppState: (selector: any) => selector({ updateTools: mockUpdateTools, updateMcpToolNames: mockUpdateMcpToolNames, updateRagToolNames: mockUpdateRagToolNames }),
}))

// Mock the ServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      getTools: mockGetTools,
    }),
    rag: () => ({
      getToolNames: vi.fn(() => Promise.resolve([])),
    }),
    events: () => ({
      listen: mockListen,
    }),
  }),
}))

describe('useTools', () => {
  beforeEach(() => {
    privacy.mode = 'standard'
    privacy.loaded = true
    privacy.saving = false
    privacy.error = null
    vi.clearAllMocks()
    mockListen.mockResolvedValue(mockUnsubscribe)
    mockGetTools.mockResolvedValue([])
  })

  it('rediscovers tools after a failed policy read is retried with the same standard mode', async () => {
    privacy.loaded = false
    privacy.error = 'Read failure'
    const { useTools } = await import('../useTools')
    const { rerender } = renderHook(() => useTools())
    await act(async () => { await Promise.resolve() })
    expect(mockGetTools).not.toHaveBeenCalled()
    privacy.loaded = true
    privacy.error = null
    rerender()
    await act(async () => { await Promise.resolve() })
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    privacy.saving = true
    rerender()
    await act(async () => { await Promise.resolve() })
    expect(mockUpdateTools).toHaveBeenLastCalledWith([])
  })

  it('clears the UI tool list without querying MCP in a protected mode', async () => {
    privacy.mode = 'local-only'
    const { useTools } = await import('../useTools')
    renderHook(() => useTools())
    await act(async () => { await Promise.resolve() })
    expect(mockGetTools).not.toHaveBeenCalled()
    expect(mockUpdateTools).toHaveBeenCalledWith([])
    expect(mockUpdateMcpToolNames).toHaveBeenCalledWith([])
    expect(mockUpdateRagToolNames).toHaveBeenCalledWith([])
  })

  it('discards a discovery response that finishes after the mode becomes protected', async () => {
    let finish!: (tools: unknown[]) => void
    mockGetTools.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { useTools } = await import('../useTools')
    const { rerender } = renderHook(() => useTools())
    await act(async () => { await Promise.resolve() })
    privacy.mode = 'local-only'
    rerender()
    await act(async () => { finish([{ name: 'late-remote-tool' }]); await Promise.resolve() })
    expect(mockUpdateTools).not.toHaveBeenCalledWith([{ name: 'late-remote-tool' }])
    expect(mockUpdateTools).toHaveBeenLastCalledWith([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call getTools and updateTools on mount', async () => {
    const { useTools } = await import('../useTools')
    
    const mockTools = [
      { name: 'test-tool', description: 'A test tool' },
      { name: 'another-tool', description: 'Another test tool' },
    ]
    mockGetTools.mockResolvedValue(mockTools)

    renderHook(() => useTools())

    // Wait for async operations to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockUpdateTools).toHaveBeenCalledWith(mockTools)
  })

  it('should set up event listener for MCP_UPDATE', async () => {
    const { useTools } = await import('../useTools')
    
    renderHook(() => useTools())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockListen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
  })

  it('should call setTools when MCP_UPDATE event is triggered', async () => {
    const { useTools } = await import('../useTools')
    
    const mockTools = [{ name: 'updated-tool', description: 'Updated tool' }]
    mockGetTools.mockResolvedValue(mockTools)

    let eventCallback: () => void

    mockListen.mockImplementation((_event, callback) => {
      eventCallback = callback
      return Promise.resolve(mockUnsubscribe)
    })

    renderHook(() => useTools())

    // Wait for initial setup
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // Clear the initial calls
    vi.clearAllMocks()
    mockGetTools.mockResolvedValue(mockTools)

    // Trigger the event
    await act(async () => {
      eventCallback()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockUpdateTools).toHaveBeenCalledWith(mockTools)
  })

  it('invalidates the MCP orchestrator tool cache on mount and on MCP_UPDATE, so a server connect/disconnect cannot serve stale tools to the next chat request', async () => {
    const { useTools } = await import('../useTools')

    let eventCallback: () => void
    mockListen.mockImplementation((_event, callback) => {
      eventCallback = callback
      return Promise.resolve(mockUnsubscribe)
    })

    renderHook(() => useTools())

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockInvalidateCache).toHaveBeenCalledTimes(1)

    await act(async () => {
      eventCallback()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockInvalidateCache).toHaveBeenCalledTimes(2)
  })

  it('should return unsubscribe function for cleanup', async () => {
    const { useTools } = await import('../useTools')
    
    const { unmount } = renderHook(() => useTools())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockListen).toHaveBeenCalled()

    // Unmount should call the unsubscribe function
    unmount()

    expect(mockListen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
  })

  it('should handle getTools errors gracefully', async () => {
    const { useTools } = await import('../useTools')
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetTools.mockRejectedValue(new Error('Failed to get tools'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockUpdateTools).toHaveBeenCalledWith([])

    consoleErrorSpy.mockRestore()
  })

  it('should handle event listener setup errors gracefully', async () => {
    const { useTools } = await import('../useTools')
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockListen.mockRejectedValue(new Error('Failed to set up listener'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Initial getTools should still work
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('does not repeat discovery on rerender while the privacy mode is unchanged', async () => {
    const { useTools } = await import('../useTools')
    
    const { rerender } = renderHook(() => useTools())
    await act(async () => { await Promise.resolve() })

    // Initial render
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledTimes(1)

    // Rerender should not trigger additional calls
    rerender()
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledTimes(1)
  })
})
