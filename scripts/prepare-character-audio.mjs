import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'src-tauri/resources/character-audio')
const cache = path.join(root, 'artifacts/qa/characters-20261104/audio-downloads')
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(cache, { recursive: true })
async function download(url, name, expected) {
  const target = path.join(cache, name)
  if (!fs.existsSync(target) || (expected && sha(target) !== expected)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Descarga fallida ${response.status}: ${url}`)
    const partial = target + '.partial'
    fs.writeFileSync(partial, '')
    let received = 0
    for await (const chunk of response.body) {
      received += chunk.length
      if (received > 128 * 1024 * 1024) throw new Error('La descarga supera 128 MiB')
      fs.appendFileSync(partial, chunk)
    }
    fs.renameSync(partial, target)
  }
  if (expected && sha(target) !== expected) throw new Error(`SHA-256 no coincide: ${name}`)
  return target
}
function unpack(archive, destination, only = []) {
  const entries = execFileSync('tar.exe', ['-tf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
  if (entries.some((p) => p.startsWith('/') || p.includes('..') || /^[A-Za-z]:/.test(p))) throw new Error('Archivo comprimido con rutas no válidas')
  fs.mkdirSync(destination, { recursive: true })
  execFileSync('tar.exe', ['-xf', archive, '-C', destination, ...only], { windowsHide: true })
}

const metadata = await (await fetch('https://pypi.org/pypi/vosk/0.3.45/json')).json()
const wheel = metadata.urls.find((f) => f.filename.endsWith('win_amd64.whl'))
if (!wheel) throw new Error('No existe el runtime Vosk Windows x64')
const wheelPath = await download(wheel.url, wheel.filename, wheel.digests.sha256)
const wheelDir = path.join(cache, 'vosk-wheel'); unpack(wheelPath, wheelDir)
const dllFiles = fs.readdirSync(path.join(wheelDir, 'vosk')).filter((p) => p.endsWith('.dll'))
for (const name of dllFiles) fs.copyFileSync(path.join(wheelDir, 'vosk', name), path.join(output, name))
const modelUrl = 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip'
const model = await download(modelUrl, 'vosk-model-small-es-0.42.zip', '09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f')
if (!fs.existsSync(path.join(output, 'vosk-model-small-es-0.42/am/final.mdl'))) unpack(model, output)

const sourceUrl = 'https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/1.52.0'
const source = await download(sourceUrl, 'espeak-ng-1.52.0-source.tar.gz', 'bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23')
const sourceDir = path.join(cache, 'espeak-source')
const sourceRoot = 'espeak-ng-1.52.0'
const sourcePath = path.join(sourceDir, sourceRoot)
const buildDir = path.join(root, 'artifacts/espeak-build')
const builtDll = path.join(buildDir, 'src/Release/espeak-ng.dll')
const configure = ['-S', sourcePath, '-B', buildDir, '-G', 'Visual Studio 17 2022', '-A', 'x64', '-DBUILD_SHARED_LIBS=ON', '-DBUILD_TESTING=OFF', '-DUSE_MBROLA=OFF', '-DUSE_LIBPCAUDIO=OFF']
if (!fs.existsSync(builtDll)) {
  unpack(source, sourceDir, ['--exclude=espeak-ng-1.52.0/src/include/espeak/speak_lib.h'])
  fs.copyFileSync(path.join(sourcePath, 'src/include/espeak-ng/speak_lib.h'), path.join(sourcePath, 'src/include/espeak/speak_lib.h'))
  execFileSync('cmake', configure, { stdio: 'inherit', windowsHide: true })
  execFileSync('cmake', ['--build', buildDir, '--config', 'Release', '--parallel', '4'], { stdio: 'inherit', windowsHide: true })
}
fs.copyFileSync(builtDll, path.join(output, 'espeak-ng.dll'))
const dataDestination = path.join(output, 'espeak-ng-data')
if (fs.existsSync(dataDestination)) {
  const backup = path.join(cache, `previous-espeak-data-${crypto.randomUUID()}`)
  for (const target of [dataDestination, backup]) if (path.relative(root, path.resolve(target)).startsWith('..')) throw new Error('Destino de movimiento fuera del proyecto')
  fs.renameSync(dataDestination, backup)
}
fs.cpSync(path.join(buildDir, 'espeak-ng-data'), dataDestination, { recursive: true })
fs.mkdirSync(path.join(output, 'sources'), { recursive: true })
fs.copyFileSync(source, path.join(output, 'sources/espeak-ng-1.52.0-source.tar.gz'))
fs.copyFileSync(path.join(sourceDir, sourceRoot, 'COPYING'), path.join(output, 'LICENSE-espeak-ng.txt'))
const sonic = path.join(buildDir, '_deps/sonic-git-src')
fs.cpSync(sonic, path.join(output, 'sources/sonic'), { recursive: true, filter: (candidate) => path.basename(candidate) !== '.git' })
fs.copyFileSync(path.join(sonic, 'LICENSE'), path.join(output, 'LICENSE-sonic.txt'))
fs.copyFileSync(path.join(root, 'src-tauri/src/core/system/character_audio.ps1'), path.join(output, 'sources/character_audio.ps1'))
fs.writeFileSync(path.join(output, 'sources/BUILD.txt'), 'eSpeak NG 1.52.0, fuentes originales adjuntas.\nConstrucción Windows x64: Visual Studio 2022, CMake.\n'+['cmake '+configure.map((part) => JSON.stringify(part)).join(' '),'cmake --build artifacts/espeak-build --config Release --parallel 4'].join('\n')+'\nSonic: commit fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104, fuentes y licencia Apache-2.0 adjuntas.\nEl enlace simbólico src/include/espeak/speak_lib.h se materializa con el contenido de src/include/espeak-ng/speak_lib.h para Windows.\n')
const voskLicenseUrl = 'https://raw.githubusercontent.com/alphacep/vosk-api/v0.3.45/COPYING'
const licenseResponse = await fetch(voskLicenseUrl)
if (!licenseResponse.ok) throw new Error('No se pudo conservar la licencia de Vosk')
fs.writeFileSync(path.join(output, 'LICENSE-vosk.txt'), await licenseResponse.text())
const receipt = { preparedAt: new Date().toISOString(), windowsX64: true, localOnly: true,
  espeak: { runtimeVersion: '1.52.0', origin: 'Compilación propia de las fuentes oficiales adjuntas con CMake y Visual Studio 2022', sha256: sha(path.join(output, 'espeak-ng.dll')), sourceUrl, sourceSha256: sha(source), license: 'GPL-3.0-or-later', sonicCommit: 'fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104', note: 'Proceso separado por IPC. Fuentes, adaptador y receta de construcción adjuntos. No se instala Piper ni se usan pesos TTS.' },
  vosk: { version: '0.3.45', wheelUrl: wheel.url, wheelSha256: wheel.digests.sha256, license: 'Apache-2.0', dllFiles },
  dictation: { model: 'vosk-model-small-es-0.42', url: modelUrl, bytes: fs.statSync(model).size, sha256: sha(model), license: 'Apache-2.0', reference: 'https://alphacephei.com/vosk/models' },
  assistantModelTests: 0,
}
fs.writeFileSync(path.join(output, 'SOURCE.json'), JSON.stringify(receipt, null, 2)+'\n')
fs.writeFileSync(path.join(output, 'NOTICE.txt'), 'Audio local de Rey30 IDvj\n\nVoz sintética española: eSpeak NG, GPL-3.0-or-later. Sus fuentes se incluyen en sources/.\nDictado español: Vosk 0.3.45 y vosk-model-small-es-0.42, Apache-2.0.\nSe conservan nombres, licencias y atribuciones. Las variantes no son voces clonadas de actores.\nEste paquete no utiliza el modelo Jan ni envía audio a la nube.\n')
const files = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('El paquete de audio no admite enlaces')
    if (entry.isDirectory()) collect(full)
    else if (entry.isFile() && entry.name !== 'MANIFEST.json') files.push({ path: path.relative(output, full).replaceAll('\\', '/'), bytes: fs.statSync(full).size, sha256: sha(full) })
  }
}
collect(output)
files.sort((a, b) => a.path.localeCompare(b.path))
fs.writeFileSync(path.join(output, 'MANIFEST.json'), JSON.stringify({ version: 1, files }, null, 2)+'\n')
fs.writeFileSync(path.join(cache, '..', 'audio-install.json'), JSON.stringify(receipt, null, 2)+'\n')
console.log(JSON.stringify({ prepared: true, dlls: dllFiles, spanishVoices: 6, modelBytes: receipt.dictation.bytes }))
