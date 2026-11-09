#!/usr/bin/env bash
# Vigilante de aplicación (ejecutado por survival-healthcheck.timer como root).
# Reinicia un servicio solo tras 3 comprobaciones fallidas seguidas (~3 min) para no
# generar bucles de reinicio que desgasten la microSD.
set -u
STATE_DIR=/run/survival-os
mkdir -p "$STATE_DIR"
URL="http://127.0.0.1:${NITRO_PORT:-3000}/api/health"
THRESHOLD=3

# Salud de la microSD: contadores de error del controlador (debugfs, solo root) → JSON
# legible por device-api (usuario sin privilegios). Sin datos → no se escribe nada.
ERR=/sys/kernel/debug/mmc0/err_stats
if [ -r "$ERR" ]; then
  awk -F: -v now="$(date -Is)" '
    /Command Timeout Occurred/ {ct=$2+0} /Data Timeout Occurred/ {dt=$2+0}
    /Request Timedout/ && !/CMDQ/ {rt=$2+0} /Data CRC Errors/ {crc=$2+0} /Command CRC Errors/ {ccrc=$2+0}
    END {printf "{\"commandTimeouts\":%d,\"dataTimeouts\":%d,\"requestTimeouts\":%d,\"crcErrors\":%d,\"at\":\"%s\"}\n", ct, dt, rt, crc+ccrc, now}
  ' "$ERR" > "$STATE_DIR/sd-health.json.tmp" && mv "$STATE_DIR/sd-health.json.tmp" "$STATE_DIR/sd-health.json"
  chmod 0644 "$STATE_DIR/sd-health.json"
fi

bump() { # $1 = clave → imprime el nuevo contador
  local f="$STATE_DIR/health.$1" n
  n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$f"; echo "$n"
}
reset() { rm -f "$STATE_DIR"/health."$1"; }

body=$(curl -s -m 8 "$URL" 2>/dev/null); rc=$?
if [ $rc -ne 0 ] || [ -z "$body" ]; then
  n=$(bump web)
  logger -t survival-health "web sin respuesta ($n/$THRESHOLD)"
  if [ "$n" -ge $THRESHOLD ]; then
    logger -t survival-health "reiniciando survival-web"
    systemctl restart survival-web.service; reset web
  fi
  exit 0
fi
reset web

# Componentes caídos según /api/health → unidad systemd correspondiente.
down=$(printf '%s' "$body" | python3 -c '
import json, sys
units = {"deviceApi": "survival-device-api", "library": "survival-library", "kiwix": "survival-kiwix",
         "navigation": "survival-navigation", "esp32Gateway": "survival-esp32-gateway"}
try:
    comps = json.load(sys.stdin).get("components", {})
except Exception:
    sys.exit(0)
for name, c in comps.items():
    if c.get("state") == "down" and name in units:
        print(units[name])
')
for unit in $down; do
  systemctl is-enabled --quiet "$unit" 2>/dev/null || continue
  n=$(bump "$unit")
  logger -t survival-health "$unit caído ($n/$THRESHOLD)"
  if [ "$n" -ge $THRESHOLD ]; then
    logger -t survival-health "reiniciando $unit"
    systemctl restart "$unit.service"; reset "$unit"
  fi
done
for f in "$STATE_DIR"/health.survival-*; do
  [ -e "$f" ] || continue
  u=${f##*/health.}
  printf '%s\n' "$down" | grep -qx "$u" || rm -f "$f"
done
exit 0
