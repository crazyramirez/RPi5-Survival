#!/usr/bin/env bash
# Dependencias de sistema de las fases 3+ (lo llama install-system.sh como root).
#   - paquetes Debian: poppler-utils (PDF→texto), gpsd, cryptsetup
#   - kiwix-tools oficial (binario estático) con hash fijado
#   - directorios de datos
# Idempotente. Necesita red solo si falta algo.
set -euo pipefail
DEST="${DEST:?}"
PREFIX=/opt/survival-os
DATA=/var/lib/survival-os
info() { echo "==> $*"; }

# --- Paquetes ---
need=()
for p in poppler-utils gpsd gpsd-clients cryptsetup-bin fonts-noto-color-emoji; do
  dpkg -s "$p" >/dev/null 2>&1 || need+=("$p")
done
if [ ${#need[@]} -gt 0 ]; then
  info "Instalando paquetes: ${need[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${need[@]}" >/dev/null 2>&1 || {
    apt-get update >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${need[@]}" >/dev/null
  }
fi

# --- kiwix-tools (estático, aarch64) ---
KIWIX_VERSION=3.8.2
KIWIX_SHA256=a9898fc5363437327350db669bbc03dcc7ecfd498dae727d7184bebe77019514
KDIR="$PREFIX/runtime/kiwix-tools-$KIWIX_VERSION"
if [ ! -x "$KDIR/kiwix-serve" ] && [ "$(uname -m)" = "aarch64" ]; then
  info "Instalando kiwix-tools $KIWIX_VERSION"
  TMP="$(mktemp -d)"
  F="kiwix-tools_linux-aarch64-$KIWIX_VERSION.tar.gz"
  curl -fsSL --proto '=https' -o "$TMP/$F" "https://download.kiwix.org/release/kiwix-tools/$F"
  echo "$KIWIX_SHA256  $TMP/$F" | sha256sum -c - >/dev/null || { rm -rf "$TMP"; echo "ERROR: hash de kiwix-tools incorrecto" >&2; exit 1; }
  mkdir -p "$KDIR"
  tar -xzf "$TMP/$F" -C "$KDIR" --strip-components=1 --no-same-owner
  chown -R root:root "$KDIR"
  rm -rf "$TMP"
fi
[ -x "$KDIR/kiwix-serve" ] && ln -sfn "$KDIR" "$PREFIX/runtime/kiwix-tools"

# --- gpsd: solo loopback, autodetección USB, sin sondear puertos al arrancar sin receptor ---
if [ -f /etc/default/gpsd ] && ! grep -q "Survival OS" /etc/default/gpsd; then
  cp -p /etc/default/gpsd /etc/default/gpsd.bak-survival
  cat > /etc/default/gpsd <<'GPSD'
# Survival OS: receptores USB se añaden por hotplug (USBAUTO). -n: leer el receptor aunque no haya clientes
# (fijación más rápida al abrir la UI). Escucha solo en loopback (gpsd.socket por defecto).
START_DAEMON="true"
USBAUTO="true"
DEVICES=""
GPSD_OPTIONS="-n"
GPSD
  systemctl enable --now gpsd.socket >/dev/null 2>&1 || true
fi

# --- Datos ---
install -d -o survival -g survival -m 0750 "$DATA/library" "$DATA/library/docs" "$DATA/library/zim" "$DATA/navigation" "$DATA/maps"
install -d -o survival -g survival -m 0755 "$DATA/maps"   # mapas: públicos
install -d -o root -g root -m 0700 "$DATA/vault"          # bóveda: solo root (servicio vault)
