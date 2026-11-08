import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultThreadsService } from '../threads/default'
import { ExtensionManager } from '@/lib/extension'

// Mock ExtensionManager
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

describe('DefaultThreadsService', () => {
  let threadsService: DefaultThreadsService

  const mockConversationalExtension = {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    modifyThread: vi.fn(),
    deleteThread: vi.fn(),
  }

  const mockExtensionManager = {
    get: vi.fn().mockReturnValue(mockConversationalExtension),
  }

  beforeEach(() => {
    threadsService = new DefaultThreadsService()
    vi.clearAllMocks()
    vi.mocked(ExtensionManager.getInstance).mockReturnValue(
      mockExtensionManager as unknown as ReturnType<
        typeof ExtensionManager.getInstance
      >
    )
  })

  describe('fetchThreads', () => {
    it('should fetch and transform threads successfully', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should migrate old threads properly', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567880000,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
        {
          id: '2',
          title: 'Test Thread 2',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567880,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
      expect(result[1]).toMatchObject({
        id: '2',
        title: 'Test Thread 2',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })

    it('should default provider to llamacpp when engine is missing in stored thread', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([
        {
          id: '1',
          title: 'T',
          updated: 0,
          assistants: [{ model: { id: 'my-model' } }],
        },
      ])
      const result = await threadsService.fetchThreads()
      expect(result[0].model).toEqual({ id: 'my-model', provider: 'llamacpp' })
    })

    it('should handle empty threads array', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue([])

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle null/undefined response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue(null)

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })
  })

  describe('createThread', () => {
    it('should create thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [
          { ...realAssistant, model: { id: 'gpt-4', engine: 'openai' } },
        ],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
        // Real assistants (with instructions) are preserved
        assistants: [
          expect.objectContaining({
            instructions: 'You are a helpful assistant.',
          }),
        ],
      })
    })

    it('should handle creation error and return original thread', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      mockConversationalExtension.createThread.mockRejectedValue(
        new Error('Creation failed')
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })
  })

  describe('updateThread', () => {
    it('preserves the chosen model for a model-only thread across a storage round trip', async () => {
      const thread = {
        id: 'owned-model-only',
        title: 'Owned',
        updated: 1,
        model: { id: 'owned-model', provider: 'llamacpp' },
        assistants: [],
      } as Thread
      await threadsService.updateThread(thread)
      const payload = mockConversationalExtension.modifyThread.mock.calls[0][0]
      expect(payload.assistants).toEqual([
        {
          id: 'model-only',
          name: 'Model',
          model: { id: 'owned-model', engine: 'llamacpp' },
        },
      ])
      mockConversationalExtension.listThreads.mockResolvedValue([payload])
      const [restored] = await threadsService.fetchThreads()
      expect(restored.model).toEqual(thread.model)
      expect(restored.assistants?.[0]?.id).toBe('model-only')
    })
    it('should update thread successfully', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      const result = threadsService.updateThread(thread as Thread)
      await expect(result).resolves.toBeUndefined()

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          title: 'Updated Thread',
          assistants: expect.arrayContaining([
            expect.objectContaining({
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ]),
          metadata: { is_favorite: true, order: 2 },
        })
      )
    })
  })

  describe('deleteThread', () => {
    it('should delete thread successfully', () => {
      const threadId = '1'

      threadsService.deleteThread(threadId)

      expect(mockConversationalExtension.deleteThread).toHaveBeenCalledWith(
        threadId
      )
    })
  })

  describe('edge cases and error handling', () => {
    it('should throw when the conversational extension is not ready (startup race)', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof ExtensionManager.getInstance>)

      await expect(threadsService.fetchThreads()).rejects.toThrow()
    })

    it('should propagate listThreads failures instead of resolving to an empty list', async () => {
      mockConversationalExtension.listThreads.mockRejectedValue(
        new Error('invoke failed')
      )

      await expect(threadsService.fetchThreads()).rejects.toThrow(
        'invoke failed'
      )
    })

    it('should handle createThread when extension manager returns null', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof ExtensionManager.getInstance>)

      const inputThread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toEqual(inputThread)
    })

    it('rejects an update when storage is unavailable instead of reporting an unpersisted assistant selection', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof ExtensionManager.getInstance>)

      const thread = {
        id: '1',
        title: 'Test Thread',
        model: { id: 'gpt-4', provider: 'openai' },
      }

      await expect(
        threadsService.updateThread(thread as Thread)
      ).rejects.toThrow('No se guardó el cambio de asistente')
    })

    it('should handle deleteThread when extension manager returns null', async () => {
      vi.mocked(ExtensionManager.getInstance).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof ExtensionManager.getInstance>)

      const result = await threadsService.deleteThread('test-id')

      expect(result).toBeUndefined()
    })

    it('should handle fetchThreads with threads missing metadata', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          // missing metadata and assistants
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 0,
        order: undefined,
        isFavorite: undefined,
      })
    })

    it('should handle fetchThreads with threads missing assistants', async () => {
      const mockThreads = [
        {
          id: '1',
          title: 'Test Thread',
          updated: 1234567890,
          metadata: { order: 1, is_favorite: true },
          // missing assistants
        },
      ]

      mockConversationalExtension.listThreads.mockResolvedValue(mockThreads)

      const result = await threadsService.fetchThreads()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'Test Thread',
        updated: 1234567890,
        order: 1,
        isFavorite: true,
      })
    })

    it('should handle createThread with missing model info', async () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const inputThread = {
        id: '1',
        title: 'New Thread',
        // missing model
        assistants: [realAssistant],
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [
          { ...realAssistant, model: { id: '*', engine: 'llamacpp' } },
        ],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)
      expect(result.model).toEqual({ id: '*', provider: 'llamacpp' })
      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'llamacpp' },
            }),
          ],
        })
      )
    })

    it('should handle createThread with missing assistants', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [
          {
            id: 'model-only',
            name: 'Model',
            model: { id: 'gpt-4', engine: 'openai' },
          },
        ],
        metadata: { order: 1 },
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)
      expect(result.model).toEqual(inputThread.model)
      // Should create with model-only entry when no assistants provided
      expect(mockConversationalExtension.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              id: 'model-only',
              name: 'Model',
              model: { id: 'gpt-4', engine: 'openai' },
            }),
          ],
        })
      )
    })

    it('should handle updateThread with missing assistants', () => {
      const thread = {
        id: '1',
        title: 'Updated Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        // missing assistants
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            {
              model: { id: 'gpt-4', engine: 'openai' },
              id: 'model-only',
              name: 'Model',
            },
          ],
        })
      )
    })

    it('should handle updateThread with missing model info', () => {
      const realAssistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        instructions: 'You are a helpful assistant.',
      }

      const thread = {
        id: '1',
        title: 'Updated Thread',
        // missing model
        assistants: [realAssistant],
        isFavorite: true,
        order: 2,
      }

      threadsService.updateThread(thread as Thread)

      expect(mockConversationalExtension.modifyThread).toHaveBeenCalledWith(
        expect.objectContaining({
          assistants: [
            expect.objectContaining({
              model: { id: '*', engine: 'llamacpp' },
            }),
          ],
        })
      )
    })

    it('should handle fetchThreads with non-array response', async () => {
      mockConversationalExtension.listThreads.mockResolvedValue('not-an-array')

      const result = await threadsService.fetchThreads()

      expect(result).toEqual([])
    })

    it('should handle createThread with missing metadata in response', async () => {
      const inputThread = {
        id: '1',
        title: 'New Thread',
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1,
      }

      const mockCreatedThread = {
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
        // missing metadata
      }

      mockConversationalExtension.createThread.mockResolvedValue(
        mockCreatedThread
      )

      const result = await threadsService.createThread(inputThread as Thread)

      expect(result).toMatchObject({
        id: '1',
        title: 'New Thread',
        updated: 1234567890,
        model: { id: 'gpt-4', provider: 'openai' },
        order: 1, // Should fall back to original thread order
        assistants: [{ model: { id: 'gpt-4', engine: 'openai' } }],
      })
    })
  })
})
