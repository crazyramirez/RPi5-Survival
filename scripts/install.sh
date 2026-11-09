#!/usr/bin/env bash
# Instalación NO invasiva de Survival OS (Fase 1).
#
#  - Todo queda dentro de $SURVIVAL_OS_HOME (por defecto ~/survival-os).
#  - No usa sudo, no instala paquetes del sistema, no toca systemd, arranque ni escritorio.
#  - Desinstalar = borrar ese directorio.
#
# Uso:
#   install.sh <survival-os-X.Y.Z.tar.gz> [node-vNN-linux-arm64.tar.xz]
#
# Si no se pasa el tarball de Node y no está instalado, se descarga de nodejs.org
# y se verifica con SHASUMS256 (requiere red solo esta vez).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.22.2}"
PREFIX="${SURVIVAL_OS_HOME:-$HOME/survival-os}"
RELEASE_TGZ="${1:-}"
NODE_TGZ="${2:-}"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ "$(id -u)" -ne 0 ] || die "No ejecutar como root."
[ -n "$RELEASE_TGZ" ] && [ -f "$RELEASE_TGZ" ] || die "Indica el tarball de la release."
case "$(uname -m)" in aarch64|arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) die "Arquitectura no soportada: $(uname -m)" ;; esac

mkdir -p "$PREFIX"/{runtime,releases,config,logs,data}
chmod 700 "$PREFIX/config"

# --- 1. Verificar integridad de la release si hay .sha256 junto al tarball ---
if [ -f "$RELEASE_TGZ.sha256" ]; then
  info "Verificando SHA-256 de la release"
  (cd "$(dirname "$RELEASE_TGZ")" && sha256sum -c "$(basename "$RELEASE_TGZ").sha256") || die "Checksum de la release incorrecto"
else
  echo "AVISO: sin fichero .sha256; no se verifica la integridad del tarball."
fi

# --- 2. Runtime de Node (local al prefijo) ---
NODE_DIR="$PREFIX/runtime/node-$NODE_VERSION-linux-$ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  NODE_FILE="node-$NODE_VERSION-linux-$ARCH.tar.xz"
  if [ -n "$NODE_TGZ" ]; then
    cp "$NODE_TGZ" "$TMP/$NODE_FILE"
    [ -f "$NODE_TGZ.SHASUMS256.txt" ] && cp "$NODE_TGZ.SHASUMS256.txt" "$TMP/SHASUMS256.txt"
  else
    info "Descargando Node $NODE_VERSION ($ARCH) de nodejs.org"
    curl -fsSL --proto '=https' -o "$TMP/$NODE_FILE" "https://nodejs.org/dist/$NODE_VERSION/$NODE_FILE"
    curl -fsSL --proto '=https' -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  fi
  if [ -f "$TMP/SHASUMS256.txt" ]; then
    info "Verificando SHA-256 de Node"
    (cd "$TMP" && grep " $NODE_FILE\$" SHASUMS256.txt | sha256sum -c -) || die "Checksum de Node incorrecto"
  else
    echo "AVISO: sin SHASUMS256.txt; Node no verificado."
  fi
  tar -xJf "$TMP/$NODE_FILE" -C "$PREFIX/runtime"
fi
ln -sfn "$NODE_DIR" "$PREFIX/runtime/node"
info "Node: $("$PREFIX/runtime/node/bin/node" --version)"

# --- 3. Extraer release y activarla de forma atómica ---
# sed consume toda la lista (con `head` tar recibiría SIGPIPE y pipefail abortaría).
NAME="$(tar -tzf "$RELEASE_TGZ" | sed -n '1{s#/.*##;p}')"
[ -n "$NAME" ] || die "Tarball vacío"
DEST="$PREFIX/releases/$NAME-$(date +%Y%m%d%H%M%S)"
mkdir -p "$DEST"
tar -xzf "$RELEASE_TGZ" -C "$DEST" --strip-components=1
info "Verificando ficheros de la release"
(cd "$DEST" && sha256sum --quiet -c SHA256SUMS) || die "SHA256SUMS interno no coincide"
chmod +x "$DEST"/scripts/*.sh
ln -sfn "$DEST" "$PREFIX/current"

# --- 4. Configuración (sin secretos) ---
if [ ! -f "$PREFIX/config/survival-os.env" ]; then
  cp "$DEST/.env.example" "$PREFIX/config/survival-os.env"
  chmod 600 "$PREFIX/config/survival-os.env"
fi

# Conservar solo las 3 releases más recientes.
ls -1dt "$PREFIX"/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

info "Instalada $(cat "$DEST/VERSION") en $DEST"
echo
echo "Arranque manual:   $PREFIX/current/scripts/run.sh"
echo "Prueba offline:    $PREFIX/current/scripts/test-offline.sh"
echo "Abrir en la Pi:    http://127.0.0.1:3000"
