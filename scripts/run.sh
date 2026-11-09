#!/usr/bin/env bash
# Ejecuta la release instalada en primer plano (Fase 1: arranque MANUAL, sin autostart).
# Uso:  ~/survival-os/current/scripts/run.sh
set -euo pipefail

PREFIX="${SURVIVAL_OS_HOME:-$HOME/survival-os}"
NODE_BIN="$PREFIX/runtime/node/bin/node"
ENV_FILE="$PREFIX/config/survival-os.env"
APP_DIR="$PREFIX/current"

[ -x "$NODE_BIN" ] || { echo "Node no instalado en $NODE_BIN. Ejecuta scripts/install.sh" >&2; exit 1; }
[ -d "$APP_DIR" ] || { echo "No hay release activa en $APP_DIR" >&2; exit 1; }

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

exec "$NODE_BIN" "$APP_DIR/scripts/start.mjs"
