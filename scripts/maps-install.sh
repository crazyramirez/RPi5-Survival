#!/usr/bin/env bash
# Instala un paquete cartográfico .pmtiles preparado en un PC.
#   sudo maps-install.sh <region-AAAAMMDD-zN.pmtiles> [sha256-esperado]
# Ejemplo de preparación en el PC (go-pmtiles, datos © OpenStreetMap, ODbL):
#   pmtiles extract https://build.protomaps.com/20261108.pmtiles espana-20261108-z15.pmtiles \
#     --bbox=-9.5,35.9,4.4,43.9 --maxzoom=15
set -euo pipefail
SRC="${1:?Uso: maps-install.sh fichero.pmtiles [sha256]}"
EXPECTED="${2:-}"
DIR=/var/lib/survival-os/maps
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
name="$(basename "$SRC")"
[[ "$name" =~ ^[A-Za-z0-9_-]{1,80}\.pmtiles$ ]] || { echo "Nombre no válido: $name" >&2; exit 1; }
head -c 7 "$SRC" | grep -q '^PMTiles' || { echo "No es un archivo PMTiles v3" >&2; exit 1; }
size=$(stat -c %s "$SRC"); avail=$(df -B1 --output=avail "$DIR" | tail -1)
[ "$size" -lt $((avail - 2*1024*1024*1024)) ] || { echo "Espacio insuficiente" >&2; exit 1; }
actual=$(sha256sum "$SRC" | awk '{print $1}')
if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$actual" ]; then echo "SHA-256 no coincide" >&2; exit 1; fi
install -d -o survival -g survival -m 0755 "$DIR"
cp "$SRC" "$DIR/$name.part" && mv "$DIR/$name.part" "$DIR/$name"
chown survival:survival "$DIR/$name"; chmod 0644 "$DIR/$name"
echo "$actual  $name" >> "$DIR/SHA256SUMS"
echo "==> Instalado $name ($((size / 1024 / 1024)) MiB, sha256 $actual)"
