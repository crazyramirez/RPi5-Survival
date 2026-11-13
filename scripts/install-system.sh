#!/usr/bin/env bash
# Instalación/actualización de Survival OS como servicio del sistema (Fase 2+).
#
#   sudo bash install-system.sh <survival-os-X.Y.Z.tar.gz> [--no-kiosk] [--keep-services] [--disable-vnc]
#
# Hace (idempotente):
#  - usuario de servicio `survival` sin login; datos en /var/lib/survival-os; config en /etc/survival-os
#  - runtime Node + release verificada en /opt/survival-os (propiedad de root, solo lectura)
#  - unidades systemd, timer de salud, tmpfiles, regla polkit (apagar/reiniciar)
#  - kiosco: línea en ~/.config/labwc/autostart del usuario de escritorio (copia previa)
#  - desactiva cups, ModemManager y NetworkManager-wait-online (salvo --keep-services); wayvnc solo con --disable-vnc
# Deshacer: sudo bash uninstall-system.sh
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.22.2}"
PREFIX=/opt/survival-os
DATA=/var/lib/survival-os
ETC=/etc/survival-os
# Usuario de escritorio (kiosco). Orden: KIOSK_USER explícito → quien ejecuta sudo → usuario del autologin de
# lightdm → dueño del UID 1000. Nunca se supone «pi»: el usuario puede renombrarse (rename-user) y las
# actualizaciones desde la pantalla (tarea `update`) se ejecutan como root, sin SUDO_USER.
detect_kiosk_user() {
  local u
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != root ]; then echo "$SUDO_USER"; return; fi
  u="$(sed -n 's/^autologin-user=//p' /etc/lightdm/lightdm.conf 2>/dev/null | head -n1)"
  if [ -n "$u" ] && getent passwd "$u" >/dev/null; then echo "$u"; return; fi
  getent passwd 1000 | cut -d: -f1
}
KIOSK_USER="${KIOSK_USER:-$(detect_kiosk_user)}"
RELEASE_TGZ=""
INSTALL_KIOSK=1
TRIM_SERVICES=1
DISABLE_VNC=0
for arg in "$@"; do
  case "$arg" in
    --no-kiosk) INSTALL_KIOSK=0 ;;
    --keep-services) TRIM_SERVICES=0 ;;
    --disable-vnc) DISABLE_VNC=1 ;;
    -*) echo "Opción desconocida: $arg" >&2; exit 2 ;;
    *) RELEASE_TGZ="$arg" ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || die "Ejecutar con sudo."
[ -f "$RELEASE_TGZ" ] || die "Indica el tarball de la release."
id "$KIOSK_USER" >/dev/null 2>&1 || die "Usuario de escritorio '$KIOSK_USER' no existe."
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
case "$(uname -m)" in aarch64|arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) die "Arquitectura no soportada" ;; esac

# --- Integridad ---
if [ -f "$RELEASE_TGZ.sha256" ]; then
  (cd "$(dirname "$RELEASE_TGZ")" && sha256sum -c "$(basename "$RELEASE_TGZ").sha256" >/dev/null) || die "Checksum de la release incorrecto"
  info "Checksum de la release OK"
fi

# --- Usuario y directorios ---
if ! id survival >/dev/null 2>&1; then
  info "Creando usuario de servicio 'survival'"
  useradd --system --home-dir "$DATA" --no-create-home --shell /usr/sbin/nologin --user-group survival
fi
usermod -aG video,dialout survival
install -d -o root -g root -m 0755 "$PREFIX" "$PREFIX/runtime" "$PREFIX/releases"
install -d -o survival -g survival -m 0750 "$DATA"
install -d -o root -g survival -m 0750 "$ETC"

# --- Runtime Node ---
NODE_DIR="$PREFIX/runtime/node-$NODE_VERSION-linux-$ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  USER_NODE="$KIOSK_HOME/survival-os/runtime/node-$NODE_VERSION-linux-$ARCH"
  if [ -x "$USER_NODE/bin/node" ]; then
    info "Copiando Node $NODE_VERSION desde $USER_NODE"
    cp -a "$USER_NODE" "$NODE_DIR"
  else
    info "Descargando Node $NODE_VERSION"
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    F="node-$NODE_VERSION-linux-$ARCH.tar.xz"
    curl -fsSL --proto '=https' -o "$TMP/$F" "https://nodejs.org/dist/$NODE_VERSION/$F"
    curl -fsSL --proto '=https' -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    (cd "$TMP" && grep " $F\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "Checksum de Node incorrecto"
    tar -xJf "$TMP/$F" -C "$PREFIX/runtime"
  fi
  chown -R root:root "$NODE_DIR"
fi
ln -sfn "$NODE_DIR" "$PREFIX/runtime/node"
info "Node $("$PREFIX/runtime/node/bin/node" --version)"

# --- Release ---
NAME="$(tar -tzf "$RELEASE_TGZ" | sed -n '1{s#/.*##;p}')"
DEST="$PREFIX/releases/$NAME-$(date +%Y%m%d%H%M%S)"
mkdir -p "$DEST"
tar -xzf "$RELEASE_TGZ" -C "$DEST" --strip-components=1 --no-same-owner
(cd "$DEST" && sha256sum --quiet -c SHA256SUMS) || { rm -rf "$DEST"; die "SHA256SUMS interno no coincide"; }
chown -R root:root "$DEST"
chmod -R go-w "$DEST"
chmod 0755 "$DEST"/scripts/*.sh
PREVIOUS="$(readlink -f "$PREFIX/current" 2>/dev/null || true)"
ln -sfn "$DEST" "$PREFIX/current"
info "Release activa: $DEST"

# --- Configuración (nunca se sobrescribe) ---
[ -f "$ETC/survival-os.env" ] || install -o root -g survival -m 0640 "$DEST/.env.example" "$ETC/survival-os.env"
if [ ! -f "$ETC/kiosk.env" ]; then
  printf '# Kiosco Survival OS\n# Segundos de inactividad antes de apagar la pantalla (0 = nunca)\nSCREEN_OFF_SECONDS=600\n' > "$ETC/kiosk.env"
  chmod 0644 "$ETC/kiosk.env"
fi
chmod 0755 "$ETC"   # kiosk.env lo lee el usuario de escritorio; survival-os.env sigue siendo 0640

# --- systemd, tmpfiles, polkit ---
sed "s/@KIOSK_USER@/$KIOSK_USER/" "$DEST/systemd/tmpfiles.d/survival-os.conf" > /etc/tmpfiles.d/survival-os.conf
systemd-tmpfiles --create /etc/tmpfiles.d/survival-os.conf
install -m 0644 "$DEST/systemd/polkit/50-survival-os.rules" /etc/polkit-1/rules.d/50-survival-os.rules
for f in "$DEST"/systemd/*.service "$DEST"/systemd/*.timer; do
  install -m 0644 "$f" "/etc/systemd/system/$(basename "$f")"
done
if [ -d "$DEST/systemd/udev" ] && ls "$DEST"/systemd/udev/*.rules >/dev/null 2>&1; then
  install -m 0644 "$DEST"/systemd/udev/*.rules /etc/udev/rules.d/
  udevadm control --reload-rules && udevadm trigger --subsystem-match=tty || true
fi
# Drivers serie al arrancar: DeviceAllow=char-ttyACM/ttyUSB solo se resuelve si ya están cargados.
if [ -f "$DEST/systemd/modules-load.d/survival-os-serial.conf" ]; then
  install -m 0644 "$DEST/systemd/modules-load.d/survival-os-serial.conf" /etc/modules-load.d/survival-os-serial.conf
  modprobe -a cdc_acm usbserial i2c-dev 2>/dev/null || true
fi
systemctl daemon-reload

# Servicios base siempre; opcionales solo si su unidad declara que puede arrancar (ver hooks de fase).
UNITS="survival-device-api.service survival-web.service survival-healthcheck.timer survival-timesync.timer survival-ups.timer"
[ -x "$DEST/scripts/install-hooks.sh" ] && DEST="$DEST" KIOSK_USER="$KIOSK_USER" "$DEST/scripts/install-hooks.sh"
for extra in survival-library survival-kiwix survival-navigation survival-vault survival-esp32-gateway; do
  [ -f "/etc/systemd/system/$extra.service" ] && UNITS="$UNITS $extra.service"
done
# shellcheck disable=SC2086
systemctl enable $UNITS >/dev/null
# shellcheck disable=SC2086
systemctl restart $UNITS
# Opcionales que se instalan desde Mantenimiento (asistente, malla): solo si ya están activos.
systemctl try-restart survival-mesh.service >/dev/null 2>&1 || true
# Rutas sin conexión: solo si la tarea «routing» ya instaló BRouter (la unidad lo comprueba con Condition*).
systemctl try-restart survival-routing.service >/dev/null 2>&1 || true

# Parar la instancia manual de Fase 1 si sigue viva.
pkill -u "$KIOSK_USER" -f '[s]urvival-os/current/scripts/start.mjs' 2>/dev/null || true

# --- Kiosco (unidad systemd de usuario activada por el socket Wayland) ---
AUTOSTART="$KIOSK_HOME/.config/labwc/autostart"
OLD_LINE="$PREFIX/current/scripts/kiosk.sh &"
if [ -f "$AUTOSTART" ] && grep -qF "$OLD_LINE" "$AUTOSTART"; then
  sed -i "\#$OLD_LINE#d" "$AUTOSTART"   # migración desde la versión que usaba autostart de labwc
fi
if [ "$INSTALL_KIOSK" -eq 1 ]; then
  install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config/survival-os"
  for f in "$DEST"/systemd/user/*; do
    sed "s/@KIOSK_USER@/$KIOSK_USER/" "$f" > "/etc/systemd/user/$(basename "$f")"
    chmod 0644 "/etc/systemd/user/$(basename "$f")"
  done
  systemctl --global enable survival-kiosk.path >/dev/null 2>&1
  # Lanzador «Survival OS»: menú de aplicaciones + escritorio del usuario.
  install -m 0644 "$DEST/kiosk/survival-os.desktop" /usr/share/applications/survival-os.desktop
  install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/Desktop"
  install -m 0755 -o "$KIOSK_USER" -g "$KIOSK_USER" "$DEST/kiosk/survival-os.desktop" "$KIOSK_HOME/Desktop/survival-os.desktop"
  LIBFM="$KIOSK_HOME/.config/libfm/libfm.conf"
  if [ ! -f "$LIBFM" ]; then
    install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$(dirname "$LIBFM")"
    printf '[config]
quick_exec=1
' > "$LIBFM"; chown "$KIOSK_USER:$KIOSK_USER" "$LIBFM"
  elif ! grep -q '^quick_exec=1' "$LIBFM"; then
    # pcmanfm ejecuta lanzadores sin preguntar (solo afecta a ficheros .desktop).
    if grep -q '^quick_exec=' "$LIBFM"; then sed -i 's/^quick_exec=.*/quick_exec=1/' "$LIBFM"; else sed -i '/^\[config\]/a quick_exec=1' "$LIBFM"; fi
  fi
  # Táctil como táctil (no como ratón): arrastrar desplaza en vez de seleccionar texto.
  RC="$KIOSK_HOME/.config/labwc/rc.xml"
  if [ -f "$RC" ] && grep -q 'mouseEmulation="yes"' "$RC"; then
    cp -p "$RC" "$RC.bak-survival-$(date +%Y%m%d%H%M%S)"
    sed -i 's/mouseEmulation="yes"/mouseEmulation="no"/g' "$RC"
    info "Táctil sin emulación de ratón en $RC"
  fi
  info "Kiosco habilitado (survival-kiosk.path para $KIOSK_USER; activo en el próximo inicio de sesión)"
fi

# --- Servicios innecesarios en campo ---
if [ "$TRIM_SERVICES" -eq 1 ]; then
  # - cups/ModemManager: innecesarios; ModemManager además sondea puertos serie (GPS/ESP32).
  # - NetworkManager-wait-online: retrasa el fin del arranque (y la sesión gráfica) hasta 60 s sin red.
  # wayvnc (escritorio remoto en la LAN) es decisión del usuario: solo se desactiva con --disable-vnc.
  trim="cups.service cups.socket cups.path cups-browsed.service ModemManager.service NetworkManager-wait-online.service"
  [ "$DISABLE_VNC" -eq 1 ] && trim="$trim wayvnc.service wayvnc-control.service"
  for svc in $trim; do
    if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
      systemctl disable --now "$svc" >/dev/null 2>&1 && info "Desactivado $svc"
    fi
  done
fi

# --- Verificación ---
for i in $(seq 1 30); do
  curl -fsS -m 2 -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null && break
  sleep 1
done
if curl -fsS -m 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  info "Salud OK"
else
  echo "ERROR: /api/health no responde con la release nueva. Ver: journalctl -u survival-web -b" >&2
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$DEST" ] && [ -d "$PREVIOUS" ]; then
    # Vuelta atrás automática: una UI caída en un equipo de emergencia es peor que una versión vieja.
    ln -sfn "$PREVIOUS" "$PREFIX/current"
    systemctl reset-failed $UNITS >/dev/null 2>&1 || true
    systemctl restart $UNITS
    for i in $(seq 1 30); do
      curl -fsS -m 2 -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null && break
      sleep 1
    done
    if curl -fsS -m 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "Restaurada la release anterior ($PREVIOUS). La nueva queda en $DEST para diagnóstico." >&2
    else
      echo "La release anterior tampoco responde. Revisar journalctl." >&2
    fi
  fi
  exit 1
fi

# Conservar las 3 últimas releases.
ls -1dt "$PREFIX"/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
info "Hecho."
