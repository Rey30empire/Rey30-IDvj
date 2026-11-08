import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { waitFor } from '@testing-library/react'
import { approvePrivacyReview, cancelAllPrivacyReviews, cancelPrivacyReview, hidePrivacyReviewText, requestPrivacyReview, usePrivacyReview } from '../privacyReview'
const context = { provider: 'fixture', model: 'fixture-model', endpoint: 'https://example.test/v1', operation: 'generate' as const }
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => { cancelAllPrivacyReviews(); vi.unstubAllGlobals() })
describe('local privacy review queue', () => {
  it('requires approval of the current snapshot and applies manual hiding to the resolved payload', async () => {
    const pending = requestPrivacyReview(context, { prompt: 'Proyecto Fixture' }, 0)
    await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull())
    const first = usePrivacyReview.getState().current!
    await hidePrivacyReviewText(first.id, 'Fixture')
    const revised = usePrivacyReview.getState().current!
    expect(revised.hash).not.toBe(first.hash)
    expect(() => approvePrivacyReview(first.id, first.hash)).toThrow('cambió')
    approvePrivacyReview(revised.id, revised.hash)
    expect((await pending).payload).toEqual({ prompt: 'Proyecto [OCULTO_MANUAL]' })
    expect(usePrivacyReview.getState().current).toBeNull()
  })
  it('cancels by close or abort without returning any approved content', async () => {
    const controller = new AbortController()
    const pending = requestPrivacyReview(context, { text: 'fixture' }, 0, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull())
    controller.abort(); await rejected
    expect(usePrivacyReview.getState().pending).toBe(0)
    const next = requestPrivacyReview(context, {}, 0)
    const nextRejected = expect(next).rejects.toMatchObject({ name: 'AbortError' })
    await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull())
    cancelPrivacyReview(usePrivacyReview.getState().current!.id); await nextRejected
  })
  it('serializes concurrent requests and binds hashes to model/endpoint/content', async () => {
    const first = requestPrivacyReview(context, { text: 'one' }, 0)
    const second = requestPrivacyReview({ ...context, model: 'other' }, { text: 'two' }, 0)
    await waitFor(() => expect(usePrivacyReview.getState().pending).toBe(2))
    const a = usePrivacyReview.getState().current!
    approvePrivacyReview(a.id, a.hash); await first
    const b = usePrivacyReview.getState().current!
    expect(a.hash).not.toBe(b.hash)
    expect(() => approvePrivacyReview(a.id, a.hash)).toThrow()
    approvePrivacyReview(b.id, b.hash); expect((await second).payload).toEqual({ text: 'two' })
  })
  it('rejects an already aborted request before exposing a preview', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(requestPrivacyReview(context, {}, 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(usePrivacyReview.getState().pending).toBe(0)
  })
})
