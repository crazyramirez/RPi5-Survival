#!/usr/bin/env bash
# Rutas sin conexión (ADR 0010): BRouter 1.7.10 + datos OSM por cuadrículas de 5°.
#   sudo routing-install.sh install <región>...     regiones: espana canarias
#   sudo routing-install.sh remove                  quita datos y servicio (BRouter y Java se quedan)
# Lo lanza la tarea `routing` de Mantenimiento. Necesita red SOLO durante la instalación.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }

BROUTER_VERSION=1.7.10
BROUTER_ZIP="brouter-$BROUTER_VERSION.zip"
BROUTER_URL="https://github.com/abrensch/brouter/releases/download/v$BROUTER_VERSION/$BROUTER_ZIP"
# SHA-256 publicado por GitHub para el asset (comprobado al fijar la versión, 2026-11-09).
BROUTER_SHA256=023fec3ba997758e8cd7ab9e1bae52e962af3f00b57683e3de86b84ffad01532
SEGMENTS_URL="https://brouter.de/brouter/segments4"

RUNTIME=/opt/survival-os/runtime
BDIR="$RUNTIME/brouter-$BROUTER_VERSION"
DATA=/var/lib/survival-os/routing
SEG="$DATA/segments4"

# Cuadrículas de 5°×5° (nombre = esquina suroeste). España peninsular + Baleares; Canarias.
declare -A REGIONS=(
  [espana]="W10_N35 W10_N40 W5_N35 W5_N40 E0_N35 E0_N40"
  [canarias]="W20_N25 W15_N25"
)

info() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

install_java() {
  if command -v java >/dev/null 2>&1; then
    info "Java ya instalado: $(java -version 2>&1 | head -n1)"
    return
  fi
  info "Instalando Java (openjdk-17-jre-headless)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-17-jre-headless >/dev/null 2>&1 || {
    apt-get update >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-17-jre-headless >/dev/null
  }
  info "$(java -version 2>&1 | head -n1)"
}

install_brouter() {
  if [ -f "$BDIR/brouter.jar" ] && [ -d "$BDIR/profiles2" ]; then
    info "BRouter $BROUTER_VERSION ya instalado"
  else
    info "Descargando BRouter $BROUTER_VERSION"
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL --proto '=https' -o "$tmp/$BROUTER_ZIP" "$BROUTER_URL"
    echo "$BROUTER_SHA256  $tmp/$BROUTER_ZIP" | sha256sum -c - >/dev/null || { rm -rf "$tmp"; die "SHA-256 de BRouter incorrecto"; }
    command -v unzip >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends unzip >/dev/null
    unzip -q "$tmp/$BROUTER_ZIP" -d "$tmp/x"
    rm -rf "$BDIR"
    install -d -m 0755 "$BDIR"
    cp "$tmp/x/brouter-$BROUTER_VERSION/brouter-$BROUTER_VERSION-all.jar" "$BDIR/brouter.jar"
    cp -r "$tmp/x/brouter-$BROUTER_VERSION/profiles2" "$BDIR/profiles2"
    chown -R root:root "$BDIR"
    chmod -R a+rX "$BDIR"
    rm -rf "$tmp"
  fi
  ln -sfn "$BDIR" "$RUNTIME/brouter"
}

fetch_segments() {
  install -d -o survival -g survival -m 0750 "$DATA" "$SEG" "$DATA/customprofiles"
  local name url tmp expected size
  for name in "$@"; do
    url="$SEGMENTS_URL/$name.rd5"
    tmp="$SEG/$name.rd5.part"
    info "Descargando $name.rd5"
    # Tamaño anunciado por el servidor: la descarga debe coincidir exactamente (no publican checksums).
    expected="$(curl -fsSIL --proto '=https' "$url" | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v}')"
    curl -fSL --proto '=https' --retry 3 -o "$tmp" "$url"
    size="$(stat -c %s "$tmp")"
    if [ -n "$expected" ] && [ "$size" != "$expected" ]; then
      rm -f "$tmp"
      die "$name.rd5 incompleto ($size de $expected bytes)"
    fi
    [ "$size" -gt 100000 ] || { rm -f "$tmp"; die "$name.rd5 demasiado pequeño ($size bytes)"; }
    mv -f "$tmp" "$SEG/$name.rd5"
    chown survival:survival "$SEG/$name.rd5"
    chmod 0640 "$SEG/$name.rd5"
  done
}

write_manifest() {
  # Manifiesto honesto: lo que hay en disco, con SHA-256 calculado aquí y fecha de descarga.
  local out="$DATA/manifest.json" first=1 f
  {
    printf '{"brouter":"%s","downloadedAt":"%s","segments":[' "$BROUTER_VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for f in "$SEG"/*.rd5; do
      [ -e "$f" ] || continue
      [ $first -eq 1 ] || printf ','
      first=0
      printf '{"name":"%s","bytes":%s,"sha256":"%s","mtime":"%s"}' \
        "$(basename "$f" .rd5)" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)" "$(date -u -r "$f" +%Y-%m-%dT%H:%M:%SZ)"
    done
    printf ']}\n'
  } >"$out.tmp"
  mv -f "$out.tmp" "$out"
  chown survival:survival "$out"
}

case "${1:-}" in
  install)
    shift
    [ $# -gt 0 ] || die "indica al menos una región: ${!REGIONS[*]}"
    tiles=()
    for r in "$@"; do
      [ -n "${REGIONS[$r]:-}" ] || die "región desconocida: $r"
      read -r -a t <<<"${REGIONS[$r]}"
      tiles+=("${t[@]}")
    done
    install_java
    install_brouter
    fetch_segments "${tiles[@]}"
    write_manifest
    systemctl daemon-reload
    systemctl enable survival-routing.service >/dev/null 2>&1 || true
    systemctl restart survival-routing.service
    info "Rutas sin conexión listas: $(ls "$SEG"/*.rd5 | wc -l) cuadrícula(s)"
    ;;
  remove)
    systemctl disable --now survival-routing.service >/dev/null 2>&1 || true
    rm -rf "$SEG" "$DATA/manifest.json"
    info "Datos de rutas eliminados (BRouter y Java se conservan)"
    ;;
  *)
    die "uso: routing-install.sh install <región>... | remove"
    ;;
esac
