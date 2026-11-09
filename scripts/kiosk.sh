#!/usr/bin/env bash
# Kiosco Survival OS. Lo lanza la unidad de usuario survival-kiosk.service (activada por survival-kiosk.path).
#
#  - Abre una página local de arranque (file://) que espera a /api/health y redirige a la app.
#  - Reinicia Chromium si se cierra (con espera creciente, sin bucles agresivos).
#  - Apaga la pantalla tras inactividad (swayidle + wlopm); un toque la enciende.
#  - Agente: lee órdenes de la UI por la FIFO /run/survival-os/kiosk.fifo.
#
# Mantenimiento (desde SSH, como el usuario de escritorio):
#   touch ~/.config/survival-os/kiosk.disabled; systemctl --user stop survival-kiosk
# Reactivar: rm ~/.config/survival-os/kiosk.disabled; systemctl --user start survival-kiosk
set -u

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
URL="${SURVIVAL_URL:-http://127.0.0.1:3000/}"
SCREEN_OFF_SECONDS="${SCREEN_OFF_SECONDS:-600}"
[ -r /etc/survival-os/kiosk.env ] && . /etc/survival-os/kiosk.env

BOOT_PAGE="file://$APP_DIR/kiosk/boot.html"
PROFILE="${XDG_DATA_HOME:-$HOME/.local/share}/survival-kiosk"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/survival-kiosk-cache"
DISABLE_FLAG="$HOME/.config/survival-os/kiosk.disabled"
FIFO=/run/survival-os/kiosk.fifo

log() { logger -t survival-kiosk -- "$*"; }

if [ -e "$DISABLE_FLAG" ]; then
  log "kiosco desactivado por $DISABLE_FLAG"
  exit 0
fi

# Evitar dos instancias.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/survival-kiosk.lock"
flock -n 9 || { log "ya en ejecución"; exit 0; }

children=()
cleanup() { for p in "${children[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

# --- Apagado de pantalla por inactividad ---
if [ "$SCREEN_OFF_SECONDS" -gt 0 ] 2>/dev/null && command -v swayidle >/dev/null && command -v wlopm >/dev/null; then
  swayidle -w timeout "$SCREEN_OFF_SECONDS" "wlopm --off '*'" resume "wlopm --on '*'" &
  children+=($!)
fi

# --- Agente de órdenes de la UI ---
agent() {
  while true; do
    if [ -p "$FIFO" ] && [ -r "$FIFO" ]; then
      if read -r cmd < "$FIFO"; then
        case "$cmd" in
          display-off)
            # swayidle de un solo uso: apaga en 2 s y, al primer toque, enciende y se termina.
            swayidle timeout 2 "wlopm --off '*'" resume "wlopm --on '*'; kill \$PPID" &
            log "pantalla apagada a petición de la UI"
            ;;
          exit-desktop)
            mkdir -p "$(dirname "$DISABLE_FLAG")" && touch "$DISABLE_FLAG"
            log "salida al escritorio a petición de la UI"
            pkill -u "$(id -u)" -f 'class=survival-kiosk' || true
            ;;
          *) log "orden desconocida ignorada" ;;
        esac
      fi
    else
      sleep 30
    fi
  done
}
agent &
children+=($!)

# --- Chromium ---
prepare_profile() {
  mkdir -p "$PROFILE/Default" "$CACHE_DIR"
  local prefs="$PROFILE/Default/Preferences"
  # Tras un corte de luz Chromium ofrece "restaurar páginas": se marca la salida como limpia.
  [ -f "$prefs" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
}

fails=0
while [ ! -e "$DISABLE_FLAG" ]; do
  prepare_profile
  started=$(date +%s)
  log "lanzando Chromium (intento tras $fails fallos rápidos)"
  chromium \
    --kiosk --ozone-platform=wayland \
    --user-data-dir="$PROFILE" --disk-cache-dir="$CACHE_DIR" --disk-cache-size=33554432 \
    --password-store=basic --no-first-run --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,HardwareMediaKeyHandling \
    --disable-background-networking --disable-component-update --disable-sync --disable-default-apps \
    --disable-domain-reliability --no-pings --check-for-update-interval=31536000 \
    --overscroll-history-navigation=0 --disable-pinch \
    --enable-wayland-ime --wayland-text-input-version=3 \
    --class=survival-kiosk \
    "$BOOT_PAGE" >/dev/null 2>&1
  ran=$(( $(date +%s) - started ))
  if [ "$ran" -lt 30 ]; then fails=$((fails + 1)); else fails=0; fi
  wait_s=$(( fails * 5 )); [ "$wait_s" -gt 60 ] && wait_s=60
  log "Chromium terminó tras ${ran}s; reintento en ${wait_s}s"
  sleep "$wait_s"
done
