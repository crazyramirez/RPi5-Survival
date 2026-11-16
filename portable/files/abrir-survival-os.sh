#!/bin/sh
# Survival OS portable (Linux, también Raspberry Pi de 64 bits).
# Doble clic («Ejecutar») o desde una terminal:  sh abrir-survival-os.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in
  x86_64|amd64) KEY=linux-x64 ;;
  aarch64|arm64) KEY=linux-arm64 ;;
  *) echo "Survival OS: arquitectura no soportada ($(uname -m))." >&2; exit 1 ;;
esac
NODE="$ROOT/runtime/$KEY/node"
[ -x "$NODE" ] || chmod +x "$NODE" 2>/dev/null
if [ ! -x "$NODE" ]; then
  echo "Survival OS: no se puede ejecutar $NODE." >&2
  echo "Si la memoria USB está montada con «noexec», copia la carpeta al disco." >&2
  exit 1
fi
exec "$NODE" "$ROOT/app/portable/launcher.mjs" "$@"
