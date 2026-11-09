#!/usr/bin/env bash
# Prueba de aceptación de la Fase 5 con un contenedor TEMPORAL (nunca toca la bóveda real).
#   sudo vault-selftest.sh
# Verifica: LUKS2 + Argon2id, contraseña errónea rechazada, documento ficticio ilegible en el
# contenedor (simulación de robo de la microSD) y copia/restauración de la cabecera LUKS. Total esperado: 11/11.
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
command -v cryptsetup >/dev/null || { echo "cryptsetup no instalado" >&2; exit 1; }

W="$(mktemp -d /var/tmp/vault-selftest.XXXXXX)"
IMG="$W/test.luks"; MAP="survival-vault-selftest"; MNT="$W/mnt"
PASS="prueba Selftest caballo bateria 2026"
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
