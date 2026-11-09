#!/usr/bin/env bash
# Copia de seguridad de Survival OS a un directorio (normalmente una memoria USB).
#   sudo backup.sh <destino> [--with-maps] [--with-zim]
# Incluye: configuración (/etc/survival-os), waypoints y tracks, documentos propios de la
# biblioteca, manifiesto de contenidos y la bóveda CIFRADA (si está bloqueada).
# Mapas y ZIM son grandes y re-descargables: solo con --with-maps / --with-zim.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
DEST_ROOT="${1:?Uso: backup.sh <destino> [--with-maps] [--with-zim]}"
shift
WITH_MAPS=0; WITH_ZIM=0
for a in "$@"; do
  case "$a" in --with-maps) WITH_MAPS=1 ;; --with-zim) WITH_ZIM=1 ;; *) echo "Opción desconocida: $a" >&2; exit 2 ;; esac
done
DATA=/var/lib/survival-os
DEST="$DEST_ROOT/survival-os-backup-$(hostname)-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

candidates=(etc/survival-os var/lib/survival-os/navigation var/lib/survival-os/library/docs var/lib/survival-os/library/manifest.json)
[ "$WITH_MAPS" -eq 1 ] && candidates+=(var/lib/survival-os/maps)
[ "$WITH_ZIM" -eq 1 ] && candidates+=(var/lib/survival-os/library/zim)
paths=()
for p in "${candidates[@]}"; do [ -e "/$p" ] && paths+=("$p"); done
[ ${#paths[@]} -gt 0 ] || { echo "Nada que copiar." >&2; rm -rf "$DEST"; exit 1; }

need=$(du -scb "${paths[@]/#//}" 2>/dev/null | tail -1 | cut -f1)
avail=$(df -B1 --output=avail "$DEST_ROOT" | tail -1)
[ "$need" -lt "$avail" ] || { echo "Espacio insuficiente en $DEST_ROOT" >&2; rm -rf "$DEST"; exit 1; }

echo "==> Datos y configuración"
tar -C / -czf "$DEST/survival-os-data.tar.gz" "${paths[@]}"

if [ -f "$DATA/vault/vault.luks" ]; then
  echo "==> Bóveda (cifrada)"
  if /opt/survival-os/current/scripts/vault-backup.sh "$DEST" >/dev/null; then
    echo "    copia de la bóveda incluida"
  else
    echo "AVISO: bóveda desbloqueada o no copiable; bloquéala y repite para incluirla." >&2
  fi
fi

cp /opt/survival-os/current/VERSION "$DEST/VERSION"
(cd "$DEST" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS && sha256sum -c --quiet SHA256SUMS)
sync
echo "==> Copia verificada en $DEST ($(du -sh "$DEST" | cut -f1))"
echo "    Restaurar: sudo /opt/survival-os/current/scripts/restore.sh $DEST"
