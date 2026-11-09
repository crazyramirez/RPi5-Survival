#!/usr/bin/env bash
# Configura un receptor GNSS conectado a la UART del GPIO (Raspberry Pi 5).
#
#   sudo gps-uart-setup.sh [--baud 9600] [--pps <gpio>]      (aplica; requiere reinicio)
#   sudo gps-uart-setup.sh --undo                            (deshace con las copias de seguridad)
#
# Cableado (comprobar ANTES el voltaje del módulo: la lógica del GPIO es de 3,3 V y NO tolera 5 V):
#   GPS VCC → pin 1 (3,3 V)  [o pin 2/4 (5 V) solo si el módulo tiene regulador Y su TX sale a 3,3 V]
#   GPS GND → pin 6 (GND)
#   GPS TX  → pin 10 (GPIO15, RXD)     GPS RX → pin 8 (GPIO14, TXD)  (opcional: solo para configurarlo)
#   GPS PPS → pin 12 (GPIO18)          (opcional: pulso por segundo para hora precisa)
#
# En la Pi 5, GPIO14/15 = UART0 = /dev/ttyAMA0 (se activa con dtparam=uart0=on). La consola serie del
# sistema usa el conector de depuración (ttyAMA10), así que no hay conflicto.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo." >&2; exit 1; }
CFG=/boot/firmware/config.txt
GPSD=/etc/default/gpsd
BAUD=9600
PPS=""
UNDO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --baud) BAUD="$2"; shift 2 ;;
    --pps) PPS="$2"; shift 2 ;;
    --undo) UNDO=1; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$BAUD" =~ ^(4800|9600|19200|38400|57600|115200)$ ]] || { echo "Baudios no válidos: $BAUD" >&2; exit 2; }
[ -z "$PPS" ] || [[ "$PPS" =~ ^([2-9]|1[0-9]|2[0-7])$ ]] || { echo "GPIO PPS no válido: $PPS" >&2; exit 2; }

if [ "$UNDO" -eq 1 ]; then
  sed -i '/^# Survival OS GPS UART/,/^# fin Survival OS GPS UART/d' "$CFG"
  [ -f "$GPSD.bak-survival-uart" ] && cp -p "$GPSD.bak-survival-uart" "$GPSD"
  echo "Deshecho. Reinicia para aplicar."
  exit 0
fi

stamp=$(date +%Y%m%d%H%M%S)
cp -p "$CFG" "$CFG.bak-survival-gps-$stamp"
[ -f "$GPSD.bak-survival-uart" ] || cp -p "$GPSD" "$GPSD.bak-survival-uart"

# config.txt: bloque propio e idempotente.
sed -i '/^# Survival OS GPS UART/,/^# fin Survival OS GPS UART/d' "$CFG"
{
  echo "# Survival OS GPS UART (GPIO14/15 → /dev/ttyAMA0)"
  echo "[all]"
  echo "dtparam=uart0=on"
  [ -n "$PPS" ] && echo "dtoverlay=pps-gpio,gpiopin=$PPS"
  echo "# fin Survival OS GPS UART"
} >> "$CFG"

# gpsd: dispositivo fijo + autodetección USB conservada.
cat > "$GPSD" <<EOF
# Survival OS: receptor en la UART del GPIO${PPS:+ con PPS en GPIO$PPS}. -n: leer aunque no haya clientes.
START_DAEMON="true"
USBAUTO="true"
DEVICES="/dev/ttyAMA0${PPS:+ /dev/pps0}"
GPSD_OPTIONS="-n -s $BAUD"
EOF
systemctl enable gpsd.socket >/dev/null 2>&1 || true

echo "==> Configurado: /dev/ttyAMA0 a $BAUD baudios${PPS:+, PPS en GPIO$PPS}."
echo "    Copia de config.txt: $CFG.bak-survival-gps-$stamp"
echo "    Reinicia y comprueba: cat /dev/ttyAMA0 (deben verse frases \$GPxxx/\$GNxxx), luego Navegación en la UI."
