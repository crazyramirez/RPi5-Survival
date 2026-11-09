#!/usr/bin/env bash
# Diagnóstico de hardware y entorno — SOLO LECTURA.
# No modifica ficheros, servicios, particiones ni configuración de arranque.
# Uso: scripts/diagnose.sh > diagnostico-$(hostname)-$(date +%F).txt
set -u
export LC_ALL=C

s() { printf '\n===== %s =====\n' "$1"; }

s "FECHA"; date -Is
s "MODELO"; tr -d '\0' < /proc/device-tree/model 2>/dev/null; echo
s "SO"; cat /etc/os-release; cat /etc/rpi-issue 2>/dev/null | head -1
s "KERNEL"; uname -a
s "MEMORIA"; free -h
s "ALMACENAMIENTO"; lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL; df -hT -x tmpfs -x devtmpfs
s "SD"; for f in name manfid oemid date; do printf '%s=%s\n' "$f" "$(cat /sys/block/mmcblk0/device/$f 2>/dev/null)"; done
s "USB"; lsusb; lsusb -t
s "SERIE"; find /dev -maxdepth 1 \( -name 'ttyUSB*' -o -name 'ttyACM*' -o -name 'serial*' -o -name 'ttyAMA*' \) -print
s "SPI/I2C"; ls /dev/spidev* /dev/i2c-* 2>/dev/null
s "ALIMENTACION"; vcgencmd get_throttled; vcgencmd pmic_read_adc EXT5V_V 2>/dev/null; vcgencmd pmic_read_adc BATT_V 2>/dev/null
printf 'max_current_mA='; od -An -tu4 --endian=big /proc/device-tree/chosen/power/max_current 2>/dev/null | tr -d ' '
s "TERMICA"; vcgencmd measure_temp; cat /sys/devices/platform/cooling_fan/hwmon/*/fan1_input 2>/dev/null
s "PANTALLAS"; for f in /sys/class/drm/card*-*/status; do echo "$f: $(cat "$f")"; done
for f in /sys/class/drm/card*-HDMI*/modes; do [ -s "$f" ] && echo "$f: $(head -1 "$f") (primer modo)"; done
s "WAYLAND"; XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 wlr-randr 2>/dev/null | grep -E '^[A-Z]|current|preferred|Transform|Scale'
s "ENTRADA"; grep -E '^(N:|I:)' /proc/bus/input/devices
s "SESION"; systemctl get-default; ps -eo comm | grep -E '^(labwc|wayfire|Xorg|lightdm|chromium)$' | sort -u
s "RELOJ"; timedatectl; ls /dev/rtc* 2>/dev/null
s "RED"; ip -brief addr; ss -tlnH 2>/dev/null | awk '{print $4}'
s "HERRAMIENTAS"; for t in node gpsd kiwix-serve cryptsetup sqlite3 wlr-randr grim chromium; do printf '%s: %s\n' "$t" "$(command -v $t || echo ausente)"; done
s "EEPROM"; rpi-eeprom-update 2>/dev/null | grep -E 'CURRENT|LATEST|BOOTLOADER'
