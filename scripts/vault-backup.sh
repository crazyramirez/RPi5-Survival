#!/usr/bin/env bash
# Copia de seguridad CIFRADA de la bóveda (el contenedor ya está cifrado; nunca se descifra aquí).
#   sudo vault-backup.sh <directorio-destino>          p. ej. /media/<usuario>/USB-RESPALDO
#   sudo vault-backup.sh --restore <directorio-copia>  (pide confirmación; no sobrescribe sin --force)
# Requiere la bóveda BLOQUEADA para obtener una copia coherente.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
VAULT=/var/lib/survival-os/vault/vault.luks
MAP=survival-vault

if cryptsetup status "$MAP" >/dev/null 2>&1; then
  echo "La bóveda está desbloqueada: bloquéala desde la interfaz antes de copiarla." >&2
  exit 1
fi

if [ "${1:-}" = "--restore" ]; then
  SRC="${2:?Indica el directorio de la copia}"
  FORCE="${3:-}"
  (cd "$SRC" && sha256sum -c SHA256SUMS) || { echo "Copia corrupta: SHA-256 no coincide" >&2; exit 1; }
  if [ -f "$VAULT" ] && [ "$FORCE" != "--force" ]; then
    echo "Ya existe una bóveda. Para sustituirla: vault-backup.sh --restore <dir> --force" >&2
    exit 1
  fi
  systemctl stop survival-vault.service || true
  [ -f "$VAULT" ] && mv "$VAULT" "$VAULT.antes-de-restaurar-$(date +%Y%m%d%H%M%S)"
  install -m 0600 -o root -g root "$SRC/vault.luks" "$VAULT"
  systemctl start survival-vault.service
  echo "Restaurada. Comprueba que se desbloquea con tu contraseña antes de borrar la copia anterior."
  exit 0
fi

DEST_ROOT="${1:?Indica el directorio destino (por ejemplo, una memoria USB)}"
[ -f "$VAULT" ] || { echo "No hay bóveda que copiar." >&2; exit 1; }
DEST="$DEST_ROOT/survival-vault-$(date +%Y%m%d-%H%M%S)"
size=$(stat -c %s "$VAULT"); avail=$(df -B1 --output=avail "$DEST_ROOT" | tail -1)
[ "$size" -lt "$avail" ] || { echo "Espacio insuficiente en $DEST_ROOT" >&2; exit 1; }
mkdir -p "$DEST"
cp --sparse=always "$VAULT" "$DEST/vault.luks"
cryptsetup luksHeaderBackup --batch-mode "$VAULT" --header-backup-file "$DEST/vault.luks-header.bak"
(cd "$DEST" && sha256sum vault.luks vault.luks-header.bak > SHA256SUMS && sha256sum -c --quiet SHA256SUMS)
sync
cat > "$DEST/LEEME.txt" <<'TXT'
Copia CIFRADA de la bóveda de Survival OS (LUKS2). Sin la contraseña es ilegible.
- vault.luks: contenedor completo.  vault.luks-header.bak: copia de la cabecera (permite recuperar
  el contenedor si su cabecera se daña; protégela igual que el contenedor).
- Restaurar: sudo /opt/survival-os/current/scripts/vault-backup.sh --restore <este-directorio>
TXT
echo "==> Copia verificada en $DEST"
