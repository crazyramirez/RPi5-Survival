#!/usr/bin/env bash
# Imagen de Survivelia OS en la Raspberry Pi (o Linux con Plymouth/pcmanfm): sin la marca ni el fondo de Raspberry Pi.
#
#   sudo bash pi-branding.sh            aplicar (idempotente)
#   sudo bash pi-branding.sh --revert   volver a la imagen de Raspberry Pi OS
#   bash pi-branding.sh --status        ver qué está aplicado (no cambia nada)
#
# Qué cambia (los ficheros de la imagen salen de ../kiosk/branding, junto a este script):
#   - Arranque y apagado: tema Plymouth «survivelia» en lugar de «pix» (reconstruye el initramfs solo si cambia).
#   - Fondo del escritorio (pcmanfm, perfil LXDE-pi) del usuario de escritorio y de la pantalla de acceso (pi-greeter).
#   - Firmware/kernel: sin pantalla arcoíris (config.txt disable_splash=1) ni logos de frambuesa (cmdline logo.nologo),
#     con copia .bak-survival-* de config.txt y cmdline.txt. --revert los deja: son inocuos.
# Lo llaman install-system.sh (salvo --no-branding) y uninstall-system.sh (--revert). También se puede usar a mano,
# p. ej. tras la instalación sin sudo de install.sh.
set -euo pipefail

MODE=apply
for arg in "$@"; do
  case "$arg" in
    --revert) MODE=revert ;;
    --status) MODE=status ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

SRC="${BRANDING_SRC:-$(cd "$(dirname "$0")/.." && pwd)/kiosk/branding}"
SHARE=/usr/share/survival-os
WALL="$SHARE/wallpaper.jpg"
THEME_DIR=/usr/share/plymouth/themes/survivelia
GREETER=/etc/lightdm/pi-greeter.conf
BG='#0f0f14141212'
BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot

info() { echo "==> $*"; }

# Usuario de escritorio. Orden: KIOSK_USER explícito → quien ejecuta sudo → autologin de lightdm → UID 1000.
detect_kiosk_user() {
  local u
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != root ]; then echo "$SUDO_USER"; return; fi
  u="$(sed -n 's/^autologin-user=//p' /etc/lightdm/lightdm.conf 2>/dev/null | head -n1)"
  if [ -n "$u" ] && getent passwd "$u" >/dev/null; then echo "$u"; return; fi
  getent passwd 1000 | cut -d: -f1
}
KIOSK_USER="${KIOSK_USER:-$(detect_kiosk_user)}"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6 || true)"
PLYMOUTH_SET="$(command -v plymouth-set-default-theme || echo /usr/sbin/plymouth-set-default-theme)"
[ -x "$PLYMOUTH_SET" ] || PLYMOUTH_SET=""

# Pone key=value en un .conf de pcmanfm/greeter (sección única): reemplaza la línea o la añade tras la cabecera.
set_conf() {
  local file="$1" key="$2" value="$3"
  if grep -q "^$key=" "$file"; then
    sed -i "s|^$key=.*|$key=$value|" "$file"
  else
    sed -i "0,/^\[/s|^\[.*\]\$|&\n$key=$value|" "$file"
  fi
}

# Recarga el escritorio si la sesión gráfica está abierta (si no, se aplica al iniciar sesión).
reload_desktop() {
  local uid
  uid="$(id -u "$KIOSK_USER" 2>/dev/null)" || return 0
  [ -S "/run/user/$uid/wayland-0" ] || return 0
  timeout 10 runuser -u "$KIOSK_USER" -- env XDG_RUNTIME_DIR="/run/user/$uid" WAYLAND_DISPLAY=wayland-0 \
    pcmanfm --profile LXDE-pi --reconfigure >/dev/null 2>&1 || true
}

status() {
  echo "Usuario de escritorio: ${KIOSK_USER:-?}"
  echo "Tema de arranque:      $([ -n "$PLYMOUTH_SET" ] && "$PLYMOUTH_SET" 2>/dev/null || echo 'sin Plymouth')"
  echo "Fondo de escritorio:   $(sed -n 's/^wallpaper=//p' "$KIOSK_HOME/.config/pcmanfm/LXDE-pi/desktop-items-0.conf" 2>/dev/null || true)"
  echo "Pantalla de acceso:    $(sed -n 's/^wallpaper=//p' "$GREETER" 2>/dev/null || true)"
  echo "Firmware sin arcoíris: $(grep -q '^disable_splash=1' "$BOOT/config.txt" 2>/dev/null && echo sí || echo no)"
  echo "Kernel sin logos:      $(grep -qw 'logo.nologo' "$BOOT/cmdline.txt" 2>/dev/null && echo sí || echo no)"
}

apply() {
  local f n changed=0
  [ -f "$SRC/wallpaper.jpg" ] || { echo "ERROR: falta $SRC/wallpaper.jpg" >&2; exit 1; }
  install -D -m 0644 "$SRC/wallpaper.jpg" "$WALL"

  # Escritorio (pcmanfm --profile LXDE-pi, un fichero por monitor). Se parte del de sistema si no hay uno propio.
  if [ -n "$KIOSK_HOME" ] && [ -d "$KIOSK_HOME" ]; then
    for n in 0 1; do
      f="$KIOSK_HOME/.config/pcmanfm/LXDE-pi/desktop-items-$n.conf"
      if [ ! -f "$f" ]; then
        install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config" "$KIOSK_HOME/.config/pcmanfm" "$(dirname "$f")"
        if [ -f "/etc/xdg/pcmanfm/LXDE-pi/desktop-items-$n.conf" ]; then
          cp "/etc/xdg/pcmanfm/LXDE-pi/desktop-items-$n.conf" "$f"
        else
          printf '[*]\n' > "$f"
        fi
      fi
      set_conf "$f" wallpaper "$WALL"
      set_conf "$f" wallpaper_mode crop
      set_conf "$f" desktop_bg "$BG"
      set_conf "$f" desktop_shadow "$BG"
      chown "$KIOSK_USER:$KIOSK_USER" "$f"
    done
  fi

  # Pantalla de acceso (pi-greeter), por si se cierra la sesión.
  if [ -f "$GREETER" ]; then
    [ -f "$GREETER.bak-survival" ] || cp -p "$GREETER" "$GREETER.bak-survival"
    set_conf "$GREETER" wallpaper "$WALL"
    set_conf "$GREETER" wallpaper_mode crop
    set_conf "$GREETER" desktop_bg "$BG"
  fi

  # Arranque y apagado: tema Plymouth propio.
  if [ -n "$PLYMOUTH_SET" ]; then
    install -d "$THEME_DIR"
    for f in survivelia.plymouth survivelia.script splash.png; do
      if ! cmp -s "$SRC/plymouth/$f" "$THEME_DIR/$f"; then install -m 0644 "$SRC/plymouth/$f" "$THEME_DIR/$f"; changed=1; fi
    done
    if [ "$changed" -eq 1 ] || [ "$("$PLYMOUTH_SET")" != survivelia ]; then
      info "Tema de arranque Survivelia OS (reconstruyendo initramfs, ~1 min)"
      "$PLYMOUTH_SET" -R survivelia >/dev/null
    fi
    # Sin «splash» en la línea del kernel Plymouth muestra texto: se añade (junto a «quiet») si falta.
    if [ -f "$BOOT/cmdline.txt" ] && ! grep -qw splash "$BOOT/cmdline.txt"; then
      cp -p "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.bak-survival-$(date +%Y%m%d%H%M%S)"
      grep -qw quiet "$BOOT/cmdline.txt" || sed -i '1s/[[:space:]]*$/ quiet/' "$BOOT/cmdline.txt"
      sed -i '1s/[[:space:]]*$/ splash plymouth.ignore-serial-consoles/' "$BOOT/cmdline.txt"
    fi
  fi

  # Firmware/kernel (Raspberry Pi): sin el arcoíris del firmware ni los logos de frambuesa del kernel.
  if [ -f "$BOOT/config.txt" ] && ! grep -q '^disable_splash=' "$BOOT/config.txt"; then
    cp -p "$BOOT/config.txt" "$BOOT/config.txt.bak-survival-$(date +%Y%m%d%H%M%S)"
    printf '\n[all]\n# Survivelia OS: sin pantalla arcoíris del firmware\ndisable_splash=1\n' >> "$BOOT/config.txt"
  fi
  if [ -f "$BOOT/cmdline.txt" ] && ! grep -qw 'logo.nologo' "$BOOT/cmdline.txt"; then
    cp -p "$BOOT/cmdline.txt" "$BOOT/cmdline.txt.bak-survival-$(date +%Y%m%d%H%M%S)"
    sed -i '1s/[[:space:]]*$/ logo.nologo/' "$BOOT/cmdline.txt"
  fi

  reload_desktop
  info "Imagen de Survivelia OS en escritorio y arranque (el arranque se ve al reiniciar)"
}

revert() {
  local f
  if [ -n "$PLYMOUTH_SET" ] && [ "$("$PLYMOUTH_SET")" = survivelia ]; then
    info "Tema de arranque de Raspberry Pi OS (reconstruyendo initramfs, ~1 min)"
    if [ -d /usr/share/plymouth/themes/pix ]; then "$PLYMOUTH_SET" -R pix >/dev/null || true
    else "$PLYMOUTH_SET" -R -r >/dev/null || true; fi
  fi
  rm -rf "$THEME_DIR"
  if [ -f "$GREETER.bak-survival" ]; then mv -f "$GREETER.bak-survival" "$GREETER"; fi
  if [ -n "$KIOSK_HOME" ]; then
    for f in "$KIOSK_HOME"/.config/pcmanfm/LXDE-pi/desktop-items-*.conf; do
      [ -f "$f" ] || continue
      # Vuelve a los valores de sistema (/etc/xdg) conservando el resto de ajustes del usuario.
      if grep -q "^wallpaper=$SHARE/" "$f"; then
        local key def sys=/etc/xdg/pcmanfm/LXDE-pi/desktop-items-0.conf
        for key in wallpaper desktop_bg desktop_shadow; do
          def="$(sed -n "s/^$key=//p" "$sys" 2>/dev/null | head -n1)"
          if [ -n "$def" ]; then set_conf "$f" "$key" "$def"; else sed -i "/^$key=/d" "$f"; fi
        done
      fi
    done
  fi
  rm -f "$WALL"
  rmdir "$SHARE" 2>/dev/null || true
  reload_desktop
  info "Imagen de Raspberry Pi OS restaurada"
}

case "$MODE" in
  status) status ;;
  apply) [ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }; apply ;;
  revert) [ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }; revert ;;
esac
