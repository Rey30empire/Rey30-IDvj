import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { $, $$, browser, expect } from '@wdio/globals'
import { clickWhenReady } from '../helpers/interactions.js'
import { assertNoModelOrChat, object, prepareMetadataProfile, qaIpc } from '../helpers/metadata-profile.js'
import { goto, waitForPath } from '../helpers/navigation.js'
import { startWorkspaceProvider, type WorkspaceToolStep } from '../helpers/workspace-provider.js'
import { canonicalPath, containsPath } from '../launch-guard.js'

const PICKER = '[data-testid="open-project-folder"]'
const SESSION = '[data-testid="workspace-folder-session"]'
const WORKSPACE = '[data-testid="cowork-surface"]'
const COMPOSER = `${WORKSPACE} [data-testid="chat-input"]`
const SEND = `${WORKSPACE} [data-testid="send-message-button"]`
const STORE_KEY = 'code-sessions'
const PRIVACY_KEY = 'privacy-mode-v1'

type TestTool = Pick<WorkspaceToolStep, 'name' | 'args'>
type GuardInput = {
  folder: string
  baseUrl: string
  choices: (string | null)[]
  tools: TestTool[]
}
type GuardTrace = {
  pickerCalls: number
  validatedFolders: string[]
  nativeTools: { name: string; path: string; threadId: string }[]
  blocked: string[]
}

function installWorkspaceFixture(input: GuardInput, done: (result: { ok: boolean; error?: string }) => void) {
  const target = window as unknown as {
    fetch: typeof fetch
    __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> }
    __rey30WorkspaceFixture?: GuardTrace
  }
  const originalFetch = target.fetch
  const trace: GuardTrace = { pickerCalls: 0, validatedFolders: [], nativeTools: [], blocked: [] }
  target.__rey30WorkspaceFixture = trace
  const probe = '__rey30_workspace_picker_fixture_probe'
  const nonce = crypto.randomUUID()
  const loopback = new URL(input.baseUrl)
  const allowedHttp = (url: unknown, method: unknown) =>
    (method === 'GET' && url === `${loopback.href}/models`) ||
    (method === 'POST' && url === `${loopback.href}/chat/completions`)
  const response = (value: unknown, success: boolean) => new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Tauri-Response': success ? 'ok' : 'error' },
  })
  const block = (reason: string) => {
    trace.blocked.push(reason)
    return response(`Workspace QA guard: ${reason}`, false)
  }
  const folderKey = (path: string) => /^[a-z]:\\|^\\\\\?\\/i.test(path)
    ? path.replace(/^\\\\\?\\/, '').replaceAll('\\', '/').toLowerCase()
    : path

  target.fetch = async (resource, init) => {
    const url = new URL(typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url, location.href)
    const ipc = url.hostname === 'ipc.localhost' || (url.protocol === 'ipc:' && url.hostname === 'localhost')
    if (!ipc) {
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin && url.hostname !== 'asset.localhost' && !allowedHttp(url.href, init?.method ?? 'GET')) {
        return block('External webview request blocked')
      }
      return originalFetch.call(window, resource, init)
    }

    const command = decodeURIComponent(url.pathname.slice(1))
    if (command === probe) return response({ nonce }, true)
    if (/^(?:plugin:(?:llamacpp|mlx)\|.*(?:load|start)|.*(?:download_model|start_model|embedder_start)|character_audio_(?:synthesize|transcribe))$/i.test(command)) return block(command)

    if (['open_dialog', 'plugin:http|fetch', 'plugin:agent-tools|validate_cowork_folder', 'plugin:agent-tools|execute_tool', 'plugin:agent-tools|execute_tool_streaming'].includes(command)) {
      let payload: Record<string, unknown>
      try {
        payload = await (resource instanceof Request && init?.body === undefined
          ? resource.clone().json()
          : new Response(init?.body).json())
      } catch {
        return block(`Unreadable IPC payload for ${command}`)
      }
      if (command === 'open_dialog') {
        const options = payload.options as { directory?: boolean; multiple?: boolean } | undefined
        if (options?.directory !== true || options.multiple === true || trace.pickerCalls >= input.choices.length) return block('Unexpected picker invocation')
        return response(input.choices[trace.pickerCalls++], true)
      }
      if (command === 'plugin:http|fetch') {
        const config = payload.clientConfig as { url?: string; method?: string } | undefined
        if (!allowedHttp(config?.url, config?.method)) return block('HTTP destination outside the workspace fixture')
      }
      if (command === 'plugin:agent-tools|validate_cowork_folder') {
        if (typeof payload.folder !== 'string' || folderKey(payload.folder) !== folderKey(input.folder)) return block('Unexpected validation folder')
        trace.validatedFolders.push(input.folder)
      }
      if (command === 'plugin:agent-tools|execute_tool' || command === 'plugin:agent-tools|execute_tool_streaming') {
        const step = input.tools[trace.nativeTools.length]
        const args = payload.args as Record<string, unknown> | undefined
        const sameArgs = args && step && Object.keys(args).length === Object.keys(step.args).length
          && Object.entries(step.args).every(([key, value]) => JSON.stringify(args[key]) === JSON.stringify(value))
        if (!step || payload.name !== step.name || !sameArgs || payload.projectWritable !== true || payload.scope !== 'session'
          || typeof payload.readOnlyProject !== 'string' || folderKey(payload.readOnlyProject) !== folderKey(input.folder)
          || typeof payload.threadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.threadId)) {
          return block(`Unexpected native tool payload for ${step?.name ?? 'extra call'}`)
        }
        trace.nativeTools.push({ name: step.name, path: step.args.path, threadId: payload.threadId })
      }
    }
    return originalFetch.call(window, resource, init)
  }

  void target.__TAURI_INTERNALS__.invoke(probe).then(value => {
    if (typeof value === 'object' && value !== null && 'nonce' in value && value.nonce === nonce) done({ ok: true })
    else done({ ok: false, error: 'The native picker fixture probe was bypassed' })
  }, () => done({ ok: false, error: 'The native picker fixture probe failed' }))
}

async function installGuard(input: GuardInput) {
  const result = await browser.executeAsync(installWorkspaceFixture, input)
  assert(result.ok, result.error)
}

async function guardTrace() {
  return await browser.execute(() => (window as unknown as { __rey30WorkspaceFixture: GuardTrace }).__rey30WorkspaceFixture)
}

async function storedWorkspace() {
  const raw = await qaIpc('settings_get', { key: STORE_KEY })
  return raw == null ? null : object(object(JSON.parse(String(raw))).state)
}

function selectedSession(state: NonNullable<Awaited<ReturnType<typeof storedWorkspace>>>) {
  assert(Array.isArray(state.sessions))
  const current = state.sessions.map(object).find(session => session.id === state.currentId)
  assert(current, 'The selected workspace session is missing from native settings')
  return current
}

function assertFolder(actual: unknown, expected: string) {
  assert.equal(typeof actual, 'string')
  assert.equal(canonicalPath(String(actual).replace(/^\\\\\?\\(?=[a-z]:\\)/i, '')), expected)
}

describe('native folder workspace with a scripted local SSE provider', () => {
  let metadata: Awaited<ReturnType<typeof prepareMetadataProfile>> | undefined
  let provider: Awaited<ReturnType<typeof startWorkspaceProvider>> | undefined
  let artifacts: string | undefined
  let folder: string | undefined
  let appVersion: unknown
  let sessionId: unknown
  let passed = false
  const traces: GuardTrace[] = []

  it('opens a folder, runs confined tools and reopens the saved session', async () => {
    appVersion = await qaIpc('plugin:app|version')
    assert.equal(appVersion, '0.9.7', 'Use the rebuilt Debug app with the workspace feature')
    metadata = await prepareMetadataProfile()
    const { profile, data, providerName, modelId } = metadata
    const owned = mkdtempSync(join(profile, 'workspace-spec-'))
    folder = join(owned, 'Proyecto temporal de QA')
    mkdirSync(folder)
    folder = canonicalPath(folder)
    assert(containsPath(profile, folder) && !containsPath(data, folder) && !containsPath(folder, data))

    const nonce = randomUUID()
    const seedName = `origen-${nonce}.txt`
    const seed = `contenido existente ${randomUUID()}`
    const outputName = `resultado-${nonce}.txt`
    const outputFile = join(folder, outputName)
    const initial = `primera versión ${nonce}`
    const edited = `versión revisada ${nonce}`
    const escapeName = `escape-${nonce}.txt`
    const escaped = join(owned, escapeName)
    const prompt = `Prueba controlada de carpeta ${nonce}`
    const reply = `Secuencia de carpeta verificada ${nonce}`
    writeFileSync(join(folder, seedName), `${seed}\n`, { flag: 'wx' })
    const steps: WorkspaceToolStep[] = [
      { name: 'ls', args: { path: '.' }, verify: result => assert(result.includes(seedName), 'Listing must contain the seeded file') },
      { name: 'read', args: { path: seedName }, verify: result => assert(result.includes(seed), 'The tool must return the independently seeded content') },
      { name: 'write', args: { path: outputName, content: `${initial}\n` }, verify: result => {
        assert(result.includes(outputName))
        assert.equal(readFileSync(outputFile, 'utf8'), `${initial}\n`)
      } },
      { name: 'edit', args: { path: outputName, edits: [{ old_string: initial, new_string: edited }] }, verify: result => {
        assert(result.includes(outputName))
        assert.equal(readFileSync(outputFile, 'utf8'), `${edited}\n`)
      } },
      { name: 'read', args: { path: outputName }, verify: result => assert(result.includes(edited), 'The edited bytes must be read through the real tool') },
      { name: 'write', args: { path: `../${escapeName}`, content: 'This file must never be created' }, verify: result => {
        assert.match(result, /outside (?:the )?agent workspace/i)
        assert.equal(existsSync(escaped), false)
      } },
    ]
    provider = await startWorkspaceProvider(modelId, prompt, reply, steps)
    const root = resolve(import.meta.dirname, '../../artifacts/qa/workspace-folder-e2e')
    mkdirSync(root, { recursive: true })
    artifacts = mkdtempSync(join(root, 'run-'))

    const envelope = object(JSON.parse(String(await qaIpc('settings_get', { key: 'model-provider' }))))
    const state = object(envelope.state)
    assert(Array.isArray(state.providers))
    const original = state.providers.map(object).find(item => item.provider === providerName)
    assert(original && Array.isArray(original.models) && original.models.length === 1)
    const model = { ...object(original.models[0]), capabilities: ['tools'] }
    const settings = JSON.stringify({ ...envelope, state: {
      ...state, providers: [{ ...original, base_url: provider.baseUrl, models: [model] }], selectedProvider: providerName, selectedModel: model,
    } })
    const privacy = JSON.stringify({ schema: 1, mode: 'standard' })
    await qaIpc('settings_set', { key: 'model-provider', value: settings })
    await qaIpc('settings_set', { key: PRIVACY_KEY, value: privacy })
    await qaIpc('settings_commit')
    const disk = object(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')))
    assert.equal(disk['model-provider'], settings)
    assert.equal(disk[PRIVACY_KEY], privacy)
    await browser.refresh()
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 60_000 })

    assert.equal((await storedWorkspace())?.currentId ?? null, null, 'QA starts without a selected workspace')
    await installGuard({ folder, baseUrl: provider.baseUrl, choices: [null, folder], tools: steps.map(({ name, args }) => ({ name, args })) })
    await clickWhenReady(PICKER)
    await browser.waitUntil(async () => (await guardTrace()).pickerCalls === 1, { timeout: 10_000 })
    assert.equal((await storedWorkspace())?.currentId ?? null, null, 'Cancelling the picker cannot create a session')
    await clickWhenReady(PICKER)
    await waitForPath('/cowork')
    await $(WORKSPACE).waitForDisplayed({ timeout: 30_000 })
    await expect($(SESSION)).toHaveText(basename(folder))
    await browser.waitUntil(async () => (await storedWorkspace())?.currentId != null, { timeout: 15_000 })
    const opened = selectedSession((await storedWorkspace())!)
    sessionId = opened.id
    assertFolder(opened.folder, folder)
    assert.deepEqual(opened.model, { provider: providerName, id: modelId }, 'A new folder session must bind the selected tool-capable model')
    assert.notEqual(opened.planMode, true, 'The new folder must open ready to execute tools')
    assert.deepEqual((await guardTrace()).validatedFolders, [folder], 'Opening the folder must validate it once')

    await $(COMPOSER).setValue(prompt)
    await clickWhenReady(SEND)
    await browser.waitUntil(async () => {
      assert.deepEqual(provider!.errors, [])
      assert.deepEqual((await guardTrace()).blocked, [])
      return (await $(WORKSPACE).getText()).includes(reply)
    }, { timeout: 60_000, timeoutMsg: 'The scripted tool loop did not render its final response' })
    assert.equal(provider.completions, steps.length + 1)
    assert.deepEqual(provider.verifiedTools, steps.map(step => step.name))
    const trace = await guardTrace()
    traces.push(trace)
    assert.deepEqual(trace.validatedFolders, [folder, folder], 'Submitting the task must revalidate the chosen folder')
    assert.deepEqual(trace.nativeTools, steps.map(step => ({ name: step.name, path: step.args.path, threadId: sessionId })))
    assert.deepEqual(readdirSync(folder).sort(), [seedName, outputName].sort())
    assert.equal(readFileSync(join(folder, seedName), 'utf8'), `${seed}\n`)
    assert.equal(readFileSync(outputFile, 'utf8'), `${edited}\n`)
    assert(!existsSync(escaped) && !existsSync(join(folder, escapeName)))

    await browser.waitUntil(async () => {
      const current = selectedSession((await storedWorkspace())!)
      return Array.isArray(current.turns) && current.turns.some(turn => object(turn).content === reply)
    }, { timeout: 15_000, timeoutMsg: 'The completed transcript was not committed to the workspace store' })
    const completed = selectedSession((await storedWorkspace())!)
    assert(Array.isArray(completed.turns))
    const tools = completed.turns.map(object).filter(turn => turn.role === 'tool')
    assert.deepEqual(tools.map(tool => tool.name), steps.map(step => step.name))
    assert(tools.slice(0, -1).every(tool => tool.isError !== true))
    assert.equal(tools.at(-1)?.isError, true)
    assert.equal(object(tools[3].args).path, outputName)
    assert.equal(tools[3].diff, `-    1 | ${initial}\n+    1 | ${edited}`, 'The persisted edit diff must identify both changed lines')
    await qaIpc('settings_commit')
    const saved = object(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')))
    assert.equal(selectedSession(object(object(JSON.parse(String(saved[STORE_KEY]))).state)).id, sessionId)
    await browser.saveScreenshot(join(artifacts, 'workspace-transcript.png'))

    await goto('/')
    await browser.refresh()
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 60_000 })
    await installGuard({ folder, baseUrl: provider.baseUrl, choices: [folder], tools: [] })
    await clickWhenReady(PICKER)
    await waitForPath('/cowork')
    await expect($(WORKSPACE)).toHaveText(expect.stringContaining(reply))
    const returned = (await storedWorkspace())!
    assert.equal(selectedSession(returned).id, sessionId)
    assert.deepEqual(selectedSession(returned).model, opened.model, 'Reopening must keep the model bound to the session')
    assert.deepEqual(selectedSession(returned).turns, completed.turns)
    assert.equal((await $$(SESSION)).length, 1, 'Reopening the folder cannot duplicate its session')
    const returnTrace = await guardTrace()
    traces.push(returnTrace)
    assert.deepEqual(returnTrace.validatedFolders, [folder])
    assert.deepEqual(returnTrace.nativeTools, [])
    assert.deepEqual(returnTrace.blocked, [])
    assert.equal(provider.completions, steps.length + 1)
    assert(metadata.requests.every(request => request.allowed))
    assertNoModelOrChat(data)
    await browser.saveScreenshot(join(artifacts, 'workspace-return.png'))
    passed = true
  })

  after(async () => {
    try {
      if (!passed && artifacts) {
        const trace = await guardTrace().catch(() => undefined)
        if (trace) traces.push(trace)
      }
      if (artifacts) {
        const binary = resolve(import.meta.dirname, '../../src-tauri/target/debug', process.platform === 'win32' ? 'Rey30-IDvj.exe' : 'Rey30-IDvj')
        writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({
          passed, appVersion, binary, binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
          profile: metadata?.profile, folder, sessionId, traces, metadataRequests: metadata?.requests,
          scriptedProviderRequests: provider?.requests, scriptedCompletionPosts: provider?.completions,
          verifiedTools: provider?.verifiedTools, providerErrors: provider?.errors, realInferenceCalls: passed ? 0 : null,
          picker: 'Native file dialog return value simulated; workspace validation and tool IPC use the native app',
          input: 'Embedded WebDriver DOM input; physical OS selection and hit testing are separate',
        }, null, 2) + '\n')
      }
    } finally {
      await Promise.all([provider?.close(), metadata?.close()])
    }
  })
})
