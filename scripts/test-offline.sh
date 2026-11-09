#!/usr/bin/env bash
# Prueba de funcionamiento offline de una release (Linux / Raspberry Pi).
#
# Arranca una instancia TEMPORAL en puertos alternativos (no interfiere con la que
# esté en marcha), y comprueba:
#   1. Estático: el HTML/CSS no referencia recursos externos.
#   2. Ejecución: health, estado del dispositivo, assets locales, CSP restrictiva.
#   3. Seguridad: escucha solo en loopback; /boveda denegada a peticiones reenviadas.
#   4. Los procesos no abren conexiones TCP fuera de loopback.
#
# NO desactiva Wi-Fi/Ethernet (cortaría la sesión SSH). La prueba con radio apagada
# se hace a mano siguiendo docs/commissioning.md.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${SURVIVAL_OS_HOME:-$HOME/survival-os}"
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  for c in /opt/survival-os/runtime/node/bin/node "$PREFIX/runtime/node/bin/node" "$(command -v node || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && { NODE_BIN="$c"; break; }
  done
fi
WEB_PORT="${TEST_WEB_PORT:-3900}"
API_PORT="${TEST_API_PORT:-8790}"
BASE="http://127.0.0.1:$WEB_PORT"
PUBLIC="$APP_DIR/apps/frontend/.output/public"

PASS=0; FAIL=0; WARN=0
ok()   { echo "  [OK]   $*"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN+1)); }

[ -x "$NODE_BIN" ] || { echo "Node no encontrado (NODE_BIN)"; exit 2; }
command -v curl >/dev/null || { echo "curl no instalado"; exit 2; }

echo "== 1. Análisis estático ($PUBLIC)"
if [ ! -d "$PUBLIC" ]; then
  bad "No existe $PUBLIC"
else
  ext_html=$(grep -RhoE '(src|href)="https?://[^"]+' "$PUBLIC" --include='*.html' 2>/dev/null | sort -u)
  [ -z "$ext_html" ] && ok "HTML sin recursos externos" || { bad "HTML referencia recursos externos:"; echo "$ext_html" | sed 's/^/         /'; }
  ext_css=$(grep -RhoE '(url\(|@import )["'"'"']?https?://[^)"'"'"' ]+' "$PUBLIC" --include='*.css' 2>/dev/null | sort -u)
  [ -z "$ext_css" ] && ok "CSS sin recursos externos" || { bad "CSS referencia recursos externos:"; echo "$ext_css" | sed 's/^/         /'; }
  js_hosts=$(grep -RhoE 'https?://[a-zA-Z0-9.-]+' "$PUBLIC" --include='*.js' 2>/dev/null | sed -E 's#https?://##' | grep -vE '^(www\.w3\.org|localhost|127\.0\.0\.1)$' | sort -u | tr '\n' ' ')
  [ -z "$js_hosts" ] && ok "JS sin URLs externas" || warn "JS contiene cadenas con URLs (no se cargan; la CSP las bloquearía): $js_hosts"
  fonts=$(find "$PUBLIC" -name '*.woff2' | wc -l)
  [ "$fonts" -gt 0 ] && ok "Tipografías empaquetadas localmente ($fonts woff2)" || bad "No hay tipografías locales"
fi

echo "== 2. Instancia temporal en 127.0.0.1:$WEB_PORT (API :$API_PORT)"
LOG="$(mktemp)"
export NITRO_HOST=127.0.0.1 NITRO_PORT=$WEB_PORT DEVICE_API_HOST=127.0.0.1 DEVICE_API_PORT=$API_PORT
export NUXT_DEVICE_API_URL="http://127.0.0.1:$API_PORT"
"$NODE_BIN" "$APP_DIR/scripts/start.mjs" >"$LOG" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

for _ in $(seq 1 40); do
  curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null && break
  sleep 0.5
done

health=$(curl -sS -w '\n%{http_code}' "$BASE/api/health" 2>/dev/null)
code=$(echo "$health" | tail -1)
if [ "$code" = "200" ] && echo "$health" | grep -qE '"status":"(ok|degraded)"'; then
  ok "/api/health 200 ($(echo "$health" | grep -oE '"status":"[a-z]+"' | head -1))"
else
  bad "/api/health → $code"; sed 's/^/         /' "$LOG" | tail -20
fi

status_json=$(curl -fsS "$BASE/api/device/status" 2>/dev/null)
echo "$status_json" | grep -q '"collectedAt"' && ok "/api/device/status responde" || bad "/api/device/status no responde"
echo "$status_json" | grep -q '"battery":{"state":"ok"' && warn "Batería informada como medida: verificar que existe un medidor real" || ok "Batería no inventada"

headers=$(curl -sS -D - -o "$LOG.index" "$BASE/" 2>/dev/null)
echo "$headers" | head -1 | grep -q ' 200' && ok "/ responde 200" || bad "/ no responde 200"
echo "$headers" | grep -qi "content-security-policy: default-src 'self'" && ok "CSP restrictiva (default-src 'self')" || bad "Falta CSP restrictiva"

assets=$(grep -oE '(src|href)="/_nuxt/[^"]+' "$LOG.index" 2>/dev/null | sed -E 's/^(src|href)="//' | sort -u)
missing=0
for a in $assets; do curl -fsS -o /dev/null "$BASE$a" || { missing=$((missing+1)); echo "         falta $a"; }; done
[ -n "$assets" ] && [ "$missing" -eq 0 ] && ok "Assets locales servidos ($(echo "$assets" | wc -w))" || bad "Assets ausentes: $missing"
rm -f "$LOG.index"

echo "== 3. Seguridad de red"
c_local=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/boveda")
[ "$c_local" = "200" ] && ok "/boveda accesible desde loopback" || bad "/boveda desde loopback → $c_local"
c_fwd=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 192.0.2.10' "$BASE/boveda")
[ "$c_fwd" = "403" ] && ok "/boveda denegada a petición reenviada (403)" || bad "/boveda con X-Forwarded-For → $c_fwd"
c_api=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 192.0.2.10' "$BASE/api/vault/x")
[ "$c_api" = "403" ] && ok "/api/vault denegada a petición reenviada (403)" || bad "/api/vault con X-Forwarded-For → $c_api"

LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -n "$LAN_IP" ]; then
  if curl -s -m 2 -o /dev/null "http://$LAN_IP:$WEB_PORT/" 2>/dev/null; then bad "La web responde en $LAN_IP (debe ser solo loopback)"; else ok "Web no accesible por $LAN_IP"; fi
  if curl -s -m 2 -o /dev/null "http://$LAN_IP:$API_PORT/health" 2>/dev/null; then bad "device-api responde en $LAN_IP"; else ok "device-api no accesible por $LAN_IP"; fi
else
  ok "Sin interfaz LAN activa (modo offline)"
fi

echo "== 4. Conexiones salientes de los procesos"
pids="$PID $(pgrep -P "$PID" | tr '\n' ' ')"
external=""
if command -v ss >/dev/null; then
  for p in $pids; do
    external+=$(ss -tnpH 2>/dev/null | grep "pid=$p," | awk '{print $5}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)' || true)
  done
  [ -z "$external" ] && ok "Sin conexiones TCP fuera de loopback" || bad "Conexiones externas: $external"
else
  warn "ss no disponible; no se comprueban conexiones"
fi

echo "== 5. Instancia del sistema (systemd)"
if systemctl is-active --quiet survival-web 2>/dev/null; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3000/api/health)
  [ "$code" = "200" ] && ok "survival-web responde /api/health 200" || bad "survival-web /api/health → $code"
  for u in survival-web survival-device-api; do
    pid=$(systemctl show -p MainPID --value "$u")
    user=$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')
    [ "$user" = "survival" ] && ok "$u corre como 'survival' (pid $pid)" || bad "$u corre como '$user'"
    deny=$(systemctl show -p IPAddressDeny --value "$u")
    [ -n "$deny" ] && ok "$u con IPAddressDeny=$deny" || bad "$u sin IPAddressDeny"
  done
  systemctl is-active --quiet survival-healthcheck.timer && ok "Vigilante de salud activo" || bad "survival-healthcheck.timer inactivo"
else
  warn "survival-web no está instalado como servicio (modo manual de Fase 1)"
fi

echo
echo "Resultado: $PASS OK · $WARN avisos · $FAIL fallos"
[ "$FAIL" -eq 0 ]
