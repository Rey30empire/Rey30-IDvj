import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { $, browser, expect } from '@wdio/globals'
import { goto } from './navigation.js'
import { rey30DataDir } from './paths.js'
import { assertSafeE2eHome, canonicalPath, containsPath, launchContext } from '../launch-guard.js'

export type JsonObject = Record<string, unknown>
export function object(value: unknown): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an isolated QA object')
  return value as JsonObject
}
export async function qaIpc(command: string, args: Record<string, unknown> = {}) {
  const result = await browser.executeAsync<{ ok: boolean; value?: unknown; error?: string }, [string, Record<string, unknown>]>((name, input, done) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (name: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
    if (!internals?.invoke) return done({ ok: false, error: 'Native Tauri invoke is unavailable' })
    void internals.invoke(name, input).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }))
  }, command, args)
  assert(result.ok, `Isolated QA IPC failed: ${result.error}`)
  return result.value
}
export function assertNoModelOrChat(directory: string) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    assert(!stat.isSymbolicLink(), 'QA data cannot contain symbolic links')
    if (stat.isDirectory()) {
      if (entry.name === 'threads') assert.equal(readdirSync(path).length, 0, 'This spec cannot create chats')
      assertNoModelOrChat(path)
    } else assert(!/\.(?:gguf|safetensors|onnx|bin)$/i.test(entry.name), 'This spec cannot create or download model weights')
  }
}

export async function prepareMetadataProfile() {
  assert(process.env.REY30_E2E_HOME, 'Use the owned launcher with a new temporary profile')
  assert(!process.env.REY30_E2E_EMBEDDER_DOWNLOAD, 'Model downloads are prohibited')
  const profile = assertSafeE2eHome(process.env.REY30_E2E_HOME, launchContext())
  assert(containsPath(profile, canonicalPath(join(profile, 'agent-config'))))
  await $('#root').waitForExist({ timeout: 60_000 })
  const appConfig = canonicalPath(join(rey30DataDir(profile), 'settings.json'))
  assert(containsPath(profile, appConfig))
  await browser.waitUntil(() => existsSync(appConfig), { timeout: 30_000 })
  const config = object(JSON.parse(readFileSync(appConfig, 'utf8')))
  assert.equal(typeof config.data_folder, 'string')
  const data = canonicalPath(config.data_folder as string)
  assert(data !== profile && containsPath(profile, data), 'Native data folder escaped the QA profile')
  assertNoModelOrChat(data)
  const mcpFile = join(data, 'mcp_config.json')
  if (existsSync(mcpFile)) {
    const servers = object(object(JSON.parse(readFileSync(mcpFile, 'utf8'))).mcpServers)
    assert(Object.values(servers).every(server => object(server).active !== true), 'No MCP connection may be active in this spec')
  }
  await goto('/')
  await $('[data-testid="setup-wizard"]').waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The QA profile must start at the actual fresh-provider gate' })
  assert.equal(await qaIpc('settings_get', { key: 'rey30-characters-v1' }), null, 'Never reuse a prior character QA profile')
  assert.equal(await qaIpc('settings_get', { key: 'preferences-recovery-point-v1' }), null, 'Never reuse a prior recovery QA profile')

  const requests: { method: string; path: string; allowed: boolean }[] = []
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12)
  const providerName = `qa-characters-metadata-${nonce}`
  const modelId = `qa-no-inference-${nonce}`
  let server: Server | undefined
  const close = async () => { if (server) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done())) }
  try {
    server = createServer((request, response) => {
      const method = request.method ?? ''
      const path = (request.url ?? '').split('?')[0]
      const allowed = method === 'GET' && path === '/v1/models'
      requests.push({ method, path, allowed })
      request.resume()
      response.writeHead(allowed ? 200 : 405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'GET' })
      response.end(JSON.stringify(allowed ? { object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'metadata-only-no-inference' }] } : { error: 'Inference is not implemented or authorized by this spec' }))
    })
    await new Promise<void>((done, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', done) })
    const address = server.address()
    assert(address && typeof address === 'object')
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    const raw = await qaIpc('settings_get', { key: 'model-provider' })
    assert(raw == null || typeof raw === 'string')
    const envelope = raw ? object(JSON.parse(raw)) : { state: {}, version: 20 }
    const state = object(envelope.state)
    const providers = state.providers ?? []
    assert(Array.isArray(providers))
    assert(providers.every(item => !object(item).api_key && !(object(item).api_key_fallbacks as unknown[] | undefined)?.length), 'QA providers cannot contain credentials')
    const metadata = { id: modelId, name: 'QA METADATA — NO INFERENCE', displayName: 'QA METADATA — NO INFERENCE', capabilities: [], version: 'qa-only' }
    const seed = { ...envelope, version: 20, state: { ...state, providers: [...providers, { provider: providerName, base_url: baseUrl, active: true, api_type: 'openai', settings: [], custom_header: [], models: [metadata] }], selectedProvider: providerName, selectedModel: metadata, deletedModels: state.deletedModels ?? [] } }
    await qaIpc('settings_set', { key: 'model-provider', value: JSON.stringify(seed) })
    await qaIpc('settings_set', { key: 'setting-general', value: JSON.stringify({ state: { currentLanguage: 'es', spellCheckChatInput: false, tokenCounterCompact: true, autoUpdateCheck: false, stripReasoningFromContext: false }, version: 1 }) })
    for (const key of ['productAnalyticPrompt', 'productAnalytic']) await qaIpc('settings_set', { key, value: JSON.stringify({ state: { [key]: false }, version: 0 }) })
    await qaIpc('settings_commit')
    const disk = object(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')))
    assert.equal(disk['model-provider'], JSON.stringify(seed))
    await browser.refresh()
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 60_000 })
    await goto(`/settings/providers/${providerName}`)
    await $('[data-testid="add-model-trigger"]').waitForDisplayed({ timeout: 30_000 })
    await browser.waitUntil(() => requests.some(request => request.allowed), { timeout: 30_000, timeoutMsg: 'The owned metadata-only provider was not queried' })
    await goto('/')
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 30_000 })
    await expect($('[data-testid="chat-input"]')).toHaveValue('')
    return { profile, data, baseUrl, providerName, modelId, requests, close }
  } catch (error) { await close(); throw error }
}
