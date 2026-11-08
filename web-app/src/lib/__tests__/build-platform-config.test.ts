import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const webAppDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const childTimeoutMs = 30_000
const testTimeoutMs = 45_000

function definitions(isTauri: string | undefined, target?: string) {
  const env = { ...process.env }
  if (isTauri === undefined) delete env.IS_TAURI
  else env.IS_TAURI = isTauri
  if (target === undefined) delete env.TAURI_ENV_PLATFORM
  else env.TAURI_ENV_PLATFORM = target
  const script = `import {loadConfigFromFile} from 'vite'; const started=Date.now(); const loaded=await loadConfigFromFile({command:'build',mode:'production'},'vite.config.ts'); if(!loaded)throw new Error('Missing Vite config'); console.log('__BUILD_DEFINES__'+JSON.stringify(loaded.config.define)); console.log('__CONFIG_TIMING__'+JSON.stringify({configMs:Date.now()-started}));`
  const started = Date.now()
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: webAppDirectory, env, encoding: 'utf8', timeout: childTimeoutMs })
  const timing = result.stdout.split('\n').find(value => value.startsWith('__CONFIG_TIMING__'))
  const diagnostics = { target: target ?? 'host', isTauri: isTauri ?? 'unset', timeoutMs: childTimeoutMs, elapsedMs: Date.now() - started, status: result.status, signal: result.signal, errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code ?? null, hasDefines: result.stdout.includes('__BUILD_DEFINES__'), stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), timing: timing ? JSON.parse(timing.slice('__CONFIG_TIMING__'.length)) : null }
  console.info('Vite config child:', JSON.stringify(diagnostics))
  expect(result.status, `${JSON.stringify(diagnostics)}\n${result.stderr}`).toBe(0)
  const line = result.stdout.split('\n').find(value => value.startsWith('__BUILD_DEFINES__'))
  expect(line).toBeDefined()
  return JSON.parse(line!.slice('__BUILD_DEFINES__'.length)) as Record<string, string>
}
describe('configuración Vite real sin generar dist', () => {
  it('keeps native window controls in a direct Tauri build on this host', () => {
    const define = definitions('true')
    expect(define.IS_WINDOWS).toBe(JSON.stringify(process.platform === 'win32'))
    expect(define.IS_MACOS).toBe(JSON.stringify(process.platform === 'darwin'))
    expect(define.IS_LINUX).toBe(JSON.stringify(process.platform === 'linux'))
  }, testTimeoutMs)
  it('keeps a browser build free from native platform flags without a target', () => {
    const define = definitions(undefined)
    expect(define.IS_WINDOWS).toBe('false'); expect(define.IS_MACOS).toBe('false'); expect(define.IS_LINUX).toBe('false')
  }, testTimeoutMs)
  it('honors an explicit Android cross target before the desktop host', () => {
    const define = definitions('true', 'android')
    expect(define.IS_WINDOWS).toBe('false'); expect(define.IS_MACOS).toBe('false'); expect(define.IS_LINUX).toBe('false'); expect(define.IS_ANDROID).toBe('true'); expect(define.PLATFORM).toBe('"android"')
  }, testTimeoutMs)
})
