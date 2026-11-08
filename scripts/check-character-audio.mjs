import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const root = path.resolve(import.meta.dirname, '../src-tauri/resources/character-audio')
const required = ['SOURCE.json', 'NOTICE.txt', 'LICENSE-espeak-ng.txt', 'LICENSE-vosk.txt', 'sources/espeak-ng-1.52.0-source.tar.gz', 'espeak-ng.dll', 'espeak-ng-data/es_dict', 'espeak-ng-data/voices/!v/m1', 'espeak-ng-data/voices/!v/m2', 'espeak-ng-data/voices/!v/m3', 'espeak-ng-data/voices/!v/m4', 'espeak-ng-data/voices/!v/m5', 'espeak-ng-data/voices/!v/f3', 'libvosk.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll', 'vosk-model-small-es-0.42/am/final.mdl']
for (const item of required) if (!fs.existsSync(path.join(root, item))) throw new Error(`Falta audio local: ${item}. Ejecuta node scripts/prepare-character-audio.mjs.`)
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'SOURCE.json'), 'utf8'))
const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'espeak-ng.dll'))).digest('hex')
if (actual !== receipt.espeak.sha256) throw new Error('El motor de voz cambió desde su preparación.')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8'))
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || file.path.includes('..') || path.isAbsolute(file.path)) throw new Error('Ruta de audio no válida')
  const bytes = fs.readFileSync(path.join(root, file.path))
  if (bytes.length !== file.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Recurso de audio modificado: ${file.path}`)
}
const helper = fs.readFileSync(path.resolve(import.meta.dirname, '../src-tauri/src/core/system/character_audio.ps1'))
if (!helper.equals(fs.readFileSync(path.join(root, 'sources/character_audio.ps1')))) throw new Error('El adaptador de audio no coincide con sus fuentes adjuntas. Ejecuta prepare:audio.')
console.log(`Audio local comprobado: ${required.length} recursos obligatorios; 6 variantes españolas y dictado local.`)
