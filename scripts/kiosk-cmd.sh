#!/usr/bin/env bash
# Órdenes de la UI para el quiosco Survivelia OS. Lo ejecuta el agente de scripts/kiosk.sh (usuario de escritorio,
# dentro de la sesión gráfica) por la ruta `current`: así cada actualización trae sus órdenes nuevas sin tener que
# reiniciar el quiosco ni la Pi. Lista cerrada: lo que no está aquí se ignora.
#   kiosk-cmd.sh display-off | exit-desktop | touchpad-scroll natural|traditional | touchpad-status
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
DISABLE_FLAG="$HOME/.config/survival-os/kiosk.disabled"
log() { logger -t survival-kiosk -- "$*"; }

case "${1:-}" in
  display-off)
    # swayidle de un solo uso: apaga en 2 s y, al primer toque, enciende y se termina.
    swayidle timeout 2 "wlopm --off '*'" resume "wlopm --on '*'; kill \$PPID" >/dev/null 2>&1 &
    log "pantalla apagada a petición de la UI"
    ;;
  exit-desktop)
    mkdir -p "$(dirname "$DISABLE_FLAG")" && touch "$DISABLE_FLAG"
    log "salida al escritorio a petición de la UI"
    pkill -u "$(id -u)" -f 'class=survival-kiosk' || true
    ;;
  'touchpad-scroll natural' | 'touchpad-scroll traditional')
    # Dirección del desplazamiento del trackpad (rc.xml de labwc + recarga); publica el estado para la web.
    mode="${1#touchpad-scroll }"
    if python3 -I "$HERE/kiosk-input.py" set "$mode"; then
      log "trackpad: desplazamiento $mode"
    else
      log "trackpad: no se pudo cambiar el desplazamiento"
    fi
    ;;
  touchpad-status)
    python3 -I "$HERE/kiosk-input.py" status 2>/dev/null || log "trackpad: estado no publicado"
    ;;
  *) log "orden desconocida ignorada" ;;
esac
