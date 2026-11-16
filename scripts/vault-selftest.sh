#!/usr/bin/env bash
# Prueba de aceptación de la Fase 5 con un contenedor TEMPORAL (nunca toca la bóveda real).
#   sudo vault-selftest.sh
# Verifica: LUKS2 + Argon2id, contraseña errónea rechazada, documento ficticio ilegible en el
# contenedor (simulación de robo de la microSD), clave de recuperación (ADR 0013) y copia/restauración
# de la cabecera LUKS. Total esperado: 17/17.
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
command -v cryptsetup >/dev/null || { echo "cryptsetup no instalado" >&2; exit 1; }

W="$(mktemp -d /var/tmp/vault-selftest.XXXXXX)"
IMG="$W/test.luks"; MAP="survival-vault-selftest"; MNT="$W/mnt"
PASS="prueba Selftest caballo bateria 2026"
RK="7K3M-Q9XA-2B4C-HJ5N-8PRS-6TVW-0YZ1-DE7F"   # formato de clave de recuperación (ficticia)
NEWPASS="2580"                                  # PIN corto: permitido en equipo personal
MARKER="SURVIVAL-OS-DOCUMENTO-FICTICIO-$(date +%s)-NO-DEBE-VERSE"
PASS_N=0; FAIL_N=0
ok() { echo "  [OK]   $*"; PASS_N=$((PASS_N+1)); }
bad() { echo "  [FAIL] $*"; FAIL_N=$((FAIL_N+1)); }
cleanup() {
  umount "$MNT" 2>/dev/null; cryptsetup close "$MAP" 2>/dev/null
  rm -rf "$W"
}
trap cleanup EXIT
mkdir -p "$MNT"

echo "== Creación (64 MiB, LUKS2, Argon2id)"
fallocate -l 64M "$IMG"
printf '%s' "$PASS" | cryptsetup luksFormat --batch-mode --type luks2 --pbkdf argon2id --pbkdf-memory 262144 --iter-time 1000 --key-file=- "$IMG" \
  && ok "luksFormat" || bad "luksFormat"
dump=$(cryptsetup luksDump "$IMG")
echo "$dump" | grep -q "PBKDF:.*argon2id" && ok "KDF Argon2id" || bad "KDF no es Argon2id"
echo "$dump" | grep -qE "cipher: *aes-xts-plain64" && ok "Cifrado AES-XTS" || bad "Cifrado inesperado"

echo "== Contraseña"
printf '%s' "contraseña equivocada" | cryptsetup open --key-file=- "$IMG" "$MAP" 2>/dev/null && { bad "Abre con contraseña errónea"; cryptsetup close "$MAP"; } || ok "Contraseña errónea rechazada"
printf '%s' "$PASS" | cryptsetup open --key-file=- "$IMG" "$MAP" && ok "Abre con la contraseña correcta" || bad "No abre con la correcta"

echo "== Documento ficticio"
mkfs.ext4 -q "/dev/mapper/$MAP" && mount "/dev/mapper/$MAP" "$MNT"
for i in $(seq 1 200); do echo "$MARKER línea $i" ; done > "$MNT/documento-ficticio.txt"

sync; umount "$MNT"; cryptsetup close "$MAP"
echo 1 > /proc/sys/vm/drop_caches
if grep -qa "$MARKER" "$IMG"; then bad "El texto del documento aparece en claro en el contenedor"; else ok "Contenedor sin texto en claro (robo de SD simulado)"; fi
if strings -n 12 "$IMG" | grep -q "SURVIVAL-OS-DOCUMENTO"; then bad "Fragmentos legibles"; else ok "Sin fragmentos legibles"; fi

echo "== Clave de recuperación (código REAL del servicio: services/vault/dist/luks.js)"
# Se ejecutan las mismas funciones que usa survival-vault (addKey, slotForKey, killSlotsExcept),
# no una imitación en bash: así se detectan fallos como el de /dev/fd/3 (sockets de Node).
HERE="$(cd "$(dirname "$0")" && pwd)"
LUKS_JS="$HERE/../services/vault/dist/luks.js"
NODE_BIN="${NODE_BIN:-/opt/survival-os/runtime/node/bin/node}"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
KEYTMP="$(mktemp -d /run/vault-selftest-keys.XXXXXX)"; chmod 700 "$KEYTMP"
if [ -f "$LUKS_JS" ] && [ -n "$NODE_BIN" ]; then
  out=$(IMG="$IMG" KEYTMP="$KEYTMP" PASS="$PASS" RK="$RK" NEWPASS="$NEWPASS" LUKS_JS="$LUKS_JS" "$NODE_BIN" --input-type=module -e '
    const { pathToFileURL } = await import("node:url")
    const { readdirSync } = await import("node:fs")
    const L = await import(pathToFileURL(process.env.LUKS_JS).href)
    const e = process.env
    const p = { container: e.IMG, mapper: "unused", mountPoint: "/nonexistent", keyTmpDir: e.KEYTMP }
    const say = (k, v) => console.log(`${k}=${v}`)
    try {
      const rkSlot = await L.addKey(p, e.PASS, e.RK)
      say("added", rkSlot)
      say("leftover", readdirSync(e.KEYTMP).length)
      say("rkslot", await L.slotForKey(p, e.RK))
      say("wrong", await L.slotForKey(p, "clave equivocada"))
      // Recuperación: contraseña nueva con la clave y borrado del keyslot de la olvidada.
      const passSlot = await L.addKey(p, e.RK, e.NEWPASS)
      await L.killSlotsExcept(p, [rkSlot, passSlot], e.RK)
      say("slots", (await L.activeSlots(p)).join(","))
      say("old", await L.slotForKey(p, e.PASS))
      say("new", await L.slotForKey(p, e.NEWPASS))
      say("rkafter", await L.slotForKey(p, e.RK))
    } catch (err) { say("error", String(err.message).replace(/\n/g, " ")) }
  ' 2>&1)
  get() { echo "$out" | sed -n "s/^$1=//p"; }
  [ -z "$(get error)" ] || bad "Error del servicio: $(get error)"
  [ "$(get added)" = "1" ] && ok "addKey (fichero efímero en tmpfs) añade la clave en keyslot 1" || bad "addKey: '$(get added)'"
  [ "$(get leftover)" = "0" ] && ok "No queda el fichero de clave en tmpfs" || bad "Quedan ficheros de clave: '$(get leftover)'"
  [ "$(get rkslot)" = "1" ] && [ "$(get wrong)" = "null" ] && ok "slotForKey identifica la clave y rechaza una errónea" || bad "slotForKey: '$(get rkslot)' / '$(get wrong)'"
  [ "$(get old)" = "null" ] && ok "La contraseña olvidada ya no abre" || bad "La olvidada abre el keyslot '$(get old)'"
  [ -n "$(get new)" ] && [ "$(get new)" != "null" ] && ok "Abre con la contraseña nueva" || bad "No abre con la nueva"
  [ "$(get rkafter)" = "1" ] && [ "$(get slots)" = "1,$(get new)" ] && ok "La clave de recuperación sigue valiendo (keyslots $(get slots))" || bad "Keyslots finales: '$(get slots)'"
else
  bad "No se encuentra $LUKS_JS o Node"
fi
rm -rf "$KEYTMP"
PASS="$NEWPASS"

echo "== Copia y restauración de cabecera"
cryptsetup luksHeaderBackup --batch-mode "$IMG" --header-backup-file "$W/header.bak" && ok "Copia de cabecera" || bad "Copia de cabecera"
dd if=/dev/zero of="$IMG" bs=1M count=16 conv=notrunc status=none   # daña la cabecera del contenedor TEMPORAL
printf '%s' "$PASS" | cryptsetup open --key-file=- "$IMG" "$MAP" 2>/dev/null && { bad "Abre con cabecera dañada"; cryptsetup close "$MAP"; } || ok "Cabecera dañada: no abre (esperado)"
cryptsetup luksHeaderRestore --batch-mode "$IMG" --header-backup-file "$W/header.bak" && ok "Cabecera restaurada" || bad "Restauración"
if printf '%s' "$PASS" | cryptsetup open --key-file=- "$IMG" "$MAP"; then
  mount -o ro "/dev/mapper/$MAP" "$MNT" && grep -q "$MARKER" "$MNT/documento-ficticio.txt" && ok "Documento recuperado tras restaurar" || bad "Documento no recuperado"
  umount "$MNT"; cryptsetup close "$MAP"
else
  bad "No abre tras restaurar"
fi

echo
echo "Resultado: $PASS_N OK · $FAIL_N fallos"
[ "$FAIL_N" -eq 0 ]
