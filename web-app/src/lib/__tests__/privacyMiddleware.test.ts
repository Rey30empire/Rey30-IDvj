import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { waitFor } from '@testing-library/react'
import { wrapLanguageModel } from 'ai'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { assertNativeSessionPort, assertPrivacyFactoryParameters, assertPrivacyLoopbackUrl, assertPrivacyProvider, getPrivacyModeSnapshot } from '../privacyPolicy'
import { wrapModelWithPrivacy, withPrivacyRemoteGuard } from '../privacyMiddleware'
import { approvePrivacyReview, cancelAllPrivacyReviews, usePrivacyReview } from '../privacyReview'

type ModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Correo ana@example.test' }] }]
function fixture() {
  const sent = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
  const guarded = withPrivacyRemoteGuard(sent)
  const invoke = vi.fn(async (params: Parameters<ModelV3['doGenerate']>[0]) => {
    await guarded('https://example.test/v1/chat/completions', { method: 'POST', headers: params.headers as HeadersInit, body: JSON.stringify({ model: 'fixture-model', prompt: params.prompt }), signal: params.abortSignal })
    return { content: [], warnings: [], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } }
  })
  const stream = vi.fn(async (params: Parameters<ModelV3['doStream']>[0]) => { await invoke(params); return { stream: new ReadableStream({ start(controller) { controller.close() } }), warnings: [] } })
  const raw = { specificationVersion: 'v3', provider: 'fixture', modelId: 'fixture-model', supportedUrls: {}, doGenerate: invoke, doStream: stream } as unknown as ModelV3
  return { model: wrapModelWithPrivacy(raw, { provider: 'fixture', model: 'fixture-model', endpoint: 'https://example.test/v1', nativeEngine: false, parameters: {} }), invoke, sent, guarded }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); usePrivacyMode.setState({ mode: 'cloud-review', loaded: true, saving: false, error: null }) })
afterEach(() => { cancelAllPrivacyReviews(); usePrivacyMode.setState({ mode: 'standard', loaded: false, saving: false, error: null }); vi.unstubAllGlobals() })
async function approve() { await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull()); const view = usePrivacyReview.getState().current!; approvePrivacyReview(view.id, view.hash) }
describe('privacy SDK v3 middleware and final fetch boundary', () => {
  it.each(['doGenerate', 'doStream'] as const)('reviews and redacts before %s reaches a fetch, keeping auth out of review', async operation => {
    const { model, sent } = fixture()
    const result = model[operation]({ prompt, headers: { Authorization: 'fixture-auth-only' } })
    await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull())
    expect(sent).not.toHaveBeenCalled()
    const view = usePrivacyReview.getState().current!
    expect(JSON.stringify(view.payload)).not.toContain('ana@example.test')
    expect(JSON.stringify(view.payload)).not.toContain('fixture-auth-only')
    await approve(); await result
    expect(sent).toHaveBeenCalledOnce()
    const init = sent.mock.calls[0][1] as RequestInit
    expect(String(init.body)).toContain('CORREO_POSIBLE')
    expect(String(init.body)).not.toContain('ana@example.test')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('fixture-auth-only')
    expect(headers.has('x-rey30-privacy-review')).toBe(false)
    expect(init.redirect).toBe('error')
    expect(init).toHaveProperty('maxRedirections', 0)
  })
  it('cancel prevents the underlying model and fetch entirely', async () => {
    const { model, invoke, sent } = fixture()
    const pending = model.doGenerate({ prompt }); const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await waitFor(() => expect(usePrivacyReview.getState().current).not.toBeNull()); cancelAllPrivacyReviews(); await rejection
    expect(invoke).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled()
  })
  it('blocks files and tools before review or underlying execution', async () => {
    const { model, invoke } = fixture()
    await expect(model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'file', data: new Uint8Array([1]), mediaType: 'image/png' }] }] })).rejects.toThrow('adjuntos')
    await expect(model.doGenerate({ prompt, tools: [{ type: 'function', name: 'shell', inputSchema: {} }] })).rejects.toThrow('herramientas')
    await expect(model.doGenerate({ prompt, providerOptions: { fixture: { webSearch: true } } })).rejects.toThrow('herramientas')
    expect(invoke).not.toHaveBeenCalled(); expect(usePrivacyReview.getState().current).toBeNull()
  })
  it('checks current mode at factory policy and immediately before remote connection', async () => {
    usePrivacyMode.setState({ mode: 'local-only' })
    const { model, sent, guarded } = fixture()
    await expect(model.doGenerate({ prompt })).rejects.toThrow('Solo local')
    await expect(guarded('https://example.test', {})).rejects.toThrow('Solo local')
    expect(sent).not.toHaveBeenCalled()
    expect(() => assertPrivacyProvider('local-only', false)).toThrow('proxy')
    expect(() => assertPrivacyProvider('local-only', true)).not.toThrow()
  })
  it('requires a valid approval ticket for any cloud-review network call', async () => {
    const { guarded, sent } = fixture()
    await expect(guarded('https://example.test/v1', { body: '{}' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).not.toHaveBeenCalled()
  })
  it('fails closed while policy is unhydrated or being saved; validates native ports and URLs', () => {
    usePrivacyMode.setState({ loaded: false, mode: 'standard' }); expect(getPrivacyModeSnapshot()).toBe('local-only')
    for (const port of ['1234@remote.test', 0, 65536, Number.NaN]) expect(() => assertNativeSessionPort(port)).toThrow()
    assertNativeSessionPort(1234)
    for (const url of ['https://example.test', 'http://localhost.evil.test:1', 'http://localhost@evil.test:1']) expect(() => assertPrivacyLoopbackUrl(url)).toThrow()
    expect(() => assertPrivacyLoopbackUrl('http://localhost:1234/v1')).not.toThrow()
  })
  it('rejects factory text/body overrides outside SDK review, preserving standard mode', () => {
    for (const parameters of [{ grammar: 'private grammar' }, { stop_sequences: ['secret'] }, { undocumented: 1234567890 }, { json_schema: { private: true } }]) expect(() => assertPrivacyFactoryParameters('cloud-review', parameters)).toThrow('opciones extra')
    expect(() => assertPrivacyFactoryParameters('cloud-review', { temperature: 0.2, top_k: '40', auto_compact: true })).not.toThrow()
    expect(() => assertPrivacyFactoryParameters('standard', { grammar: 'private grammar' })).not.toThrow()
  })
  it('aborts an active SDK request when the policy changes, without claiming to retract sent data', async () => {
    usePrivacyMode.setState({ mode: 'standard' })
    const invoked = vi.fn(async (params: Parameters<ModelV3['doGenerate']>[0]) => {
      await new Promise<never>((_resolve, reject) => params.abortSignal!.addEventListener('abort', () => reject(params.abortSignal!.reason), { once: true }))
      throw new Error('unreachable')
    })
    const raw = { specificationVersion: 'v3', provider: 'fixture', modelId: 'fixture-model', supportedUrls: {}, doGenerate: invoked } as unknown as ModelV3
    const model = wrapModelWithPrivacy(raw, { provider: 'fixture', model: 'fixture-model', endpoint: 'https://example.test', nativeEngine: false, parameters: {} })
    const pending = model.doGenerate({ prompt }); const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await waitFor(() => expect(invoked).toHaveBeenCalledOnce())
    usePrivacyMode.setState({ mode: 'local-only' }); await rejection
  })
})
