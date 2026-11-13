#!/usr/bin/env bash
# Deshace install-system.sh. Por defecto CONSERVA datos (/var/lib/survival-os) y configuración.
#   sudo bash uninstall-system.sh [--purge]     (--purge borra también datos, config y usuario)
# La bóveda cifrada vive en /var/lib/survival-os/vault: --purge la destruye.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
PURGE=0; [ "${1:-}" = "--purge" ] && PURGE=1
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
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"

# Punto de acceso Wi-Fi (ADR 0009): apagarlo y volver a la red de casa antes de quitar nada.
if nmcli -t -f NAME con show 2>/dev/null | grep -qx survival-ap; then
  nmcli con down survival-ap >/dev/null 2>&1 || true
  nmcli con delete survival-ap >/dev/null 2>&1 || true
fi
[ -x /usr/sbin/nft ] && /usr/sbin/nft delete table inet survival_ap 2>/dev/null || true
rm -f /etc/NetworkManager/dnsmasq-shared.d/survival-ap.conf
if [ -s /var/lib/survival-os/ap-prev-connection ]; then
  nmcli con up "$(cat /var/lib/survival-os/ap-prev-connection)" >/dev/null 2>&1 || true
fi

UNITS=$(ls /etc/systemd/system/survival-*.service /etc/systemd/system/survival-*.timer 2>/dev/null | xargs -r -n1 basename)
[ -n "$UNITS" ] && systemctl disable --now $UNITS 2>/dev/null || true
for u in $UNITS; do rm -f "/etc/systemd/system/$u"; done
rm -f /etc/polkit-1/rules.d/50-survival-os.rules /etc/tmpfiles.d/survival-os.conf /etc/udev/rules.d/*survival-os*.rules \
  /etc/modules-load.d/survival-os-serial.conf
rm -rf /run/survival-os
systemctl daemon-reload

AUTOSTART="$KIOSK_HOME/.config/labwc/autostart"
[ -f "$AUTOSTART" ] && sed -i '\#/opt/survival-os/current/scripts/kiosk.sh#d' "$AUTOSTART"
pkill -u "$KIOSK_USER" -f '[k]iosk.sh' 2>/dev/null || true
pkill -u "$KIOSK_USER" -f 'class=[s]urvival-kiosk' 2>/dev/null || true

systemctl --global disable survival-kiosk.path >/dev/null 2>&1 || true
rm -f /etc/systemd/user/survival-kiosk.*
rm -rf /opt/survival-os
if [ "$PURGE" -eq 1 ]; then
  rm -rf /var/lib/survival-os /etc/survival-os
  userdel survival 2>/dev/null || true
  echo "Purgado (datos, configuración y usuario eliminados)."
else
  echo "Desinstalado. Datos conservados en /var/lib/survival-os y /etc/survival-os."
fi
echo "Servicios desactivados por la instalación NO se reactivan automáticamente:"
echo "  sudo systemctl enable --now cups cups-browsed ModemManager NetworkManager-wait-online wayvnc"
