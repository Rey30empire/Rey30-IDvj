import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('El motor de voz de Pluma se empaqueta para Windows x64.')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const cache = path.join(root, 'artifacts', 'downloads', 'pluma')
const output = path.join(root, 'src-tauri', 'resources', 'pluma-llama')
const tag = 'b11960'
const commit = '8642541b255bfb5dc39cd351a178be09013a55d6'
const upstream = 'https://github.com/ggml-org/llama.cpp'
const archiveName = `llama-${tag}-bin-win-vulkan-x64.zip`
const archiveUrl = `${upstream}/releases/download/${tag}/${archiveName}`
const licenseUrl = `https://raw.githubusercontent.com/ggml-org/llama.cpp/${commit}/LICENSE`
const archiveHash = 'bac6914b5e83523eb008c6789eaa12669f93fbc196c3b9e8237b6672323b33e9'
const licenseHash = '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d'
const files = [
  'ggml-base.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-cooperlake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-ivybridge.dll',
  'ggml-cpu-piledriver.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-sapphirerapids.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll',
  'ggml-cpu-zen4.dll',
  'ggml-vulkan.dll',
  'ggml.dll',
  'libomp.dll',
  'LICENSE-LLVM-OpenMP',
  'llama-common.dll',
  'llama-server-impl.dll',
  'llama-server.exe',
  'llama.dll',
  'mtmd.dll',
]

fs.mkdirSync(cache, { recursive: true })
fs.mkdirSync(output, { recursive: true })
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

async function downloadVerified(url, name, expectedHash, maxBytes) {
  const file = path.join(cache, name)
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === expectedHash) {
    return file
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar ${name} (HTTP ${response.status})`)
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error(`Descarga demasiado grande: ${name}`)
    chunks.push(chunk)
  }
  const contents = Buffer.concat(chunks)
  if (sha256(contents) !== expectedHash) throw new Error(`SHA-256 incorrecto: ${name}`)
  fs.writeFileSync(file, contents)
  return file
}

const [archive, license] = await Promise.all([
  downloadVerified(archiveUrl, archiveName, archiveHash, 37_345_851),
  downloadVerified(licenseUrl, 'LICENSE-llama.cpp', licenseHash, 4_096),
])

execFileSync('tar.exe', ['-xf', archive, '-C', output, ...files], { windowsHide: true })
fs.copyFileSync(license, path.join(output, 'LICENSE-llama.cpp'))
const resources = [...files, 'LICENSE-llama.cpp'].map((name) => {
  const contents = fs.readFileSync(path.join(output, name))
  return { name, bytes: contents.length, sha256: sha256(contents) }
})
fs.writeFileSync(path.join(output, 'SOURCE.json'), JSON.stringify({
  engine: 'llama.cpp',
  tag,
  commit,
  archiveUrl,
  archiveSha256: archiveHash,
  licenseUrl,
  resources,
}, null, 2) + '\n')
console.log(`llama.cpp ${tag} Vulkan preparado para Pluma.`)
