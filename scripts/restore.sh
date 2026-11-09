#!/usr/bin/env bash
# Restaura una copia hecha con backup.sh sobre una instalación de Survival OS.
#   sudo restore.sh <directorio-copia> [--force]
# Verifica SHA-256 antes de tocar nada. Los datos actuales se apartan (no se borran).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
SRC="${1:?Uso: restore.sh <directorio-copia> [--force]}"
FORCE="${2:-}"
(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || { echo "Copia corrupta (SHA-256)" >&2; exit 1; }
[ -d /opt/survival-os/current ] || { echo "Instala primero Survival OS (install-system.sh)" >&2; exit 1; }
if [ "$FORCE" != "--force" ]; then
  echo "Se restaurarán configuración y datos desde $SRC (los actuales se apartan con sufijo .antes-*)."
  echo "Repite con --force para continuar."
  exit 1
fi

STAMP=$(date +%Y%m%d%H%M%S)
UNITS="survival-web survival-navigation survival-library"
systemctl stop $UNITS 2>/dev/null || true
for d in /etc/survival-os /var/lib/survival-os/navigation /var/lib/survival-os/library/docs; do
  [ -e "$d" ] && cp -a "$d" "$d.antes-$STAMP"
done
tar -C / -xzf "$SRC/survival-os-data.tar.gz"
chown -R survival:survival /var/lib/survival-os/navigation /var/lib/survival-os/library
chown -R root:survival /etc/survival-os
systemctl start $UNITS

vault_dir=$(find "$SRC" -maxdepth 1 -type d -name 'survival-vault-*' | sort | tail -1)
if [ -n "$vault_dir" ]; then
  echo "==> Hay copia de la bóveda en $vault_dir"
  echo "    Para restaurarla: sudo /opt/survival-os/current/scripts/vault-backup.sh --restore $vault_dir [--force]"
fi
echo "==> Restaurado. Datos anteriores conservados con sufijo .antes-$STAMP"
