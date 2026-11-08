#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="${REY30_INSTALL_DIR:-$HOME/.local/bin}"
while (($#)); do
  case "$1" in
    --dir) install_dir="$2"; shift 2 ;;
    --source) shift ;;
    -h|--help) echo 'Uso: install-rey30-idvj-agent.sh [--dir CARPETA] [--source]. Compila el CLI local.'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done
destination_root="$install_dir"
if [[ -d "$install_dir" ]]; then
  destination_root="$(cd "$install_dir" && pwd -P)"
elif [[ -d "$(dirname "$install_dir")" ]]; then
  destination_root="$(cd "$(dirname "$install_dir")" && pwd -P)/$(basename "$install_dir")"
fi
gui_build_root="$(cd "$project_root/src-tauri" && pwd -P)/target"
folded_destination="$(printf '%s' "$destination_root" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')"
folded_destination="${folded_destination%/}"
folded_gui_root="$(printf '%s' "$gui_build_root" | tr '[:upper:]' '[:lower:]')"
case "$folded_destination" in
  "$folded_gui_root/debug"|"$folded_gui_root/release"|*/src-tauri/target/debug|*/src-tauri/target/release|src-tauri/target/debug|src-tauri/target/release)
    echo 'La carpeta de salida de la aplicacion GUI no puede ser destino del CLI.' >&2
    exit 1 ;;
esac
if [[ -d "$install_dir" ]]; then
  has_resources=0
  has_gui_binary=0
  has_uninstaller=0
  for entry in "$install_dir"/*; do
    name="$(basename "$entry" | tr '[:upper:]' '[:lower:]')"
    case "$name" in
      resources) [[ ! -d "$entry" ]] || has_resources=1 ;;
      rey30-idvj.exe) [[ ! -f "$entry" ]] || has_gui_binary=1 ;;
      uninstall.exe) [[ ! -f "$entry" ]] || has_uninstaller=1 ;;
    esac
  done
  if [[ "$has_uninstaller" == 1 || ( "$has_resources" == 1 && "$has_gui_binary" == 1 ) ]]; then
    echo 'El destino contiene una aplicacion GUI; el CLI se debe instalar en otra carpeta.' >&2
    exit 1
  fi
fi
(cd "$project_root/src-tauri/rey30-idvj-cli" && cargo build --release --target-dir "$project_root/src-tauri/rey30-idvj-cli/target" --no-default-features --features cli)
binary="$project_root/src-tauri/rey30-idvj-cli/target/release/rey30-idvj"
if [[ ! -f "$binary" && -f "$binary.exe" ]]; then binary="$binary.exe"; fi
[[ -f "$binary" ]] || { echo "No se encontro $binary" >&2; exit 1; }
mkdir -p "$install_dir"
destination="$install_dir/$(basename "$binary")"
if [[ -e "$destination" ]]; then cp -p "$destination" "$destination.backup-$(date +%Y%m%d%H%M%S)-$$"; fi
install -m755 "$binary" "$destination"
echo "CLI instalado: $destination"
