import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { browser, expect, $, $$ } from '@wdio/globals'

import { TEMPORARY_CHAT_ID, SESSION_STORAGE_KEY, SESSION_STORAGE_PREFIX } from '../../web-app/src/constants/chat.js'
import { route } from '../../web-app/src/constants/routes.js'

import { clickWhenReady } from '../helpers/interactions.js'
import { goto } from '../helpers/navigation.js'
import { rey30DataDir, rey30UserDataDir } from '../helpers/paths.js'
import {
  assertSafeE2eHome,
  canonicalPath,
  containsPath,
  launchContext,
} from '../launch-guard.js'

// Opt-in with --spec; deliberately absent from wdio.conf.ts's default suite.
const DIALOG = '[data-testid="resource-import-dialog"]'
const OPEN_IMPORT = '//button[normalize-space(.)="Import resources" or normalize-space(.)="Importar recursos"]'
const HUB = 'a[href="/hub/"], a[href="/hub"]'
const INPUT = '[data-testid="resource-import-local-path"]'
const ANALYZE = '[data-testid="resource-import-analyze-path"]'
const PLAN = '[data-testid="resource-import-plan"]'
const CONNECT = '[data-testid="resource-import-connect-mcp"]'
const COMMIT = '[data-testid="resource-import-commit"]'
const RECEIPT = '[data-testid="resource-import-receipt"]'
const TOOL = 'resource_import_e2e_probe'

type JsonObject = Record<string, unknown>
type StoredConfig = JsonObject & { mcpServers: Record<string, JsonObject> }
type AuditEvent = { event: string; method?: string; protocolVersion?: string; tool?: string; nonce?: string; pid?: number }
type SkillInvocationArgs = { dataFolder: string; name: string; args: string }
type SkillInvocationResult = { ok: boolean; listedName?: string; raw?: string; message?: string; error?: string }

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function readConfig(path: string): StoredConfig {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  assert(value && typeof value === 'object' && !Array.isArray(value), 'MCP configuration must be an object')
  const servers = (value as JsonObject).mcpServers
  assert(servers && typeof servers === 'object' && !Array.isArray(servers), 'mcpServers must be an object')
  return value as StoredConfig
}

function manifest(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const info = lstatSync(path)
      assert(!info.isSymbolicLink(), 'A fixture source unexpectedly contains a link')
      if (info.isDirectory()) visit(path)
      else {
        assert(info.isFile(), 'A fixture source unexpectedly contains a non-regular file')
        result[relative(root, path).replaceAll('\\', '/')] = hash(readFileSync(path))
      }
    }
  }
  visit(root)
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}

function audit(path: string): AuditEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as AuditEvent)
}

function candidate(name: string, kind: 'skill' | 'agent' | 'mcp'): string {
  return `[data-testid="resource-import-candidate"][data-resource-kind="${kind}"][data-resource-name="${name}"]`
}

async function assertDialogViewport() {
  const layout = await browser.execute(selector => {
    const dialog = document.querySelector(selector)
    const slots = ['dialog-header', 'dialog-title', 'dialog-close', 'dialog-footer']
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      controls: slots.map(slot => {
        const node = dialog?.querySelector(`[data-slot="${slot}"]`)
        if (!node) return { slot, rect: null }
        const rect = node.getBoundingClientRect()
        return { slot, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } }
      }),
    }
  }, DIALOG)
  for (const { slot, rect } of layout.controls) {
    assert(rect && rect.width > 0 && rect.height > 0, `Import dialog control has no visible bounds: ${slot}`)
    assert(rect.left >= -1 && rect.top >= -1 && rect.right <= layout.viewport.width + 1 && rect.bottom <= layout.viewport.height + 1,
      `Import dialog ${slot} is clipped outside the native viewport`)
    await $(`${DIALOG} [data-slot="${slot}"]`).waitForDisplayed({ timeout: 10_000 })
  }
  return layout
}

// This is an actual MCP stdio server, executed by the application after UI
// consent. It has no HTTP client, dependency installation, or third-party code.
const SERVER_SOURCE = `import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [auditPath, nonce] = process.argv.slice(2)
const record = value => appendFileSync(auditPath, JSON.stringify({ ...value, nonce, pid: process.pid }) + '\\n')
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
record({ event: 'started' })
const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
input.on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') return
  record({ event: 'request', method: request.method, protocolVersion: request.params?.protocolVersion })
  if (!Object.prototype.hasOwnProperty.call(request, 'id')) return
  const reply = result => send({ jsonrpc: '2.0', id: request.id, result })
  switch (request.method) {
    case 'initialize': {
      const protocolVersion = request.params?.protocolVersion
      if (typeof protocolVersion !== 'string') {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'protocolVersion required' } })
        return
      }
      record({ event: 'initialized-response', protocolVersion })
      reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'resource-import-owned-fixture', version: '1.0.0' } })
      break
    }
    case 'ping': reply({}); break
    case 'tools/list':
      record({ event: 'tools-response', tool: '${TOOL}' })
      reply({ tools: [{ name: '${TOOL}', description: 'Owned resource import proof ' + nonce, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false } }] })
      break
    case 'tools/call':
      if (request.params?.name !== '${TOOL}') {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Unknown fixture tool' } })
        return
      }
      reply({ content: [{ type: 'text', text: nonce + ':' + String(request.params?.arguments?.text ?? 'ok') }], isError: false })
      break
    default: send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })
  }
})
input.once('close', () => { record({ event: 'closed' }); process.exit(0) })
process.stdin.once('error', () => process.exit(0))
`

describe('native resource import with an owned MCP server', () => {
  let profile: string
  let source: string
  let runtime: string
  let auditFile: string
  let configFile: string
  let artifacts: string
  let initialConfig: StoredConfig
  let sourceBefore: Record<string, string>
  let skillName: string
  let agentName: string
  let serverName: string
  let nonce: string

  before(async () => {
    assert(process.env.REY30_E2E_HOME, 'Use the owned WDIO harness: REY30_E2E_HOME is required')
    profile = assertSafeE2eHome(process.env.REY30_E2E_HOME, launchContext())
    const data = canonicalPath(rey30UserDataDir(profile))
    assert(containsPath(profile, data), 'App data must remain inside the validated WDIO profile')

    await $('#root').waitForExist({ timeout: 60_000 })
    const appSettings = join(rey30DataDir(profile), 'settings.json')
    await browser.waitUntil(() => existsSync(appSettings), {
      timeout: 30_000,
      timeoutMsg: 'The native app did not create its settings inside REY30_E2E_HOME',
    })
    const nativeSettings = JSON.parse(readFileSync(appSettings, 'utf8')) as JsonObject
    assert.equal(typeof nativeSettings.data_folder, 'string', 'The app must resolve an actual data_folder')
    assert.equal(canonicalPath(nativeSettings.data_folder as string), data, 'The launched app resolved data outside this fixture')

    configFile = join(data, 'mcp_config.json')
    await browser.waitUntil(() => existsSync(configFile), {
      timeout: 30_000,
      timeoutMsg: 'The native app never created its MCP configuration in the isolated data folder',
    })
    initialConfig = readConfig(configFile)
    assert(Object.keys(initialConfig.mcpServers).length > 0, 'Preservation needs a positive control: existing MCP entries')
    assert(Object.values(initialConfig.mcpServers).every(config => config.active !== true), 'Use a fresh profile without active MCP servers for this owned fixture')

    nonce = randomUUID().replaceAll('-', '').slice(0, 12)
    skillName = `resource-skill-${nonce}`
    agentName = `resource-agent-${nonce}`
    serverName = `resource-mcp-${nonce}`
    const owned = mkdtempSync(join(profile, 'resource-import-'))
    source = join(owned, 'source')
    runtime = join(owned, 'runtime')
    auditFile = join(runtime, 'mcp-audit.jsonl')
    mkdirSync(join(source, 'skills', skillName, 'references'), { recursive: true })
    mkdirSync(join(source, 'agents'), { recursive: true })
    mkdirSync(join(source, 'servers'), { recursive: true })
    mkdirSync(runtime)
    writeFileSync(join(source, 'skills', skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: Owned WDIO skill ${nonce}\n---\nReturn resource-proof-${nonce}.\n`)
    writeFileSync(join(source, 'skills', skillName, 'references', 'proof.txt'), `Owned fixture ${nonce}\n`)
    writeFileSync(join(source, 'agents', `${agentName}.md`), `---\nname: ${agentName}\ndescription: Owned WDIO agent ${nonce}\ntools: Read\n---\nInspect resource-proof-${nonce} without changing files.\n`)
    const serverFile = join(source, 'servers', 'server.mjs')
    writeFileSync(serverFile, SERVER_SOURCE)
    writeFileSync(join(source, '.mcp.json'), JSON.stringify({ mcpServers: {
      [serverName]: { command: process.execPath, args: [serverFile, auditFile, nonce], env: { RESOURCE_IMPORT_PROOF: nonce }, active: true },
    } }, null, 2))
    sourceBefore = manifest(source)

    const repo = canonicalPath(resolve(import.meta.dirname, '../..'))
    const output = canonicalPath(join(repo, 'artifacts', 'qa', 'resource-imports-e2e'))
    assert(containsPath(repo, output), 'Screenshot output must remain inside the repository')
    mkdirSync(output, { recursive: true })
    artifacts = mkdtempSync(join(output, 'run-'))
  })

  it('reviews, copies and explicitly connects the selected resources without changing their source', async () => {
    await clickWhenReady(HUB)
    await browser.waitUntil(async () => /^\/hub\/?$/.test(await browser.execute(() => window.location.pathname)), {
      timeout: 30_000,
      timeoutMsg: 'The real Hub navigation link never reached Hub',
    })
    await clickWhenReady(OPEN_IMPORT)
    await $(DIALOG).waitForDisplayed({ timeout: 30_000 })
    await $(INPUT).setValue(source)
    await clickWhenReady(ANALYZE)
    await $(PLAN).waitForDisplayed({ timeout: 30_000 })

    for (const [name, kind] of [[skillName, 'skill'], [agentName, 'agent'], [serverName, 'mcp']] as const) {
      const control = await $(candidate(name, kind))
      await control.waitForDisplayed({ timeout: 30_000 })
      await expect(control).not.toBeSelected()
      await control.click()
      await expect(control).toBeSelected()
    }
    await expect($(CONNECT)).not.toBeSelected()
    assert(!existsSync(auditFile), 'Discovery/selection executed the MCP before consent')
    const data = rey30UserDataDir(profile)
    const installedSkill = join(data, 'agent-workspace', 'skills', skillName)
    const installedAgent = join(data, 'agent-workspace', 'subagents', `${agentName}.toml`)
    assert(!existsSync(installedSkill) && !existsSync(installedAgent), 'Fixture names unexpectedly collide')
    assert(!Object.hasOwn(readConfig(configFile).mcpServers, serverName), 'The server existed before commit')

    await clickWhenReady(CONNECT)
    await expect($(CONNECT)).toBeSelected()
    await clickWhenReady(COMMIT)
    await $(RECEIPT).waitForDisplayed({ timeout: 90_000 })
    const connected = `${RECEIPT} [data-testid="resource-import-mcp-result"][data-server-name="${serverName}"][data-connected="true"]`
    await $(connected).waitForDisplayed({ timeout: 60_000 })
    await expect($(connected)).toHaveText(expect.stringMatching(/1 (tools available|herramientas disponibles)/))
    const errors = await $(`${RECEIPT} [role="alert"]`).isExisting()
    assert.equal(errors, false, 'The import receipt reports a preparation or connection error')

    const events = audit(auditFile)
    const initialize = events.find(event => event.event === 'request' && event.method === 'initialize')
    const initialized = events.find(event => event.event === 'initialized-response')
    assert(initialize?.protocolVersion, 'The native MCP client did not initialize the real process')
    assert.equal(initialized?.protocolVersion, initialize.protocolVersion, 'The fixture must echo the requested protocol version')
    assert(events.some(event => event.event === 'request' && event.method === 'notifications/initialized'), 'MCP initialization notification is missing')
    assert(events.some(event => event.event === 'tools-response' && event.tool === TOOL && event.nonce === nonce), 'The real process did not serve its unique tool')
    assert(events.some(event => event.event === 'started' && typeof event.pid === 'number'), 'No actual fixture process was recorded')

    const finalConfig = readConfig(configFile)
    for (const [name, config] of Object.entries(initialConfig.mcpServers)) {
      assert(isDeepStrictEqual(finalConfig.mcpServers[name], config), `Existing MCP entry changed: ${name}`)
    }
    for (const [key, value] of Object.entries(initialConfig)) {
      if (key === 'mcpServers') continue
      if (key === 'mcpSettings') {
        assert(value && typeof value === 'object' && !Array.isArray(value), 'Existing mcpSettings must be an object')
        const current = finalConfig.mcpSettings
        assert(current && typeof current === 'object' && !Array.isArray(current), 'The saved mcpSettings must remain an object')
        for (const [setting, previous] of Object.entries(value)) {
          assert(Object.hasOwn(current, setting), `Existing MCP setting disappeared: ${setting}`)
          assert(isDeepStrictEqual((current as JsonObject)[setting], previous), `Existing MCP setting changed: ${setting}`)
        }
      } else {
        assert(isDeepStrictEqual(finalConfig[key], value), `Existing configuration field changed: ${key}`)
      }
    }
    assert.equal(finalConfig.mcpServers[serverName]?.active, true, 'Explicit connection must be saved as active')
    assert.equal(finalConfig.mcpServers[serverName]?.official, false, 'An imported server must not become an official component')
    assert.equal(finalConfig.mcpServers[serverName]?.command, process.execPath)
    assert.deepEqual(finalConfig.mcpServers[serverName]?.args, [join(source, 'servers', 'server.mjs'), auditFile, nonce])
    assert.deepEqual(finalConfig.mcpServers[serverName]?.env, { RESOURCE_IMPORT_PROOF: nonce })
    assert.equal(readFileSync(join(installedSkill, 'SKILL.md'), 'utf8'), readFileSync(join(source, 'skills', skillName, 'SKILL.md'), 'utf8'))
    assert.equal(readFileSync(join(installedSkill, 'references', 'proof.txt'), 'utf8'), `Owned fixture ${nonce}\n`)
    const agent = readFileSync(installedAgent, 'utf8')
    assert(agent.includes(`Inspect resource-proof-${nonce}`), 'The actual agent file did not preserve its instructions')
    assert(/allowed_tools\s*=\s*\[/.test(agent), 'The imported agent lost its tool restriction')
    assert.deepEqual(manifest(source), sourceBefore, 'Resource import changed the source files')

    const dialogViewport = await assertDialogViewport()
    const screenshot = join(artifacts, 'resource-imports-connected.png')
    await browser.saveScreenshot(screenshot)
    writeFileSync(join(artifacts, 'receipt.json'), JSON.stringify({
      status: 'passed', scope: 'native-resource-import-owned-mcp', profile, source, screenshot, serverName, tool: TOOL,
      protocolVersion: initialize.protocolVersion,
      preservedMcpEntries: Object.keys(initialConfig.mcpServers).length,
      sourceManifest: sourceBefore,
      installedSkill, installedAgent, configFile,
      dialogViewport,
      actualFixturePid: events.find(event => event.event === 'started')?.pid,
      checks: ['native-ui-import', 'explicit-connection', 'real-stdio-initialize', 'real-tools-list', 'config-preserved', 'source-preserved'],
    }, null, 2))
  })

  it('lists the imported skill in classic chat and expands its instructions without sending a message', async () => {
    const data = rey30UserDataDir(profile)
    const configurationBefore = readConfig(configFile)
    const argument = 'QA-owned-argument'
    // Exact guest-js skillList/Read/Invoke contracts. They reach actual IPC
    // and plugin ACL; it neither sends a model prompt nor runs skill scripts.
    const invocation = await browser.executeAsync<SkillInvocationResult, [SkillInvocationArgs]>((request, done) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> }
      }).__TAURI_INTERNALS__
      if (!internals?.invoke) {
        done({ ok: false, error: 'The actual webview does not expose Tauri internal invoke' })
        return
      }
      void (async () => {
        const skills = await internals.invoke('plugin:agent-tools|skill_list', { dataFolder: request.dataFolder })
        if (!Array.isArray(skills) || !skills.some(skill => skill?.name === request.name)) {
          done({ ok: false, error: 'The actual skill_list did not expose the imported skill' })
          return
        }
        const raw = await internals.invoke('plugin:agent-tools|skill_read', { dataFolder: request.dataFolder, name: request.name })
        const message = await internals.invoke('plugin:agent-tools|skill_invoke', {
          dataFolder: request.dataFolder, name: request.name, args: request.args,
        })
        done(typeof raw === 'string' && typeof message === 'string'
          ? { ok: true, listedName: request.name, raw, message }
          : { ok: false, error: 'skill_read or skill_invoke returned a non-text result' })
      })().catch(error => done({ ok: false, error: String(error) }))
    }, { dataFolder: data, name: skillName, args: argument })
    assert(invocation.ok, `Actual skill invocation failed: ${invocation.error ?? 'No result'}`)
    assert.equal(invocation.listedName, skillName, 'The actual plugin list did not return the imported identity')
    assert(invocation.raw?.includes(`resource-proof-${nonce}`), 'The actual plugin did not read the imported skill file')
    assert(invocation.message?.includes(`resource-proof-${nonce}`), 'The actual plugin did not load the imported skill body')
    assert(invocation.message?.includes(argument), 'The actual plugin did not include the supplied argument')
    assert(isDeepStrictEqual(readConfig(configFile), configurationBefore), 'Skill IPC changed the MCP configuration')
    assert.deepEqual(manifest(source), sourceBefore, 'Skill IPC changed the imported source')
    const ipcReceipt = join(artifacts, 'skills-ipc-receipt.json')
    writeFileSync(ipcReceipt, JSON.stringify({
      status: 'passed', scope: 'native-skill-plugin-ipc', name: skillName, argument,
      commands: ['plugin:agent-tools|skill_list', 'plugin:agent-tools|skill_read', 'plugin:agent-tools|skill_invoke'],
      sourceBodyNonceVerified: true, sentToModel: false, mcpConfigPreserved: true,
    }, null, 2))

    try {
      await clickWhenReady(`${DIALOG} [data-slot="dialog-close"]`)
      await $(DIALOG).waitForDisplayed({ reverse: true, timeout: 30_000 })
      // The real temporary thread route renders the classic composer without
      // changing the provider gate on Home. Never consume a queued prompt.
      const queuedKeys = [SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY, SESSION_STORAGE_PREFIX.INITIAL_MESSAGE + TEMPORARY_CHAT_ID]
      const queued = await browser.execute(keys => keys.some(key => sessionStorage.getItem(key) !== null), queuedKeys)
      assert.equal(queued, false, 'A queued temporary message would trigger an unintended model request')
      const classicRoute = route.threadsDetail.replace('$threadId', TEMPORARY_CHAT_ID)
      await goto(classicRoute)
      const input = await $('[data-testid="chat-input"]')
      await input.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The existing temporary route did not expose its classic composer without configuring a provider' })
      await input.setValue('')
      const overflow = $('button[aria-label="More controls"], button[aria-label="Más controles"]')
      await browser.waitUntil(async () => await $('[data-testid="chat-skills-menu"]').isDisplayed() || await overflow.isDisplayed(), {
        timeout: 30_000,
        timeoutMsg: 'Classic chat exposed neither Skills nor its responsive controls menu',
      })
      if (!(await $('[data-testid="chat-skills-menu"]').isDisplayed())) await overflow.click()
      const trigger = await $('[data-testid="chat-skills-menu"]')
      await trigger.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The real imported skill did not reach the classic chat Skills menu' })
      // Radix opens on keyboard input; the embedded driver synthesizes clicks.
      await trigger.click()
      if ((await trigger.getAttribute('data-state')) !== 'open') await browser.keys('Enter')
      const option = `//*[@role="menuitem"][.//span[normalize-space(.)="${skillName}"]]`
      await $(option).waitForDisplayed({ timeout: 30_000 })
      const menuScreenshot = join(artifacts, 'classic-skills-menu.png')
      await browser.saveScreenshot(menuScreenshot)
      await clickWhenReady(option)
      await expect(input).toHaveValue(expect.stringMatching(new RegExp(`^/skill:${skillName}(?:\\s|$)`)))
      assert(isDeepStrictEqual(readConfig(configFile), configurationBefore), 'Skill listing/invocation changed the MCP configuration')
      assert.deepEqual(manifest(source), sourceBefore, 'Skill listing/invocation changed the imported source')
      const receiptPath = join(artifacts, 'receipt.json')
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as JsonObject
      writeFileSync(receiptPath, JSON.stringify({
        ...receipt,
        classicSkill: { status: 'passed', name: skillName, route: classicRoute, menuScreenshot, ipcReceipt,
          ipc: ['plugin:agent-tools|skill_list', 'plugin:agent-tools|skill_read', 'plugin:agent-tools|skill_invoke'],
          argument, sentToModel: false },
      }, null, 2))
      await input.setValue('')
    } finally {
      await browser.keys('Escape')
      await clickWhenReady(HUB)
      await clickWhenReady(OPEN_IMPORT)
      await $(DIALOG).waitForDisplayed({ timeout: 30_000 })
    }
  })

  const readOnlyGitHub = process.env.REY30_E2E_GITHUB_REAL === '1' ? it : it.skip
  readOnlyGitHub('lists repositories using the explicitly allowed existing GitHub CLI session', async () => {
    // The runner supplies gh's existing session. A second explicit opt-in may
    // download a read-only snapshot for inspection; neither branch commits it.
    await $(DIALOG).waitForDisplayed({ timeout: 30_000 })
    await clickWhenReady('//button[normalize-space(.)="GitHub"]')
    await browser.waitUntil(async () => /Connected as |Conectado como /.test(await $(DIALOG).getText()), {
      timeout: 45_000,
      timeoutMsg: 'No existing gh session reached the isolated app; no fresh login was attempted',
    })
    await browser.waitUntil(async () => (await $$('//button[starts-with(@aria-label,"Review ") or starts-with(@aria-label,"Revisar ")]').length) > 0, {
      timeout: 45_000,
      timeoutMsg: 'The allowed GitHub account did not expose any repository review rows',
    })

    const repository = process.env.REY30_E2E_GITHUB_REVIEW?.trim()
    if (!repository) return
    assert.equal(repository.toLowerCase(), 'rey30empire/rea', 'This optional live recipe assertion is scoped to the verified REA repository')
    const beforeReview = readConfig(configFile)
    const repositoryInput = `${DIALOG} input[aria-label="GitHub repository"], ${DIALOG} input[aria-label="Repositorio GitHub"]`
    await $(repositoryInput).setValue(repository)
    await clickWhenReady('//button[normalize-space(.)="Review repository" or normalize-space(.)="Revisar repositorio"]')
    const scanError = `${DIALOG} [role="alert"]`
    await browser.waitUntil(async () => await $(PLAN).isDisplayed() || await $(scanError).isDisplayed(), {
      timeout: 180_000,
      timeoutMsg: 'GitHub inspection did not produce a plan or a bounded snapshot error',
    })
    if (!(await $(PLAN).isDisplayed())) {
      throw new Error(`Read-only GitHub inspection failed: ${await $(scanError).getText()}`)
    }

    const mcpCandidates = await $$(`${PLAN} [data-testid="resource-import-candidate"][data-resource-kind="mcp"]`).getElements()
    assert(mcpCandidates.length > 0, 'The verified repository did not expose a supported MCP recipe')
    let verifiedPreview = ''
    let verifiedSource = ''
    for (const control of mcpCandidates) {
      await expect(control).not.toBeSelected()
      const name = await control.getAttribute('data-resource-name')
      assert(name && /^[a-z0-9-]+$/.test(name), 'Recipe identifiers must remain safe for the native selector')
      const previewButton = `${PLAN} input[data-resource-name="${name}"] + button`
      await clickWhenReady(previewButton)
      const text = await $(`${PLAN} pre`).getText()
      if (text.includes('rea-agents') && text.includes('6.4.0')) {
        verifiedPreview = text
        verifiedSource = await $(previewButton).getText()
        await expect(control).not.toBeSelected()
        break
      }
    }
    assert(verifiedPreview, 'No recipe preview declared the verified rea-agents package and version 6.4.0')
    await expect($(COMMIT)).not.toBeEnabled()
    assert(isDeepStrictEqual(readConfig(configFile), beforeReview), 'Read-only GitHub inspection changed the MCP configuration')
    const sha = verifiedSource.match(/GitHub [^@]+@([a-f0-9]{40})/i)?.[1]
    assert(sha, 'The live recipe source must identify its immutable GitHub commit')
    const dialogViewport = await assertDialogViewport()
    const screenshot = join(artifacts, 'github-rea-inspection.png')
    await browser.saveScreenshot(screenshot)
    writeFileSync(join(artifacts, 'github-inspection-receipt.json'), JSON.stringify({
      status: 'passed', scope: 'github-read-only-recipe-inspection', repository, sha,
      package: 'rea-agents', version: '6.4.0', committed: false, screenshot,
      dialogViewport,
      checks: ['existing-gh-session', 'repository-list', 'immutable-snapshot', 'recipe-preview', 'no-selection', 'config-preserved'],
    }, null, 2))
  })
})
