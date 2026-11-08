import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const generated = [
  ['../core/dist/index.js', ['NODE', 'VERSION']],
  ['../extensions/assistant-extension/dist/index.js', ['NODE', 'VERSION']],
  ['../extensions/download-extension/dist/index.js', ['SETTINGS']],
  ['../extensions/llamacpp-extension/dist/index.js', ['SETTINGS', 'ENGINE', 'IS_WINDOWS', 'IS_MAC', 'IS_LINUX']],
  ['../extensions/mlx-extension/dist/index.js', ['SETTINGS', 'ENGINE', 'IS_MAC']],
  ['../extensions/rag-extension/dist/index.js', ['SETTINGS']],
]
for (const [path, constants] of generated) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  for (const name of constants) {
    assert(!new RegExp(`(?<![\\w$"'.])${name}(?![\\w$"'])`).test(source), `${path} contains an unresolved build constant ${name}`)
  }
}

// Exercise the shipped bundle without a webview, network, embeddings or model engine.
globalThis.window = { core: { api: {} } }
const { default: RagExtension } = await import('../extensions/rag-extension/dist/index.js')
const extension = new RagExtension('qa', 'qa-rag', 'QA', true, 'Compiled settings contract', 'qa')
let registered
extension.registerSettings = async (settings) => { registered = settings }
extension.getSetting = async (_key, fallback) => fallback
await extension.configure()
assert(Array.isArray(registered) && registered.length > 0, 'RAG did not register its embedded settings')
assert(registered.every((setting) => typeof setting.key === 'string'), 'RAG settings schema is invalid')
process.stdout.write(JSON.stringify({ bundles: generated.length, ragSettings: registered.length, compiledConfigure: 'passed', modelCalls: 0, networkCalls: 0 }) + '\n')
