import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join, resolve } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { clickWhenReady } from '../helpers/interactions.js'
import { goto } from '../helpers/navigation.js'
import { rey30DataDir } from '../helpers/paths.js'
import { assertSafeE2eHome, canonicalPath, containsPath, launchContext } from '../launch-guard.js'

// Opt-in only: yarn test --spec ./specs/product-layout.e2e.ts. The launcher
// owns the temporary app profile. This spec never starts an LLM or sends a turn.
const HOME = '[data-testid="home-welcome"]'
const COMPOSER = '[data-testid="home-composer-shell"]'
const INPUT = '[data-testid="chat-input"]'
const PROFILE = '[data-testid="profile-menu-trigger"]'
const MENU = '[data-slot="dropdown-menu-content"][data-state="open"]'
const PROFILE_ITEM = '//*[@role="menuitem"][normalize-space(.)="Profile" or normalize-space(.)="Perfil"]'
const DIALOG = '[data-testid="local-profile-dialog"]'
const NAME = '[data-testid="local-profile-name"]'
const INITIALS = '[data-testid="local-profile-initials"]'
const SAVE = '[data-testid="local-profile-save"]'
const CANCEL = '[data-testid="local-profile-cancel"]'
const PROFILE_KEY = 'rey30-local-profile-v1'
const WINDOWS = [{ width: 1200, height: 800 }, { width: 900, height: 650 }]

type JsonObject = Record<string, unknown>
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type Geometry = {
  viewport: { width: number; height: number }
  document: { width: number; height: number }
  path: string
  controls: { selector: string; rect: Rect | null }[]
}
type RequestRecord = { method: string; path: string; allowed: boolean }
type IpcResult = { ok: boolean; value?: unknown; error?: string }

function object(value: unknown): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object in the isolated fixture')
  return value as JsonObject
}

function assertNoModelsOrThreads(directory: string) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    assert(!stat.isSymbolicLink(), `QA data must not contain a symlink: ${path}`)
    if (stat.isDirectory()) {
      if (entry.name === 'threads') assert.equal(readdirSync(path).length, 0, 'Layout QA must not create a chat')
      assertNoModelsOrThreads(path)
    } else {
      assert(!/\.(?:gguf|safetensors|onnx|bin)$/i.test(entry.name), `Layout QA must not load or download model weights: ${path}`)
    }
  }
}

async function ipc(command: 'settings_get' | 'settings_set' | 'settings_commit', args: Record<string, unknown>) {
  const result = await browser.executeAsync<IpcResult, [string, Record<string, unknown>]>((name, input, done) => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (name: string, args: Record<string, unknown>) => Promise<unknown> }
    }).__TAURI_INTERNALS__
    if (!internals?.invoke) return done({ ok: false, error: 'Actual Tauri internal invoke is unavailable' })
    void internals.invoke(name, input).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }))
  }, command, args)
  assert(result.ok, `Isolated settings IPC failed: ${result.error}`)
  return result.value
}

async function geometry(selectors: string[]): Promise<Geometry> {
  return browser.execute((list: string[]) => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    path: window.location.pathname,
    controls: list.map(selector => {
      const node = document.querySelector(selector)
      if (!node) return { selector, rect: null }
      const r = node.getBoundingClientRect()
      return { selector, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    }),
  }), selectors)
}

function bounds(snapshot: Geometry, selector: string): Rect {
  const rect = snapshot.controls.find(control => control.selector === selector)?.rect
  assert(rect && rect.width > 0 && rect.height > 0, `Control has no visible bounds: ${selector}`)
  assert(rect.left >= -1 && rect.top >= -1 && rect.right <= snapshot.viewport.width + 1 && rect.bottom <= snapshot.viewport.height + 1,
    `Control is outside the native webview: ${selector}`)
  return rect
}

async function openProfileMenu() {
  const trigger = await clickWhenReady(PROFILE)
  if ((await trigger.getAttribute('data-state')) !== 'open') await browser.keys('Enter')
  await $(MENU).waitForDisplayed({ timeout: 10_000 })
}

async function settledScreenshot(file: string) {
  await browser.waitUntil(() => browser.executeAsync<boolean, []>((done) => {
    const hasFiniteMotion = () => document.getAnimations().some(animation =>
      animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime) &&
      (animation.playState === 'running' || animation.pending))
    if (hasFiniteMotion()) return done(false)
    requestAnimationFrame(() => requestAnimationFrame(() => done(!hasFiniteMotion())))
  }), { timeout: 10_000, interval: 50, timeoutMsg: 'Finite UI animations did not settle before the screenshot' })
  const paint = await browser.execute((selector: string) => {
    const animations = document.getAnimations()
    const style = (node: Element | null) => node ? {
      opacity: getComputedStyle(node).opacity,
      backgroundColor: getComputedStyle(node).backgroundColor,
    } : null
    return {
      pendingFiniteAnimations: animations.filter(animation => animation.effect &&
        Number.isFinite(animation.effect.getComputedTiming().endTime) &&
        (animation.playState === 'running' || animation.pending)).length,
      ignoredInfiniteAnimations: animations.filter(animation => animation.effect &&
        !Number.isFinite(animation.effect.getComputedTiming().endTime)).length,
      dialog: style(document.querySelector(selector)),
      overlay: style(document.querySelector('[data-slot="dialog-overlay"]')),
    }
  }, DIALOG)
  assert.equal(paint.pendingFiniteAnimations, 0, 'A finite animation restarted before the screenshot')
  if (paint.dialog) assert.equal(Number(paint.dialog.opacity), 1, 'Profile dialog is still fading at capture time')
  await browser.saveScreenshot(file)
  return { file, waitedForFiniteAnimations: true, settledFrames: 2, ...paint }
}

describe('native empty-home and local-profile layout without inference', () => {
  let profile: string
  let data: string
  let artifacts: string
  let server: Server | undefined
  let baseUrl: string
  let providerName: string
  let modelId: string
  let previousProfileName = 'Rey30'
  const requests: RequestRecord[] = []
  const observations: unknown[] = []
  const captureSettlements: Awaited<ReturnType<typeof settledScreenshot>>[] = []
  let completed = 0

  before(async () => {
    assert(process.env.REY30_E2E_HOME, 'Use the owned WDIO launcher with a new OS-temp profile')
    assert(!process.env.REY30_E2E_EMBEDDER_DOWNLOAD, 'Model downloads are forbidden in this layout-only spec')
    profile = assertSafeE2eHome(process.env.REY30_E2E_HOME, launchContext())
    assert(containsPath(profile, canonicalPath(join(profile, 'agent-config'))), 'Agent config must remain inside the QA profile')
    await $('#root').waitForExist({ timeout: 60_000 })
    const appConfig = canonicalPath(join(rey30DataDir(profile), 'settings.json'))
    assert(containsPath(profile, appConfig), 'Native app config must remain inside the validated profile')
    await browser.waitUntil(() => existsSync(appConfig), { timeout: 30_000, timeoutMsg: 'No isolated native app configuration was created' })
    const configuration = object(JSON.parse(readFileSync(appConfig, 'utf8')))
    assert.equal(typeof configuration.data_folder, 'string')
    data = canonicalPath(configuration.data_folder as string)
    assert(data !== profile && containsPath(profile, data), 'Native data_folder escaped the OS-temp profile')
    assertNoModelsOrThreads(data)
    const mcpFile = join(data, 'mcp_config.json')
    if (existsSync(mcpFile)) {
      const mcp = object(object(JSON.parse(readFileSync(mcpFile, 'utf8'))).mcpServers)
      assert(Object.values(mcp).every(value => object(value).active !== true), 'Layout QA requires all MCP servers inactive')
    }

    await goto('/')
    await $('[data-testid="setup-wizard"]').waitForDisplayed({ timeout: 60_000, timeoutMsg: 'Use a fresh profile: the actual home gate must initially be closed' })
    assert.equal(await browser.execute(key => localStorage.getItem(key), PROFILE_KEY), null, 'The local profile must be fresh')

    const repo = canonicalPath(resolve(import.meta.dirname, '../..'))
    const output = canonicalPath(join(repo, 'artifacts', 'qa', 'product-layout-e2e'))
    assert(containsPath(repo, output), 'Layout evidence must remain inside this repository')
    mkdirSync(output, { recursive: true })
    artifacts = mkdtempSync(join(output, 'run-'))
    const nonce = randomUUID().replaceAll('-', '').slice(0, 12)
    providerName = `qa-layout-metadata-${nonce}`
    modelId = `qa-layout-no-inference-${nonce}`
    server = createServer((request, response) => {
      const method = request.method ?? ''
      const path = (request.url ?? '').split('?')[0]
      const allowed = method === 'GET' && path === '/v1/models'
      requests.push({ method, path, allowed })
      request.resume()
      response.writeHead(allowed ? 200 : 405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'GET' })
      response.end(JSON.stringify(allowed
        ? { object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'qa-metadata-only-no-inference' }] }
        : { error: 'Layout-only QA: inference and all other endpoints are prohibited' }))
    })
    await new Promise<void>((done, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', done)
    })
    const address = server.address()
    assert(address && typeof address === 'object')
    baseUrl = `http://127.0.0.1:${address.port}/v1`

    // Fixture seeding uses the current persisted schema, not a hidden React
    // setter or a gate override. The custom endpoint requires no credential.
    const stored = await ipc('settings_get', { key: 'model-provider' })
    assert(stored == null || typeof stored === 'string')
    const envelope = stored ? object(JSON.parse(stored)) : { state: {}, version: 20 }
    const state = object(envelope.state)
    const providers = state.providers ?? []
    assert(Array.isArray(providers))
    for (const value of providers) {
      const provider = object(value)
      assert(!provider.api_key && !(provider.api_key_fallbacks as unknown[] | undefined)?.length, 'A fresh QA profile must not contain credentials')
      assert(provider.provider !== providerName)
    }
    const metadata = { id: modelId, name: 'QA METADATA — NO INFERENCE', displayName: 'QA METADATA — NO INFERENCE', capabilities: [], version: 'qa-only' }
    const seed = {
      ...envelope,
      version: 20,
      state: { ...state, providers: [...providers, { provider: providerName, base_url: baseUrl, active: true, api_type: 'openai', settings: [], custom_header: [], models: [metadata] }],
        selectedProvider: providerName, selectedModel: metadata, deletedModels: state.deletedModels ?? [] },
    }
    await ipc('settings_set', { key: 'model-provider', value: JSON.stringify(seed) })
    await ipc('settings_set', { key: 'productAnalyticPrompt', value: JSON.stringify({ state: { productAnalyticPrompt: false }, version: 0 }) })
    await ipc('settings_set', { key: 'productAnalytic', value: JSON.stringify({ state: { productAnalytic: false }, version: 0 }) })
    await ipc('settings_commit', {})
    const persisted = object(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')))
    assert.equal(persisted['model-provider'], JSON.stringify(seed), 'The metadata fixture must reach disk before refresh')
    await browser.refresh()
    await $(HOME).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The real / route did not rehydrate the metadata-only custom provider' })
    await goto(`/settings/providers/${providerName}`)
    await $('[data-testid="add-model-trigger"]').waitForDisplayed({ timeout: 30_000 })
    await browser.waitUntil(() => requests.some(request => request.allowed), { timeout: 30_000, timeoutMsg: 'The actual provider catalog did not GET the owned /v1/models fixture' })
    await goto('/')
    await $(HOME).waitForDisplayed({ timeout: 30_000 })
    await expect($(INPUT)).toHaveValue('')
  })

  for (const size of WINDOWS) {
    it(`keeps home, footer, menu and the profile dialog visible at ${size.width}x${size.height}`, async () => {
      await browser.setWindowSize(size.width, size.height)
      await browser.waitUntil(async () => {
        const actual = await browser.getWindowSize()
        return Math.abs(actual.width - size.width) <= 2 && Math.abs(actual.height - size.height) <= 2
      }, { timeout: 10_000, timeoutMsg: 'The native window did not honor the requested size' })
      await goto('/')
      await $(HOME).waitForDisplayed({ timeout: 30_000 })
      await browser.waitUntil(async () => browser.execute(() => document.fonts.status === 'loaded' && Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)),
        { timeout: 20_000, timeoutMsg: 'Home fonts or actual brand/background assets did not load' })
      const home = await geometry([HOME, COMPOSER, INPUT, PROFILE, '[data-sidebar="footer"]'])
      assert.equal(home.path, '/', 'A temporary chat route cannot prove the empty-home layout')
      assert(home.document.width <= home.viewport.width + 1, 'Home overflows horizontally')
      const welcome = bounds(home, HOME)
      const composer = bounds(home, COMPOSER)
      bounds(home, INPUT)
      const avatar = bounds(home, PROFILE)
      const footer = bounds(home, '[data-sidebar="footer"]')
      assert(welcome.bottom <= composer.top + 1, 'The welcome area overlaps the composer')
      assert(home.viewport.height - composer.bottom <= 40 && composer.top > home.viewport.height * 0.55, 'Composer is not at the bottom of the home viewport')
      assert(home.viewport.height - footer.bottom <= 40 && avatar.top >= footer.top && avatar.bottom <= footer.bottom + 1, 'Profile is not inside the sidebar footer')
      await expect($(INPUT)).toHaveValue('')
      const prefix = `${size.width}x${size.height}`
      captureSettlements.push(await settledScreenshot(join(artifacts, `${prefix}-home.png`)))

      await openProfileMenu()
      const menu = await geometry([MENU])
      bounds(menu, MENU)
      await $(`${MENU} a[href="/settings/general"]`).waitForDisplayed({ timeout: 10_000 })
      assert((await $(MENU).getText()).includes('GitHub'), 'The existing optional GitHub entry is missing')
      captureSettlements.push(await settledScreenshot(join(artifacts, `${prefix}-profile-menu.png`)))
      await clickWhenReady(PROFILE_ITEM)
      await $(DIALOG).waitForDisplayed({ timeout: 10_000 })
      const selectors = [DIALOG, `${DIALOG} [data-slot="dialog-header"]`, `${DIALOG} [data-slot="dialog-title"]`, `${DIALOG} [data-slot="dialog-close"]`, `${DIALOG} [data-slot="dialog-footer"]`, NAME, INITIALS, SAVE, CANCEL]
      const dialog = await geometry(selectors)
      selectors.forEach(selector => bounds(dialog, selector))
      assert(await browser.execute(selector => {
        const dialog = document.querySelector(selector)
        const input = dialog?.querySelector('input')
        return Boolean(input?.id && dialog?.querySelector(`label[for="${input.id}"]`) && dialog.contains(document.activeElement))
      }, DIALOG), 'Profile dialog must label its input and own keyboard focus')
      await expect($(NAME)).toHaveValue(previousProfileName)
      captureSettlements.push(await settledScreenshot(join(artifacts, `${prefix}-profile-dialog.png`)))
      await $(NAME).setValue('Cancelled QA edit')
      await clickWhenReady(CANCEL)
      await $(DIALOG).waitForDisplayed({ reverse: true, timeout: 10_000 })

      await openProfileMenu()
      await clickWhenReady(PROFILE_ITEM)
      await $(DIALOG).waitForDisplayed({ timeout: 10_000 })
      await expect($(NAME)).toHaveValue(previousProfileName)
      const savedName = `QA Layout ${size.width}`
      await $(NAME).setValue(savedName)
      await $(INITIALS).setValue(size.width === 1200 ? 'Q12' : 'Q90')
      await clickWhenReady(SAVE)
      await $(DIALOG).waitForDisplayed({ reverse: true, timeout: 10_000 })
      const stored = await browser.execute(key => localStorage.getItem(key), PROFILE_KEY)
      assert(stored)
      assert.equal(object(JSON.parse(stored)).name, savedName)
      await browser.refresh()
      await $(HOME).waitForDisplayed({ timeout: 60_000 })
      await expect($(PROFILE)).toHaveText(expect.stringContaining(savedName))
      await expect($(INPUT)).toHaveValue('')
      previousProfileName = savedName

      await openProfileMenu()
      await clickWhenReady(`${MENU} a[href="/settings/general"]`)
      await browser.waitUntil(async () => browser.execute(() => window.location.pathname === '/settings/general'), { timeout: 20_000 })
      await goto('/')
      await $(HOME).waitForDisplayed({ timeout: 30_000 })
      assert(requests.every(request => request.allowed), 'An inference or other prohibited fixture endpoint was requested')
      assertNoModelsOrThreads(data)
      observations.push({ requestedNativeWindow: size, actualNativeWindow: await browser.getWindowSize(), home, menu, dialog, checks: ['actual-home-route', 'bottom-composer', 'footer-profile', 'menu-bounds', 'profile-dialog-bounds', 'label-and-focus', 'cancel-preserves-name', 'save-survives-refresh', 'settings-link'], screenshots: [`${prefix}-home.png`, `${prefix}-profile-menu.png`, `${prefix}-profile-dialog.png`] })
      completed += 1
    })
  }

  after(async () => {
    if (server) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()))
    if (artifacts) writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({
      status: completed === WINDOWS.length && requests.every(request => request.allowed) ? 'passed' : 'incomplete-or-failed',
      scope: 'native-layout-with-metadata-only-http-fixture', profile, data, baseUrl, providerName, modelId,
      inferenceImplemented: false, messagesSent: 0, modelRuntimeStartedBySpec: false,
      fixtureRequests: requests, observations, captureSettlements,
      limits: ['No LLM inference, model load, quality or performance acceptance', 'No GitHub login or account action', 'Seed settings are committed to disk; profile re-reading is checked after webview refresh, not process restart', 'Embedded WebDriver synthesizes DOM input; this is not physical keyboard/OS input acceptance', 'Requested sizes are native window bounds; actual webview viewport bounds are recorded separately'],
    }, null, 2))
    assert(requests.every(request => request.allowed), 'The metadata-only server rejected a prohibited request')
  })
})
