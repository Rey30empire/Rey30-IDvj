#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in stable|beta|nightly) ;; *) printf '%s\n' 'Usage: use-channel-icons.sh <stable|beta|nightly>' >&2; exit 1 ;; esac
# Channel builds use the same Rey30 icon source until a separate approved variant exists.
printf '%s\n' 'Using the configured Rey30 IDvj icon sources for this channel.'
