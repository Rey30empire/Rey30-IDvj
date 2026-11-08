#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  printf '%s\n' "Usage: $0 <tauri.conf.json> <channel>" >&2
  exit 1
fi
input="$1"
channel="$2"
case "$channel" in nightly|beta) ;; *) printf '%s\n' 'Channel must be nightly or beta' >&2; exit 1 ;; esac
[ -f "$input" ] || { printf 'Missing config: %s\n' "$input" >&2; exit 1; }
# Local channel builds keep the updater disabled until a separately owned signing channel exists.
node --input-type=module - "$input" "$channel" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
const [, , file, channel] = process.argv
const config = JSON.parse(fs.readFileSync(file, 'utf8'))
config.productName = 'Rey30 IDvj ' + channel
config.identifier = 'com.rey30.idvj.' + channel + '.app'
config.mainBinaryName = 'Rey30-IDvj-' + channel
if (config.plugins?.updater) config.plugins.updater.endpoints = []
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
const manifest = path.join(path.dirname(file), 'Cargo.toml')
if (fs.existsSync(manifest)) {
  let cargo = fs.readFileSync(manifest, 'utf8')
  cargo = cargo.replace(/^default-run = "Rey30-IDvj"$/m, 'default-run = "Rey30-IDvj-' + channel + '"')
  cargo = cargo.replace(/(\[\[bin\]\]\s*\r?\n)name = "Rey30-IDvj"/m, '$1name = "Rey30-IDvj-' + channel + '"')
  fs.writeFileSync(manifest, cargo)
}
const plist = path.join(path.dirname(file), 'Info.plist')
if (fs.existsSync(plist)) {
  const text = fs.readFileSync(plist, 'utf8').replaceAll('com.rey30.idvj.app', config.identifier).replaceAll('<string>rey30-idvj</string>', '<string>rey30-idvj-' + channel + '</string>')
  fs.writeFileSync(plist, text)
}
NODE
