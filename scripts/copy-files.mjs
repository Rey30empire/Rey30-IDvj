import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function copyFilesToDirectorySync(sources, destination) {
  mkdirSync(destination, { recursive: true })
  return sources.map((source) => {
    const target = join(destination, basename(source))
    copyFileSync(source, target)
    return target
  })
}

function main(mode) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  let sources
  let destination
  if (mode === 'resources') {
    sources = ['LICENSE', 'NOTICE', 'LICENSE-APACHE-2.0.txt'].map((file) => join(root, file))
    destination = join(root, 'src-tauri', 'resources')
  } else if (mode === 'archives') {
    sources = readdirSync(process.cwd(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
      .map((entry) => join(process.cwd(), entry.name))
      .sort()
    if (sources.length === 0) throw new Error('No package archives found in ' + process.cwd())
    destination = join(root, 'pre-install')
  } else {
    throw new Error('Usage: node scripts/copy-files.mjs resources|archives')
  }
  const copied = copyFilesToDirectorySync(sources, destination)
  console.log('Copied ' + copied.length + ' file(s) to ' + destination)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv[2]) } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
