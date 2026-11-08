import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compactMessages } from '../context-manager'
import type { UIMessage } from 'ai'
const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('ai', () => ({ generateText: mocks.generate }))
const messages: UIMessage[] = Array.from({ length: 6 }, (_, index) => ({ id: String(index), role: index % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `Fixture ${index} ` + 'a'.repeat(500) }] }))
const config = { maxContextTokens: 200, maxOutputTokens: 50, autoCompact: true }
beforeEach(() => vi.clearAllMocks())
describe('compaction cancellation and logging', () => {
  it('passes the caller signal into the SDK and propagates cancellation instead of sending after fallback', async () => {
    const controller = new AbortController()
    mocks.generate.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(new DOMException('fixture aborted', 'AbortError')), { once: true })))
    const pending = compactMessages(messages, config, 'fixture-model', 0, controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }))
    controller.abort(); await rejection
  })
  it('rejects an already aborted compaction before calling the SDK', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(compactMessages(messages, config, 'fixture-model', 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('keeps fallback diagnostics free of upstream request content', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.generate.mockRejectedValue(new Error('fixture-private-prompt-and-key'))
    const result = await compactMessages(messages, config, 'fixture-model')
    expect(result.compactedSummary).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Auto-compact summarization failed, falling back to trim')
    expect(JSON.stringify(log.mock.calls)).not.toContain('fixture-private-prompt-and-key')
    log.mockRestore()
  })
})
