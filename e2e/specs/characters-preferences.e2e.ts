import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { $, $$, browser, expect } from '@wdio/globals'
import { clickWhenReady } from '../helpers/interactions.js'
import { goto } from '../helpers/navigation.js'
import { assertNoModelOrChat, object, prepareMetadataProfile, qaIpc } from '../helpers/metadata-profile.js'
import { canonicalPath, containsPath } from '../launch-guard.js'

const CHARACTERS = '[data-testid="characters-dialog"]'
const SELECTOR = '[data-testid="model-selector-trigger"]'
const OPTIONS = '[data-testid="character-options-popover"]'
const CHARACTER_KEY = 'rey30-characters-v1'
const RESET = '//*[@role="dialog"][.//*[@data-slot="dialog-title" and normalize-space(.)="Restablecer configuración"]]'
const button = (name: string, scope = '') => `${scope}//button[normalize-space(.)="${name}"]`
const people = [['kairo', 'Atlas'], ['beto', 'Forja'], ['tino', 'Lince'], ['milo', 'Senda'], ['roco', 'Vértice'], ['nara', 'Nova'], ['centinela', 'Centinela'], ['verso', 'Verso'], ['fullstack', 'Trama']]
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value) ?? 'null').digest('hex')

function installCatalogMetadataFixture(done: (result: { ok: boolean; mechanism?: string; nativeInvokeWritable?: boolean; error?: string }) => void) {
  type Bridge = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
  const target = window as unknown as { fetch: typeof fetch; __TAURI_INTERNALS__: Bridge; __rey30CatalogFixture?: { calls: string[]; blocked: string[]; originalFetch: typeof fetch; probeVerified: boolean } }
  const originalFetch = target.fetch
  const state = { calls: [] as string[], blocked: [] as string[], originalFetch, probeVerified: false }
  target.__rey30CatalogFixture = state
  const probe = '__rey30_catalog_fixture_probe'
  const nonce = crypto.randomUUID()
  // Native invoke is non-writable. Its custom-protocol fetch is the replaceable boundary.
  const replacement: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const command = decodeURIComponent(url.pathname.slice(1))
    const localIpc = url.hostname === 'ipc.localhost' || (url.protocol === 'ipc:' && url.hostname === 'localhost')
    const block = () => {
      state.blocked.push(command)
      return new Response(JSON.stringify('This spec only permits review and inactive OpenClaw setup'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } })
    }
    if (localIpc && ['activate_mcp_server', 'authorize_mcp_server', 'mcp_catalog_configure', 'restart_mcp_servers'].includes(command)) return block()
    if (localIpc && command === 'mcp_catalog_review') {
      try {
        const args = await (input instanceof Request && init?.body === undefined ? input.clone().json() : new Response(init?.body).json())
        if (args.name !== 'io.rey30/openclaw-cli' || args.version !== '1') return block()
      } catch { return block() }
      state.calls.push(command)
    }
    if (localIpc && (command === probe || command === 'mcp_catalog_list')) {
      state.calls.push(command)
      const entries = [
        ['qa/calendar', 'Calendario de prueba', 'Calendar and workspace documents'],
        ['qa/social', 'Red social de prueba', 'Social collaboration'],
        ['qa/payments', 'Pagos de prueba', 'Payments and invoices'],
        ['qa/code', 'Código de prueba', 'Developer code repository'],
        ['qa/database', 'Datos de prueba', 'SQL database search'],
        ['qa/media', 'Multimedia de prueba', 'Video and audio design'],
      ]
      const value = command === probe ? { fixture: nonce } : { servers: entries.map(([name, title, description]) => ({ name, title, description, version: 'qa-fixture', transports: ['stdio'], packages: [], status: 'fixture-metadata-only' })), nextCursor: null }
      return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }))
    }
    return originalFetch.call(window, input, init)
  }
  target.fetch = replacement
  if (target.fetch !== replacement) return done({ ok: false, error: 'The local IPC fetch fixture could not be installed; catalog navigation is blocked' })
  // An unknown command is harmless if the native transport has already fallen back to postMessage.
  // It must resolve through our fixture before any real catalog request can be attempted.
  void target.__TAURI_INTERNALS__.invoke(probe).then(value => {
    if (!value || typeof value !== 'object' || !('fixture' in value) || value.fixture !== nonce || !state.calls.includes(probe)) {
      return done({ ok: false, error: 'The IPC fixture probe did not resolve locally; catalog navigation is blocked' })
    }
    state.probeVerified = true
    done({ ok: true, mechanism: 'tauri-local-ipc-custom-protocol-fetch', nativeInvokeWritable: Object.getOwnPropertyDescriptor(target.__TAURI_INTERNALS__, 'invoke')?.writable === true })
  }, () => done({ ok: false, error: 'The IPC fixture probe failed; catalog navigation is blocked' }))
}

function installNativeAudioGuard(done: (result: { ok: boolean; error?: string }) => void) {
  const target = window as unknown as { fetch: typeof fetch; __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> }; __rey30NativeAudioGuard?: { attempts: string[]; originalFetch: typeof fetch } }
  const originalFetch = target.fetch
  const state = { attempts: [] as string[], originalFetch }
  target.__rey30NativeAudioGuard = state
  const probe = '__rey30_no_audio_fixture_probe'
  const nonce = crypto.randomUUID()
  const replacement: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const command = decodeURIComponent(url.pathname.slice(1))
    const localIpc = url.hostname === 'ipc.localhost' || (url.protocol === 'ipc:' && url.hostname === 'localhost')
    if (localIpc && command === probe) return Promise.resolve(new Response(JSON.stringify({ nonce }), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }))
    if (localIpc && ['character_audio_synthesize', 'character_audio_transcribe'].includes(command)) {
      state.attempts.push(command)
      return Promise.resolve(new Response(JSON.stringify('Native audio execution is prohibited by this metadata-only spec'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }))
    }
    return originalFetch.call(window, input, init)
  }
  target.fetch = replacement
  if (target.fetch !== replacement) return done({ ok: false, error: 'Unable to install the native audio guard' })
  void target.__TAURI_INTERNALS__.invoke(probe).then(value => {
    if (!value || typeof value !== 'object' || !('nonce' in value) || value.nonce !== nonce) return done({ ok: false, error: 'The audio guard probe bypassed the intercepted IPC boundary' })
    done({ ok: true })
  }, () => done({ ok: false, error: 'The native audio guard probe failed; avatar QA is blocked' }))
}

function installMicrophoneAccessGuard() {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) return { installed: false, unavailable: true }
  const target = window as unknown as { __rey30MicrophoneGuard?: { attempts: number; original?: PropertyDescriptor; blocked: typeof media.getUserMedia } }
  const state = { attempts: 0, original: Object.getOwnPropertyDescriptor(media, 'getUserMedia'), blocked: (() => {
    state.attempts += 1
    return Promise.reject(new DOMException('Physical microphone access is prohibited by this metadata-only spec', 'NotAllowedError'))
  }) as typeof media.getUserMedia }
  Object.defineProperty(media, 'getUserMedia', { value: state.blocked, configurable: true, writable: true })
  if (media.getUserMedia !== state.blocked) throw new Error('Unable to guard microphone access; avatar QA is blocked')
  target.__rey30MicrophoneGuard = state
  return { installed: true, unavailable: false }
}

async function characterData() {
  const raw = await qaIpc('settings_get', { key: CHARACTER_KEY })
  return typeof raw === 'string' ? object(JSON.parse(raw)) : undefined
}
async function profile(id: string) {
  const data = await characterData()
  return (data?.profiles as Record<string, unknown>[] | undefined)?.find(item => item.id === id)
}
async function openAssistantSelector() {
  await clickWhenReady('button[aria-label="Seleccionar asistente y modelo"]')
  await clickWhenReady('[data-testid="assistant-selector-tab"]')
}
async function selectAssistant(id: string, name?: string) {
  await openAssistantSelector()
  await clickWhenReady(`[data-testid="assistant-option-${id}"]`)
  await browser.waitUntil(async () => !await $('[data-testid="assistant-selector-tab"]').isDisplayed(), { timeout: 10_000 })
  if (name) await expect($('[data-testid="selected-assistant-name"]')).toHaveText(name)
  if (id === 'model-only') await browser.waitUntil(async () => !await $('[data-testid="selected-assistant-name"]').isExisting(), { timeout: 10_000 })
}
async function setModelBinding(providerId: string, modelId: string) {
  const value = JSON.stringify({ providerId, modelId })
  await browser.execute((selector: string, binding: string) => {
    const root = document.querySelector(selector)
    const label = root && Array.from(root.querySelectorAll('label')).find(item => item.textContent?.trim().startsWith('Modelo del personaje'))
    const select = label?.querySelector('select')
    if (!(select instanceof HTMLSelectElement) || select.disabled) throw new Error('The character model selector is unavailable')
    if (!Array.from(select.options).some(option => option.value === binding && !option.disabled)) throw new Error('The registered metadata model is not an available binding')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    if (!setter) throw new Error('The native select value setter is unavailable')
    setter.call(select, binding)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, CHARACTERS, value)
}
function assertMetadataOnlyData(directory: string, ownedThreads: Set<string>) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    assert(!lstatSync(path).isSymbolicLink(), 'QA data cannot contain links')
    if (entry.isDirectory() && entry.name === 'threads') {
      for (const child of readdirSync(path, { withFileTypes: true })) {
        assert(child.isDirectory() && ownedThreads.has(child.name), 'Unexpected thread outside the explicit empty-thread fixture')
        const thread = join(path, child.name)
        assert(!lstatSync(thread).isSymbolicLink())
        for (const file of readdirSync(thread)) {
          const target = join(thread, file)
          assert(lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink(), 'Unexpected content in metadata-only thread')
          assert(['thread.json', 'messages.jsonl'].includes(file), 'This fixture may persist only empty-thread metadata')
          if (file === 'messages.jsonl') assert.equal(readFileSync(target, 'utf8').trim(), '', 'This spec cannot persist chat messages')
        }
      }
    } else if (entry.isDirectory()) assertNoModelOrChat(path)
    else assert(!/\.(?:gguf|safetensors|onnx|bin)$/i.test(entry.name), 'This spec cannot create or download model weights')
  }
}
async function inspectOrbCssContracts() {
  const styles = await browser.execute(() => {
    const source = document.querySelector('[data-testid="voice-orb-dock"]') as HTMLElement
    const probe = source.cloneNode(true) as HTMLElement
    probe.removeAttribute('data-testid')
    probe.querySelectorAll('[data-testid]').forEach(element => element.removeAttribute('data-testid'))
    probe.setAttribute('aria-hidden', 'true')
    probe.inert = true
    Object.assign(probe.style, { position: 'fixed', left: '-10000px', right: 'auto', top: '0', visibility: 'hidden', pointerEvents: 'none' })
    probe.style.setProperty('--voice-level', '.7')
    const orb = probe.querySelector('.voice-orb') as HTMLElement
    const core = probe.querySelector('.voice-orb-core') as HTMLElement
    orb.style.transition = 'none'
    core.style.transition = 'none'
    const originalDark = document.documentElement.classList.contains('dark')
    const stateBefore = source.dataset.state
    const records = []
    document.body.append(probe)
    try {
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark)
        for (const state of ['idle', 'listening', 'thinking', 'speaking', 'error']) {
          probe.dataset.state = state
          probe.dataset.motion = '1'
          const ring = getComputedStyle(orb)
          const middle = getComputedStyle(core)
          records.push({ dark, state, ring: ring.borderColor, background: ring.backgroundColor, animation: ring.animationName, coreAnimation: middle.animationName, haloAnimation: getComputedStyle(orb, '::before').animationName })
        }
      }
      probe.dataset.state = 'listening'
      probe.dataset.motion = '0'
      const motionOff = { ring: getComputedStyle(orb).animationName, core: getComputedStyle(core).animationName, halo: getComputedStyle(orb, '::before').animationName }
      let reducedMotionRule = false
      const scan = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion: reduce')) {
            for (const child of Array.from(rule.cssRules)) {
              if (child instanceof CSSStyleRule && child.selectorText.includes('.voice-orb') && child.style.animationName === 'none' && child.style.transform === 'none') reducedMotionRule = true
            }
          }
          if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) scan(rule.cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) { try { scan(sheet.cssRules) } catch { /* Cross-origin stylesheets are not the bundled orb stylesheet. */ } }
      return { records, motionOff, reducedMotionRule, actualReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, stateBefore, stateAfter: source.dataset.state, method: 'offscreen DOM clones of real orb CSS; no audio state changed' }
    } finally {
      document.documentElement.classList.toggle('dark', originalDark)
      probe.remove()
    }
  })
  for (const dark of [false, true]) assert.equal(new Set(styles.records.filter(item => item.dark === dark).map(item => item.ring)).size, 5, 'Each declared audio state needs a distinct ring color')
  const idle = styles.records.filter(item => item.state === 'idle')
  assert.notEqual(idle[0].background, idle[1].background, 'The orb must follow the light and dark theme background')
  assert.notEqual(idle[0].ring, idle[1].ring, 'The idle ring must follow theme contrast tokens')
  assert.deepEqual(styles.motionOff, { ring: 'none', core: 'none', halo: 'none' })
  assert.equal(styles.reducedMotionRule, true, 'The loaded stylesheet must include reduced-motion overrides')
  assert.equal(styles.stateBefore, styles.stateAfter, 'CSS probes must not fake a live audio state')
  return styles
}
async function capture(file: string, selectors: string[] = []) {
  await browser.waitUntil(() => browser.executeAsync<boolean, []>(done => {
    const moving = () => document.getAnimations().some(animation => animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime) && (animation.playState === 'running' || animation.pending))
    if (moving()) return done(false)
    requestAnimationFrame(() => requestAnimationFrame(() => done(!moving())))
  }), { timeout: 10_000, interval: 50 })
  const layout = await browser.execute((list: string[]) => ({
    viewport: { width: innerWidth, height: innerHeight },
    controls: list.map(selector => {
      const element = document.querySelector(selector)
      const r = element?.getBoundingClientRect()
      return { selector, rect: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null }
    }),
  }), selectors)
  for (const { selector, rect } of layout.controls) {
    assert(rect && rect.width > 0 && rect.height > 0, `Missing native control: ${selector}`)
    assert(rect.left >= -1 && rect.top >= -1 && rect.right <= layout.viewport.width + 1 && rect.bottom <= layout.viewport.height + 1, `Native control outside viewport: ${selector}`)
  }
  await browser.saveScreenshot(file)
  return { file, waitedForFiniteAnimations: true, settledFrames: 2, ...layout }
}

describe('native characters, scoped preference recovery and catalog UI without inference', () => {
  let fixture: Awaited<ReturnType<typeof prepareMetadataProfile>> | undefined
  let artifacts: string | undefined
  let appVersion: unknown
  let nativeBinary: { path: string; sha256: string } | undefined
  let nativeAudioGuard: { ok: boolean; error?: string } | undefined
  let microphoneGuard: { installed: boolean; unavailable: boolean } | undefined
  let completed = 0
  const observations: unknown[] = []
  const captures: unknown[] = []
  const ownedThreads = new Set<string>()

  before(async () => {
    fixture = await prepareMetadataProfile()
    const repo = canonicalPath(resolve(import.meta.dirname, '../..'))
    const output = canonicalPath(join(repo, 'artifacts', 'qa', 'characters-preferences-e2e'))
    assert(containsPath(repo, output))
    mkdirSync(output, { recursive: true })
    artifacts = mkdtempSync(join(output, 'run-'))
    appVersion = await qaIpc('plugin:app|version')
    assert.equal(appVersion, object(JSON.parse(readFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8'))).version, 'Native app must match the current source version')
    const binary = join(repo, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'Rey30-IDvj.exe' : 'Rey30-IDvj')
    nativeBinary = { path: binary, sha256: createHash('sha256').update(readFileSync(binary)).digest('hex') }
    nativeAudioGuard = await browser.executeAsync(installNativeAudioGuard)
    assert(nativeAudioGuard.ok, nativeAudioGuard.error)
    microphoneGuard = await browser.execute(installMicrophoneAccessGuard)
    await browser.setWindowSize(1200, 800)
  })

  it('lists ten integrated assistants, preserves the original and restricts Pluma to native local models', async () => {
    await goto('/settings/assistant')
    await browser.waitUntil(async () => await $$('[data-testid="assistant-character-row"]').length === people.length + 1, { timeout: 20_000 })
    const plumaRow = '[data-testid="assistant-character-row"][data-character-id="literatura"]'
    await clickWhenReady(`${plumaRow} button[aria-label="Editar Pluma"]`)
    await $(CHARACTERS).waitForDisplayed({ timeout: 10_000 })
    await expect($('[aria-label="Biblioteca literaria"]')).toHaveText(expect.stringContaining('D:\\Libreria General'))
    const plumaModels = await browser.execute(() => {
      const field = Array.from(document.querySelectorAll('[data-testid="characters-dialog"] label')).find((label) => label.textContent?.startsWith('Modelo del personaje'))
      return Array.from(field?.querySelectorAll('option') ?? [], (option) => option.value)
    })
    assert(plumaModels.length > 0 && plumaModels.includes(''))
    assert(!plumaModels.some((model) => model.includes(fixture!.providerName)), 'Pluma cannot bind to the test HTTP provider')
    if (process.platform === 'win32' && existsSync('D:\\Libreria General')) {
      const library = object(await qaIpc('literary_library_status', { refresh: false }))
      assert.equal(library.root, 'D:\\Libreria General')
      assert.equal(library.indexed, false)
    }
    await clickWhenReady(button('Cerrar editor', '//*[@data-testid="characters-dialog"]'))
    await $(CHARACTERS).waitForDisplayed({ reverse: true, timeout: 10_000 })
    const bindings = []
    for (const [id, name] of people) {
      const row = `[data-testid="assistant-character-row"][data-character-id="${id}"]`
      await expect($(row)).toHaveText(expect.stringContaining(name))
      await clickWhenReady(`${row} button[aria-label="Editar ${name}"]`)
      await $(CHARACTERS).waitForDisplayed({ timeout: 10_000 })
      await setModelBinding(fixture!.providerName, fixture!.modelId)
      await clickWhenReady(button('Guardar cambios', '//*[@data-testid="characters-dialog"]'))
      await browser.waitUntil(async () => {
        const binding = object((await profile(id))?.modelBinding)
        return binding.providerId === fixture!.providerName && binding.modelId === fixture!.modelId
      }, { timeout: 10_000 })
      assert.equal(object((await profile(id))?.voice).enabled, false, 'Editing or binding a character must not start speech')
      await clickWhenReady(button('Cerrar editor', '//*[@data-testid="characters-dialog"]'))
      await $(CHARACTERS).waitForDisplayed({ reverse: true, timeout: 10_000 })
      bindings.push({ id, name, provider: fixture!.providerName, model: fixture!.modelId })
    }
    captures.push(await capture(join(artifacts!, 'assistants-ten-specialists-1200.png')))
    await goto('/')
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 20_000 })
    const verse = '[data-testid="sidebar-assistant-character:verso"] button'
    await expect($(verse)).toHaveText(expect.stringContaining('Solo voz'))
    await clickWhenReady(verse)
    await expect($('[data-testid="selected-assistant-name"]')).toHaveText('Verso')
    await $('[data-testid="voice-orb-dock"]').waitForDisplayed({ timeout: 10_000 })
    await expect($('[data-testid="voice-orb-dock"]')).toHaveAttribute('data-state', 'idle')
    captures.push(await capture(join(artifacts!, 'sidebar-specialists-1200.png'), [SELECTOR, verse]))
    await openAssistantSelector()
    await expect($('[data-testid="assistant-option-jan"]')).toHaveText(expect.stringContaining('Rey30 IDvj'))
    for (const [id, name] of people) await expect($(`[data-testid="assistant-option-character:${id}"]`)).toHaveText(expect.stringContaining(name))
    await expect($('[data-testid="assistant-option-character:literatura"]')).toHaveText(expect.stringContaining('Pluma'))
    captures.push(await capture(join(artifacts!, 'upper-assistant-selector-1200.png'), [SELECTOR, '[data-testid="assistant-selector-tab"]']))
    await browser.keys('Escape')
    for (const [id, name] of people) {
      await selectAssistant(`character:${id}`, name)
      await expect($(SELECTOR)).toHaveText(expect.stringContaining('QA METADATA — NO INFERENCE'))
      const raw = await qaIpc('settings_get', { key: 'model-provider' })
      assert.equal(typeof raw, 'string')
      const selection = object(object(JSON.parse(raw as string)).state)
      assert.equal(selection.selectedProvider, fixture!.providerName)
      assert.equal(object(selection.selectedModel).id, fixture!.modelId)
    }
    await selectAssistant('jan', 'Rey30 IDvj')
    await openAssistantSelector()
    await expect($('[data-testid="assistant-option-jan"]')).toHaveAttribute('aria-pressed', 'true')
    await browser.keys('Escape')
    await selectAssistant('model-only')
    await openAssistantSelector()
    await expect($('[data-testid="assistant-option-model-only"]')).toHaveAttribute('aria-pressed', 'true')
    await browser.keys('Escape')
    await selectAssistant('character:nara', 'Nova')
    observations.push({ scope: 'native-integrated-assistants-and-configured-metadata-bindings', originalAssistantPreserved: true, bindings, selectedFromUpperSelector: true, normalAndModelOnlySeparated: true })
    completed += 1
  })

  it('keeps independent voice settings and a corner orb without covering chat or sending controls', async () => {
    await clickWhenReady('[data-testid="character-options-trigger"]')
    await $(OPTIONS).waitForDisplayed({ timeout: 10_000 })
    await expect($('[data-testid="voice-orb-open"]')).toHaveText('Activar voz')
    await $('[data-testid="voice-orb-open"]').waitForEnabled({ timeout: 10_000 })
    assert.equal(object((await profile('nara'))?.avatar).enabled, true)
    await clickWhenReady(button('Indicador visible', '//*[@data-testid="character-options-popover"]'))
    await browser.waitUntil(async () => object((await profile('nara'))?.avatar).enabled === false, { timeout: 10_000 })
    assert.equal(await $(button('Animación activada', '//*[@data-testid="character-options-popover"]')).isEnabled(), false)
    await clickWhenReady(button('Indicador oculto', '//*[@data-testid="character-options-popover"]'))
    await browser.waitUntil(async () => object((await profile('nara'))?.avatar).enabled === true, { timeout: 10_000 })
    await clickWhenReady(button('Animación activada', '//*[@data-testid="character-options-popover"]'))
    await browser.waitUntil(async () => object((await profile('nara'))?.avatar).motion === 0, { timeout: 10_000 })
    assert.equal(object((await profile('nara'))?.voice).enabled, false)
    await clickWhenReady(button('Animación desactivada', '//*[@data-testid="character-options-popover"]'))
    await browser.waitUntil(async () => object((await profile('nara'))?.avatar).motion === 1, { timeout: 10_000 })
    await browser.keys('Escape')
    await goto('/settings/assistant')
    await clickWhenReady('[data-testid="assistant-character-row"][data-character-id="nara"] button[aria-label="Editar Nova"]')
    await $(CHARACTERS).waitForDisplayed({ timeout: 10_000 })
    await clickWhenReady(button('Voz', '//*[@data-testid="characters-dialog"]'))
    await browser.execute(() => {
      const root = document.querySelector('[data-testid="characters-dialog"]')!
      const label = Array.from(root.querySelectorAll('label')).find(item => item.textContent?.trim().startsWith('Volumen'))
      const input = label?.querySelector('input')
      if (!(input instanceof HTMLInputElement) || input.type !== 'range' || input.disabled) throw new Error('Voice volume is not an editable range control')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) throw new Error('The native range value setter is unavailable')
      setter.call(input, '0.65')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await clickWhenReady(button('Guardar cambios', '//*[@data-testid="characters-dialog"]'))
    await browser.waitUntil(async () => object((await profile('nara'))?.voice).volume === 0.65, { timeout: 10_000 })
    assert.equal(object((await profile('nara'))?.voice).enabled, false, 'Saving voice settings must not activate a voice session')
    await clickWhenReady(button('Cerrar editor', '//*[@data-testid="characters-dialog"]'))
    await goto('/')
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 20_000 })
    for (const [width, height] of [[1200, 800], [900, 650]]) {
      await browser.setWindowSize(width, height)
      const fixedCards = await browser.execute(() => Array.from(document.querySelectorAll('[data-testid="character-panel"]')).filter(element => !element.closest('[role="dialog"], [data-testid="character-options-popover"]')).length)
      assert.equal(fixedCards, 0, 'The chat must not contain the former fixed character card')
      await $('[data-testid="voice-orb-dock"]').waitForDisplayed({ timeout: 10_000 })
      await expect($('[data-testid="voice-orb-dock"]')).toHaveAttribute('data-state', 'idle')
      await expect($('[data-testid="voice-orb-toggle"]')).toHaveAttribute('aria-label', 'Iniciar voz')
      await $('[data-testid="voice-orb-toggle"]').waitForEnabled({ timeout: 20_000 })
      await $('[data-testid="chat-input"]').setValue('Borrador local de QA: no enviar.')
      await $('[data-testid="send-message-button"]').waitForEnabled({ timeout: 10_000 })
      const geometry = await browser.execute(() => {
        const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
        return { orb: rect('[data-testid="voice-orb-dock"]'), sphere: rect('[data-testid="voice-orb-toggle"]'), input: rect('[data-testid="chat-input"]'), send: rect('[data-testid="send-message-button"]'), viewport: { width: innerWidth, height: innerHeight }, canvases: document.querySelectorAll('canvas').length, fullscreenDialogs: document.querySelectorAll('[data-testid="avatar-voice-dialog"]').length }
      })
      const overlaps = (a: typeof geometry.orb, b: typeof geometry.orb) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      assert(geometry.orb.width <= 180 && geometry.orb.height <= 100 && geometry.orb.top >= 48 && geometry.viewport.width - geometry.orb.right <= 32, 'The orb must remain a compact corner control below the header')
      assert(Math.abs(geometry.sphere.width - 64) <= 1 && Math.abs(geometry.sphere.height - 64) <= 1, 'The voice sphere must keep its 64px control size')
      assert(!overlaps(geometry.orb, geometry.input) && !overlaps(geometry.orb, geometry.send), 'The orb must not cover typing or sending')
      assert.equal(geometry.canvases, 0, 'The selected orb UI must not load a 3D canvas')
      assert.equal(geometry.fullscreenDialogs, 0, 'The orb must not open the cancelled fullscreen UI')
      captures.push(await capture(join(artifacts!, `voice-orb-chat-${width}.png`), ['[data-testid="home-composer-shell"]', SELECTOR, '[data-testid="voice-orb-dock"]', '[data-testid="chat-input"]', '[data-testid="send-message-button"]']))
      await $('[data-testid="chat-input"]').clearValue()
      await clickWhenReady('[data-testid="voice-orb-options"]')
      await expect($('[data-testid="voice-orb-status"]')).toHaveText('Micrófono apagado')
      await clickWhenReady('[data-testid="voice-orb-exit"]')
      await browser.keys('Escape')
      await expect($('[data-testid="selected-assistant-name"]')).toHaveText('Nova')
      assert.equal(object((await profile('nara'))?.voice).enabled, false, 'Solo chat must leave automatic voice disabled')
      observations.push({ scope: 'native-idle-orb-layout-and-unsent-draft', requestedWindow: { width, height }, geometry, voiceStartClicked: false })
      await goto('/settings/assistant')
      await clickWhenReady('[data-testid="assistant-character-row"][data-character-id="nara"] button[aria-label="Editar Nova"]')
      await $(CHARACTERS).waitForDisplayed({ timeout: 10_000 })
      captures.push(await capture(join(artifacts!, `characters-dialog-${width}.png`), [CHARACTERS, `${CHARACTERS} [data-slot="dialog-header"]`, `${CHARACTERS} [data-slot="dialog-footer"]`]))
      await clickWhenReady(button('Cerrar editor', '//*[@data-testid="characters-dialog"]'))
      await $(CHARACTERS).waitForDisplayed({ reverse: true, timeout: 10_000 })
      await goto('/')
      await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 20_000 })
    }
    await expect($('[data-testid="chat-input"]')).toHaveValue('')
    observations.push({ scope: 'native-orb-css-contracts-only', ...await inspectOrbCssContracts() })
    const microphoneAttempts = await browser.execute(() => (window as unknown as { __rey30MicrophoneGuard?: { attempts: number } }).__rey30MicrophoneGuard?.attempts ?? 0)
    const nativeAudioAttempts = await browser.execute(() => (window as unknown as { __rey30NativeAudioGuard: { attempts: string[] } }).__rey30NativeAudioGuard.attempts)
    assert.equal(microphoneAttempts, 0, 'Idle orb and settings must not request microphone access')
    assert.deepEqual(nativeAudioAttempts, [], 'Idle orb and settings must not request synthesis or transcription')
    observations.push({ scope: 'native-on-demand-character-options', independentVoiceAvatarMotion: true, fixedCentralCard: false, microphoneGuard, microphoneAttempts, nativeAudioGuard, nativeAudioAttempts })
    completed += 1
  })

  it('persists the selected character and model in one empty native thread and separates normal assistant and model-only', async () => {
    const created = object(await qaIpc('create_thread', { thread: {
      object: 'thread', title: 'QA EMPTY — ASSISTANT BINDING, NO MESSAGES', created: Date.now() / 1000, updated: Date.now() / 1000,
      assistants: [{ id: 'jan', name: 'Rey30 IDvj', instructions: '', parameters: {}, model: { id: fixture!.modelId, engine: fixture!.providerName } }],
      metadata: { qaMetadataOnly: true },
    } }))
    const id = created.id
    assert.equal(typeof id, 'string')
    assert.match(id as string, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
    ownedThreads.add(id as string)
    const thread = async () => {
      const all = await qaIpc('list_threads')
      assert(Array.isArray(all))
      const found = all.find(item => object(item).id === id)
      assert(found, 'The owned empty thread must remain persisted')
      return object(found)
    }
    const assertAssistant = async (assistantId: string) => {
      const stored = await thread()
      const first = (stored.assistants as unknown[] | undefined)?.[0]
      const assistant = first ? object(first) : undefined
      assert.equal(assistant?.id ?? 'model-only', assistantId)
      const model = object(assistant?.model ?? stored.model)
      assert.equal(model.id, fixture!.modelId)
      assert.equal(model.engine ?? model.provider, fixture!.providerName)
      assert.deepEqual(await qaIpc('list_messages', { threadId: id }), [])
      return stored
    }
    await browser.refresh()
    await goto(`/threads/${id}`)
    await $('[data-testid="chat-input"]').waitForDisplayed({ timeout: 20_000 })
    await selectAssistant('character:kairo', 'Atlas')
    await browser.waitUntil(async () => ((await thread()).assistants as { id: string }[] | undefined)?.[0]?.id === 'character:kairo', { timeout: 10_000 })
    await assertAssistant('character:kairo')
    await goto('/')
    await $('[data-testid="home-welcome"]').waitForDisplayed({ timeout: 20_000 })
    await selectAssistant('character:nara', 'Nova')
    const atlasChat = '[data-testid="sidebar-assistant-character:kairo"] a'
    await expect($(atlasChat)).toHaveAttribute('href', `/threads/${id}`)
    await clickWhenReady(atlasChat)
    await expect($(SELECTOR)).toHaveText(expect.stringContaining('Atlas'))
    await browser.refresh()
    await expect($(SELECTOR)).toHaveText(expect.stringContaining('Atlas'))
    const persisted = await assertAssistant('character:kairo')
    const disk = object(JSON.parse(readFileSync(join(fixture!.data, 'threads', id as string, 'thread.json'), 'utf8')))
    assert.deepEqual(disk.assistants, persisted.assistants, 'The character/model combination must reach native storage')
    await selectAssistant('jan', 'Rey30 IDvj')
    await browser.waitUntil(async () => ((await thread()).assistants as { id: string }[] | undefined)?.[0]?.id === 'jan', { timeout: 10_000 })
    await assertAssistant('jan')
    await selectAssistant('model-only')
    await browser.waitUntil(async () => {
      const assistants = (await thread()).assistants as { id: string }[] | undefined
      return !assistants?.length || assistants[0].id === 'model-only'
    }, { timeout: 10_000 })
    await assertAssistant('model-only')
    await browser.refresh()
    await browser.waitUntil(async () => !await $('[data-testid="selected-assistant-name"]').isExisting(), { timeout: 10_000 })
    await openAssistantSelector()
    await expect($('[data-testid="assistant-option-model-only"]')).toHaveAttribute('aria-pressed', 'true')
    await browser.keys('Escape')
    for (const [, name] of people) assert(!(await $(SELECTOR).getText()).includes(name), 'Model-only must remain free of character identity after reload')
    await assertAssistant('model-only')
    const current = await thread()
    const previousMetadata = object(current.metadata)
    await qaIpc('modify_thread', { thread: { ...current, metadata: { ...previousMetadata, literaryLibrary: true } } })
    await qaIpc('modify_thread', { thread: { ...current, title: 'QA STALE RENAME', metadata: previousMetadata } })
    const renamed = await thread()
    assert.equal(renamed.title, 'QA STALE RENAME')
    assert.equal(object(renamed.metadata).literaryLibrary, true, 'Native thread storage must retain the library privacy marker')
    observations.push({ scope: 'native-empty-thread-assistant-model-persistence', threadId: id, messages: 0, persistedCharacter: 'character:kairo', independentHomeSelection: 'character:nara', resumedFromSidebar: true, normalAssistant: 'jan', finalSelection: 'model-only' })
    await goto('/')
    completed += 1
  })

  it('restores defaults without a point and a saved point afterwards, preserving models, characters and MCP', async () => {
    await browser.setWindowSize(1200, 800)
    const charactersBefore = await qaIpc('settings_get', { key: CHARACTER_KEY })
    const providerBefore = await qaIpc('settings_get', { key: 'model-provider' })
    const mcpPath = join(fixture!.data, 'mcp_config.json')
    const mcpBefore = existsSync(mcpPath) ? hash(readFileSync(mcpPath, 'utf8')) : null
    await goto('/settings/general')
    await clickWhenReady('//button[normalize-space(.)="Restablecer configuración" and not(ancestor::*[@role="dialog"]) ]')
    await $(RESET).waitForDisplayed({ timeout: 15_000 })
    await browser.waitUntil(async () => (await $(RESET).getText()).includes('No hay un punto guardado; se usarán los valores predeterminados en español.'), { timeout: 10_000 })
    const resetButton = button('Restablecer configuración', RESET)
    await $(resetButton).waitForEnabled({ timeout: 10_000 })
    captures.push(await capture(join(artifacts!, 'reset-without-point.png'), ['[role="dialog"]', '[role="dialog"] [data-slot="dialog-footer"]']))
    await clickWhenReady(resetButton)
    await browser.waitUntil(async () => (await $(RESET).getText()).includes('Configuración restablecida a los valores predeterminados en español. Tus recursos se conservan.'), { timeout: 15_000 })
    const general = async () => object(object(JSON.parse(await qaIpc('settings_get', { key: 'setting-general' }) as string)).state)
    assert.equal((await general()).currentLanguage, 'es')
    assert.equal((await general()).spellCheckChatInput, true)
    await clickWhenReady(button('Deshacer último restablecimiento', RESET))
    await browser.waitUntil(async () => (await general()).spellCheckChatInput === false, { timeout: 10_000 })
    await clickWhenReady(button('Guardar punto de configuración', RESET))
    await browser.waitUntil(async () => (await $(RESET).getText()).includes('Punto de configuración guardado.'), { timeout: 15_000 })
    const savedPoint = await qaIpc('settings_get', { key: 'preferences-recovery-point-v1' })
    assert.equal(typeof savedPoint, 'string')
    const values = object(object(JSON.parse(savedPoint as string)).values)
    assert.deepEqual(Object.keys(values).sort(), ['setting-appearance', 'setting-general', 'theme'])
    assert.equal(object(values['setting-general']).spellCheckChatInput, false)
    await clickWhenReady(button('Usar valores predeterminados (español)', RESET))
    await browser.waitUntil(async () => (await general()).spellCheckChatInput === true, { timeout: 15_000 })
    assert.equal(await qaIpc('settings_get', { key: 'preferences-recovery-point-v1' }), savedPoint)
    await clickWhenReady(resetButton)
    await browser.waitUntil(async () => (await $(RESET).getText()).includes('Configuración restablecida desde el punto guardado. Tus recursos se conservan.'), { timeout: 15_000 })
    assert.equal((await general()).spellCheckChatInput, false)
    const disk = object(JSON.parse(readFileSync(join(fixture!.data, 'settings.json'), 'utf8')))
    assert.equal(object(object(JSON.parse(disk['setting-general'] as string)).state).spellCheckChatInput, false, 'The restored preference must reach disk')
    captures.push(await capture(join(artifacts!, 'reset-saved-point-restored.png'), ['[role="dialog"]', '[role="dialog"] [data-slot="dialog-footer"]']))
    assert.equal(await qaIpc('settings_get', { key: CHARACTER_KEY }), charactersBefore)
    assert.equal(await qaIpc('settings_get', { key: 'model-provider' }), providerBefore)
    assert.equal(existsSync(mcpPath) ? hash(readFileSync(mcpPath, 'utf8')) : null, mcpBefore)
    await clickWhenReady(`${RESET}//*[@data-slot="dialog-footer"]//button[normalize-space(.)="Cerrar"]`)
    observations.push({ scope: 'actual-native-preference-recovery', noPointDefaults: true, undo: true, savedPoint: true, restoredSpellCheck: false, preservedCharactersHash: hash(charactersBefore), preservedProviderHash: hash(providerBefore), preservedMcpHash: mcpBefore })
    completed += 1
  })

  it('shows catalog fixture categories and saves the official OpenClaw bridge inactive', async () => {
    const intercepted = await browser.executeAsync(installCatalogMetadataFixture)
    assert(intercepted.ok, intercepted.error)
    observations.push({ scope: 'catalog-fixture-preflight', ...intercepted })
    await goto('/settings/mcp-servers')
    const catalog = '[data-testid="mcp-catalog-browser"]'
    await $(catalog).waitForDisplayed({ timeout: 20_000 })
    const cardCount = () => browser.execute(() => document.querySelectorAll('[data-testid="mcp-registry-card"]').length)
    await browser.waitUntil(async () => await cardCount() === 6, { timeout: 15_000 })
    const categories = await browser.execute(selector => Array.from(document.querySelector(selector)!.querySelectorAll('option'), option => option.value), `${catalog} select`)
    assert.deepEqual(categories.sort(), ['all', 'commerce', 'data', 'development', 'media', 'social', 'workspaces'])
    const selectionInput = await browser.execute((selector: string, value: string) => {
      const select = document.querySelector(selector)
      if (!(select instanceof HTMLSelectElement) || select.disabled) throw new Error('The category select is not available')
      if (!Array.from(select.options).some(option => option.value === value && !option.disabled)) throw new Error('The requested category option is not available')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      if (!setter) throw new Error('The native select value setter is unavailable')
      const before = select.value
      setter.call(select, value)
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return { method: 'native-select-value-setter-and-bubbling-input-change', before, after: select.value }
    }, `${catalog} select`, 'development')
    assert.equal(selectionInput.after, 'development')
    await browser.waitUntil(async () => await cardCount() === 1, { timeout: 10_000 })
    await expect($('[data-testid="mcp-registry-card"]')).toHaveText(expect.stringContaining('Código de prueba'))
    captures.push(await capture(join(artifacts!, 'mcp-categories-declared-fixture.png'), [catalog]))
    const calls = await browser.execute(() => (window as unknown as { __rey30CatalogFixture: { calls: string[] } }).__rey30CatalogFixture.calls.filter(command => command === 'mcp_catalog_list'))
    assert(calls.length > 0)
    const mcpPath = join(fixture!.data, 'mcp_config.json')
    const readMcp = () => existsSync(mcpPath)
      ? object(JSON.parse(readFileSync(mcpPath, 'utf8')))
      : { mcpServers: {} }
    const before = readMcp()
    const { mcpServers: beforeServers, ...beforeSettings } = before
    assert(!Object.hasOwn(object(beforeServers), 'openclaw'))
    assert(Object.values(object(beforeServers)).every(value => object(value).active !== true))
    await clickWhenReady(button('Configurar OpenClaw'))
    const review = '[data-testid="mcp-catalog-review"]'
    await $(review).waitForDisplayed({ timeout: 10_000 })
    await expect($(review)).toHaveText(expect.stringContaining('Puente local por stdio'))
    assert.deepEqual(readMcp(), before, 'Review must not modify the configuration')
    await clickWhenReady(button('Guardar puente inactivo'))
    await $('[data-testid="mcp-catalog-installed"]').waitForDisplayed({ timeout: 10_000 })
    const { mcpServers, ...settings } = readMcp()
    const { openclaw, ...previousServers } = object(mcpServers)
    assert.deepEqual(settings, beforeSettings)
    assert.deepEqual(previousServers, object(beforeServers))
    const bridge = object(openclaw)
    assert.equal(bridge.type, 'stdio')
    assert.equal(bridge.command, process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw')
    assert.deepEqual(bridge.args, ['mcp', 'serve', '--claude-channel-mode', 'off'])
    assert.deepEqual(bridge.env, {})
    assert.equal(bridge.active, false)
    const trace = await browser.execute(() => {
      const catalogFixture = (window as unknown as { __rey30CatalogFixture: { calls: string[]; blocked: string[] } }).__rey30CatalogFixture
      return { calls: catalogFixture.calls, blocked: catalogFixture.blocked }
    })
    assert.deepEqual(trace.blocked, [])
    assert.equal(trace.calls.filter(command => command === 'mcp_catalog_review').length, 1)
    observations.push({ scope: 'native-catalog-ui-with-intercepted-metadata-only-ipc', metadataFixtureCalls: calls.length, categories, selectionInput, servicesConnectedBySpec: 0, externalRegistryVerified: false, openClawBridgeSavedInactive: true, preservedOtherMcpServers: true, preservedMcpSettings: true })
    completed += 1
  })

  after(async () => {
    if (fixture) await fixture.close()
    let safetyError: unknown
    if (fixture) {
      try {
        assert(fixture.requests.every(request => request.allowed), 'The metadata provider received a prohibited request')
        for (const threadId of ownedThreads) assert.deepEqual(await qaIpc('list_messages', { threadId }), [])
        assertMetadataOnlyData(fixture.data, ownedThreads)
      } catch (error) { safetyError = error }
    }
    if (artifacts) writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({
      status: completed === 5 && fixture && !safetyError ? 'passed' : 'incomplete-or-failed',
      appVersion, nativeBinary, profile: fixture?.profile, data: fixture?.data, fixtureRequests: fixture?.requests,
      metadataOnlySafetyVerified: !!fixture && !safetyError,
      inferenceImplemented: false, messagesSent: 0, modelRuntimeStartedBySpec: false, microphoneOpenedBySpec: false, audioRequestedBySpec: false,
      ownedEmptyThreads: [...ownedThreads], observations, captures,
      limits: ['No model inference, quality or personality-response acceptance', 'No actual audio synthesis or microphone test', 'MCP categories use an explicitly intercepted metadata fixture, not a live registry integration', 'Native OpenClaw review and inactive configuration save are real. No package install, login, Gateway startup or service connection is requested', 'WebDriver synthesizes DOM input; no physical-input acceptance'],
    }, null, 2))
    await browser.execute(() => {
      const target = window as unknown as { fetch: typeof fetch; __rey30CatalogFixture?: { originalFetch: typeof fetch } }
      if (target.__rey30CatalogFixture) target.fetch = target.__rey30CatalogFixture.originalFetch
      delete target.__rey30CatalogFixture
      const audioTarget = window as unknown as { __rey30NativeAudioGuard?: { originalFetch: typeof fetch } }
      if (audioTarget.__rey30NativeAudioGuard) window.fetch = audioTarget.__rey30NativeAudioGuard.originalFetch
      delete audioTarget.__rey30NativeAudioGuard
      const micTarget = window as unknown as { __rey30MicrophoneGuard?: { original?: PropertyDescriptor } }
      if (micTarget.__rey30MicrophoneGuard && navigator.mediaDevices) {
        if (micTarget.__rey30MicrophoneGuard.original) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', micTarget.__rey30MicrophoneGuard.original)
        else delete (navigator.mediaDevices as { getUserMedia?: unknown }).getUserMedia
      }
      delete micTarget.__rey30MicrophoneGuard
    }).catch(() => {})
    if (safetyError) throw safetyError
  })
})
