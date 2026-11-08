import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'resources/rey30-skills')
const destination = join(root, 'src-tauri/resources/rey30-skills.pack.json')
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
const names = new Set()
const allowed = /\.(md|txt|json|ya?ml|toml)$/i

function readFiles(folder, unitRoot = folder) {
  const output = []
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const absolute = join(folder, entry.name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error(`Links are not bundled: ${absolute}`)
    if (stat.isDirectory()) output.push(...readFiles(absolute, unitRoot))
    else if (stat.isFile()) {
      if (!allowed.test(entry.name) && !/^licen[sc]e(?:[-.][a-z0-9.-]+)?$/i.test(entry.name) && entry.name !== 'NOTICE') {
        throw new Error(`Executable or unreviewed resource type: ${absolute}`)
      }
      const bytes = readFileSync(absolute)
      if (bytes.length > 256 * 1024) throw new Error(`Resource exceeds 256 KiB: ${absolute}`)
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      output.push({ path: relative(unitRoot, absolute).split(sep).join('/'), content, sha256: createHash('sha256').update(bytes).digest('hex') })
    } else throw new Error(`Not a regular file: ${absolute}`)
  }
  return output
}

const units = manifest.units.map((unit) => {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(unit.name) || names.has(unit.id)) throw new Error(`Invalid or duplicate unit ${unit.id}`)
  names.add(unit.id)
  const folder = resolve(source, unit.directory)
  if (!folder.startsWith(source + sep)) throw new Error(`Unit outside package: ${unit.id}`)
  const files = readFiles(folder)
  if (!files.length) throw new Error(`Empty unit: ${unit.id}`)
  if (unit.kind === 'skill' && !files.some((file) => file.path === 'SKILL.md')) throw new Error(`Skill entrypoint missing: ${unit.name}`)
  if (unit.kind === 'agent' && (files.length !== 1 || files[0].path !== unit.name + '.toml')) throw new Error(`Agent requires exactly its named TOML: ${unit.name}`)
  return { id: unit.id, kind: unit.kind, name: unit.name, files }
})
const pack = { schema: 1, version: manifest.version, items: manifest.items, units }
const encoded = JSON.stringify(pack, null, 2) + '\n'
if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw new Error('Package exceeds 8 MiB')
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== encoded) throw new Error('Embedded skill package is stale; run node scripts/build-skill-pack.mjs')
} else {
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, encoded)
}
process.stdout.write(JSON.stringify({ version: pack.version, items: pack.items.length, units: units.length, files: units.reduce((count, unit) => count + unit.files.length, 0), bytes: Buffer.byteLength(encoded), sha256: createHash('sha256').update(encoded).digest('hex'), mode: process.argv.includes('--check') ? 'check' : 'build' }) + '\n')
