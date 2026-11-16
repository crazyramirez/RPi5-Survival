#!/bin/bash
# E2E de la API de la bóveda con una instancia TEMPORAL del servidor real (no toca la bóveda real).
#   sudo bash vault-e2e.sh      (en la Pi, tras instalar; esperado 14/14)
set -u
NODE=/opt/survival-os/runtime/node/bin/node
SRV=/opt/survival-os/current/services/vault/dist/server.js
T=$(mktemp -d /var/tmp/vault-e2e.XXXXXX)
R=$(mktemp -d /run/vault-e2e.XXXXXX); chmod 700 "$R"
SOCK="$R/v.sock"
VAULT_DIR="$T" VAULT_SOCKET="$SOCK" VAULT_MAPPER=survival-vault-e2e VAULT_MOUNT="$R/mnt" VAULT_KEY_TMP="$R" VAULT_MEDIA_ROOT=/nonexistent \
  "$NODE" "$SRV" > "$T/server.log" 2>&1 &
PID=$!
cleanup() { kill $PID 2>/dev/null; sleep 2; umount "$R/mnt" 2>/dev/null; cryptsetup close survival-vault-e2e 2>/dev/null; rm -rf "$T" "$R"; }
trap cleanup EXIT
for i in $(seq 1 40); do [ -S "$SOCK" ] && break; sleep 0.25; done
api() { curl -s --max-time 300 --unix-socket "$SOCK" -X "$1" -H 'content-type: application/json' ${3:+-d "$3"} "http://v$2"; }
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1'))"; }
N=0; F=0
chk() { if [ "$2" = "$3" ]; then echo "  [OK]   $1"; N=$((N+1)); else echo "  [FAIL] $1 (obtenido '$2', esperado '$3')"; F=$((F+1)); fi; }

r=$(api POST /setup '{"passphrase":"2580","sizeMiB":64}')
RK=$(echo "$r" | j newRecoveryKey)
chk "setup con PIN 2580 devuelve clave de recuperación" "$(echo "$RK" | grep -cE '^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$')" "1"
chk "estado: recoveryKey=true" "$(echo "$r" | j recoveryKey)" "True"
chk "sin ficheros de clave en tmpfs" "$(ls -A "$R" | grep -c '^\.k-')" "0"
chk "unlock con PIN" "$(api POST /unlock '{"passphrase":"2580"}' | j unlocked)" "True"
chk "lock" "$(api POST /lock | j unlocked)" "False"
chk "recover con clave errónea → 401" "$(api POST /recover '{"recoveryKey":"0000-0000-0000-0000-0000-0000-0000-0000","newPassphrase":"7391"}' | j error)" "Clave de recuperación incorrecta"
LOW=$(echo "$RK" | tr 'A-Z' 'a-z' | tr '-' ' ')
r=$(api POST /recover "{\"recoveryKey\":\"$LOW\",\"newPassphrase\":\"7391\"}")
chk "recover con la clave (en minúsculas y espacios)" "$(echo "$r" | j error)" "None"
chk "el PIN viejo ya no abre" "$(api POST /unlock '{"passphrase":"2580"}' | j error)" "Contraseña incorrecta"
chk "abre con el PIN nuevo" "$(api POST /unlock '{"passphrase":"7391"}' | j unlocked)" "True"
api POST /lock >/dev/null
r=$(api POST /recovery-key '{"passphrase":"7391"}')
RK2=$(echo "$r" | j newRecoveryKey)
chk "regenerar clave de recuperación" "$(echo "$RK2" | grep -cE '^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$')" "1"
chk "la clave anterior deja de valer" "$(api POST /recover "{\"recoveryKey\":\"$RK\",\"newPassphrase\":\"8642\"}" | j error)" "Clave de recuperación incorrecta"
chk "keyslots finales = 2" "$(cryptsetup luksDump "$T/vault.luks" | sed -n '/^Keyslots:/,/^Tokens:/p' | grep -cE '^ +[0-9]+: luks2')" "2"
r=$(api POST /discard '{"confirm":"DESCARTAR"}')
chk "descartar: queda sin configurar" "$(echo "$r" | j configured)" "False"
chk "descartar: contenedor apartado, no borrado" "$(ls "$T" | grep -c '^vault.luks.descartada-')" "1"
grep -q '"level":"error"' "$T/server.log" && { echo "  log de errores:"; grep '"level":"error"' "$T/server.log"; }
echo "Resultado E2E: $N OK · $F fallos"
