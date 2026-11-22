import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelFactory } from '../model-factory'
import { usePrivacyMode } from '@/hooks/usePrivacyMode'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { findSessionByModel } from '@rey30-idvj/tauri-plugin-llamacpp-api'
const mocks = vi.hoisted(() => ({ startModel: vi.fn(), http: vi.fn(), invoke: vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: { models: () => ({ startModel: mocks.startModel }) } }) },
  getServiceHub: () => ({ core: () => ({ invoke: mocks.invoke }) }),
}))
vi.mock('@rey30-idvj/tauri-plugin-llamacpp-api', () => ({ findSessionByModel: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.http }))
vi.mock('@ai-sdk/openai-compatible', async original => ({ ...await original(), createOpenAICompatible: vi.fn() }))
vi.mock('@ai-sdk/anthropic', async original => ({ ...await original(), createAnthropic: vi.fn() }))
beforeEach(() => { vi.clearAllMocks(); usePrivacyMode.setState({ mode: 'local-only', loaded: true, saving: false, error: null }); mocks.startModel.mockResolvedValue(undefined) })
const provider = (name: string, extra: Record<string, unknown> = {}) => ({ provider: name, base_url: 'http://localhost:1234/v1', api_key: 'fixture-connection', models: [], settings: [], active: true, ...extra }) as ProviderObject
describe('privacy enforcement at the public ModelFactory entry', () => {
  it('rejects custom loopback proxies before creating any remote provider SDK', async () => {
    await expect(ModelFactory.createModel('fixture', provider('my-local-proxy'))).rejects.toThrow('Solo local')
    expect(createOpenAICompatible).not.toHaveBeenCalled(); expect(createAnthropic).not.toHaveBeenCalled()
    expect(mocks.startModel).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled()
  })
  it('rejects an anthropic wire override on a native-looking provider name', async () => {
    await expect(ModelFactory.createModel('fixture', provider('llamacpp', { api_type: 'anthropic' }))).rejects.toThrow('Solo local')
    expect(createAnthropic).not.toHaveBeenCalled(); expect(mocks.startModel).not.toHaveBeenCalled()
  })
  it('requires a managed native model on a private thread even in standard privacy mode', async () => {
    usePrivacyMode.setState({ mode: 'standard' })
    await expect(ModelFactory.createModel('fixture', provider('llamacpp', { api_type: 'anthropic' }), {}, true)).rejects.toThrow('Solo local')
    await expect(ModelFactory.createModel('fixture', provider('custom-loopback'), {}, true)).rejects.toThrow('Solo local')
    expect(createAnthropic).not.toHaveBeenCalled()
    expect(createOpenAICompatible).not.toHaveBeenCalled()
  })
  it('accepts an actual managed native session but rejects a nonnumeric injected port', async () => {
    vi.mocked(findSessionByModel).mockResolvedValue({ port: 1234, api_key: 'fixture-local' } as Awaited<ReturnType<typeof findSessionByModel>>)
    const local = await ModelFactory.createModel('fixture', provider('llamacpp', { base_url: 'https://ignored-remote.example.test' }), { id_slot: 0, thread_id: 'fixture-thread', chat_template_kwargs: { enable_thinking: false } })
    expect(local.specificationVersion).toBe('v3')
    expect(mocks.startModel).toHaveBeenCalledOnce(); expect(mocks.http).not.toHaveBeenCalled()
    vi.mocked(findSessionByModel).mockResolvedValue({ port: '1234@evil.test', api_key: 'fixture-local' } as unknown as Awaited<ReturnType<typeof findSessionByModel>>)
    await expect(ModelFactory.createModel('fixture', provider('llamacpp'))).rejects.toThrow('puerto loopback')
    expect(mocks.http).not.toHaveBeenCalled()
  })
  it('acepta el Strata que arrancó el editor: loopback y con su clave del momento', async () => {
    const running = { setup: 'strata-iq3_s.json', model: 'qwen', port: 8080, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'clave-viva' }
    mocks.invoke.mockResolvedValue({ installed: true, engines: [], setups: [], running, ready: true, stopped: null })
    mocks.http.mockResolvedValue(new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'qwen', choices: [{ index: 0, message: { role: 'assistant', content: 'hola' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const strata = await ModelFactory.createModel('qwen', provider('strata', { base_url: running.baseUrl, api_key: 'clave-vieja' }))
    expect(createOpenAICompatible).not.toHaveBeenCalled()
    const result = await (strata as unknown as { doGenerate: (options: unknown) => Promise<{ content: { type: string; text?: string }[] }> }).doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }] })
    expect(result.content.find(part => part.type === 'text')?.text).toBe('hola')
    const [url, init] = mocks.http.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('http://127.0.0.1:8080/v1/chat/completions')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer clave-viva')
  })
  it('rechaza un Strata que el editor no arrancó', async () => {
    mocks.invoke.mockResolvedValue({ installed: true, engines: [], setups: [], running: null, ready: false, stopped: null })
    await expect(ModelFactory.createModel('qwen', provider('strata', { base_url: 'http://127.0.0.1:8080/v1' }))).rejects.toThrow('Solo local')
    expect(mocks.http).not.toHaveBeenCalled()
  })
})
