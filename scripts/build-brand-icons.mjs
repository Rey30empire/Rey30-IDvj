import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ICO_SIZES, packIco } from './build-windows-icon.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const nativeRoot = realpathSync(join(root, 'src-tauri'))
const stage = mkdtempSync(join(nativeRoot, '.icon-build-'))
const cli = createRequire(join(root, 'package.json')).resolve('@tauri-apps/cli/tauri.js')
const source = join(root, 'web-app/public/images/rey30-idvj.svg')

function installFile(from, target) {
  const destination = resolve(target)
  if (!destination.startsWith(nativeRoot + sep)) throw new Error('Icon target outside native workspace')
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = destination + '.' + randomUUID() + '.tmp'
  copyFileSync(from, temporary)
  // Replace the file object rather than truncating an icon mapped by Windows.
  renameSync(temporary, destination)
}

function installTree(from, target) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) installTree(join(from, entry.name), join(target, entry.name))
    else if (entry.isFile()) installFile(join(from, entry.name), join(target, entry.name))
    else throw new Error('Unexpected link in generated icons')
  }
}

try {
  const common = join(stage, 'common')
  const windows = join(stage, 'windows')
  execFileSync(process.execPath, [cli, 'icon', source, '-o', common], { cwd: root, stdio: 'inherit' })
  execFileSync(process.execPath, [cli, 'icon', source, '-o', windows, ...ICO_SIZES.flatMap(size => ['-p', String(size)])], { cwd: root, stdio: 'inherit' })
  installTree(common, join(nativeRoot, 'icons'))
  installTree(common, join(nativeRoot, 'icons-macos'))
  const ico = join(stage, 'windows.ico')
  writeFileSync(ico, packIco(ICO_SIZES.map(size => ({ size, png: readFileSync(join(windows, `${size}x${size}.png`)) }))))
  installFile(ico, join(nativeRoot, 'icons-windows/icon.ico'))
  installFile(join(common, 'icon.png'), join(nativeRoot, 'icons-windows/icon.png'))
} finally {
  const actual = realpathSync(stage)
  if (dirname(actual) !== nativeRoot || !basename(actual).startsWith('.icon-build-')) {
    throw new Error('Refusing cleanup outside the owned icon staging directory')
  }
  rmSync(actual, { recursive: true, force: true })
}
