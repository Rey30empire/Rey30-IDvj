import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Whisper for the app's speech recognition: stock whisper.cpp b5907 for
// Windows x64 with OpenBLAS (CPU, so it never takes graphics memory from
// Pluma's voice or Strata). The model, ggml-large-v3-turbo-q5_0.bin, lives in
// the models folder (Pluma\Whisper-large-v3-turbo), not in the app.
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('El reconocedor Whisper se empaqueta para Windows x64.')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const cache = path.join(root, 'artifacts', 'downloads', 'pluma')
const output = path.join(root, 'src-tauri', 'resources', 'pluma-whisper')
const tag = 'b5907'
const commit = '5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec'
const archiveName = 'whisper-blas-bin-x64.zip'
const archiveUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${tag}/${archiveName}`
const licenseUrl = `https://raw.githubusercontent.com/ggml-org/whisper.cpp/${commit}/LICENSE`
const archiveHash = '98a4691eb23a3a2afe91b0773bea5b2b4bcd5e7432a49e588724e84268711f11'
const licenseHash = '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d'
const files = [
  'whisper-server.exe',
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-blas.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll',
  'libopenblas.dll',
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
  downloadVerified(archiveUrl, `whisper-${tag}-${archiveName}`, archiveHash, 21_955_392),
  downloadVerified(licenseUrl, `LICENSE-whisper.cpp-${tag}`, licenseHash, 4_096),
])

// The archive keeps its files in Release/: they are unpacked apart, then copied flat.
const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'rey30-whisper-'))
try {
  execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', unpacked, ...files.map((name) => `Release/${name}`)], { windowsHide: true })
  for (const name of files) fs.copyFileSync(path.join(unpacked, 'Release', name), path.join(output, name))
} finally {
  fs.rmSync(unpacked, { recursive: true, force: true })
}
fs.copyFileSync(license, path.join(output, 'LICENSE-whisper.cpp'))
const resources = [...files, 'LICENSE-whisper.cpp'].map((name) => {
  const contents = fs.readFileSync(path.join(output, name))
  return { name, bytes: contents.length, sha256: sha256(contents) }
})
fs.writeFileSync(path.join(output, 'SOURCE.json'), JSON.stringify({
  engine: 'whisper.cpp',
  tag,
  commit,
  archiveUrl,
  archiveSha256: archiveHash,
  licenseUrl,
  model: {
    repository: 'https://huggingface.co/ggerganov/whisper.cpp',
    license: 'MIT (OpenAI Whisper)',
    files: [{ name: 'ggml-large-v3-turbo-q5_0.bin', sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' }],
  },
  resources,
}, null, 2) + '\n')
console.log(`whisper.cpp ${tag} preparado para el reconocimiento de voz.`)
