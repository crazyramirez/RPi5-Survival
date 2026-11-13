# Inventario de hardware — Fase 0

**Fecha de auditoría:** 2026-11-08 17:54 CET
**Método:** SSH desde PC de desarrollo (LAN), solo comandos de lectura (`scripts/diagnose.sh`).
**Cambios realizados en el dispositivo durante la auditoría:** ninguno.

> Los valores eléctricos y térmicos son una **instantánea en reposo** (escritorio + Chromium abierto, 46 min de uptime). No sustituyen a las pruebas de `docs/power-tests.md`.

## 1. Placa y sistema

| Elemento | Valor medido |
|---|---|
| Modelo | Raspberry Pi 5 Model B Rev 1.0 (revision `d04170`) |
| RAM | 7,9 GiB útiles (8 GB) — swap 512 MiB (`dphys-swapfile`) |
| SO | Raspberry Pi OS (Debian 12 bookworm, 12.13), imagen de referencia 2025-05-13, `stage4` (escritorio completo) |
| Kernel | `6.12.62+rpt-rpi-2712` aarch64 (build 2026-01-19) |
| Bootloader EEPROM | 2025-05-08 — **hay actualización disponible (2025-12-08); NO aplicada** (requiere plan de rollback) |
| Hostname | `raspberrypi` |
| Usuario | `pi` (uid 1000), grupos: `sudo`, `video`, `input`, `dialout`, `gpio`, `i2c`, `spi`, `render`… `sudo` sin contraseña activo |

## 2. Almacenamiento

| Elemento | Valor medido |
|---|---|
| Tarjeta | microSD Samsung (manfid `0x1b`, OEM `SM`, nombre `ED2S5`, fab. 10/2022) — 119,4 GiB |
| Modo bus | UHS-I SDR104, 200 MHz, 4 bits |
| Particiones | `mmcblk0p1` vfat 512 MB `/boot/firmware` · `mmcblk0p2` ext4 118,9 GB `/` |
| Uso | `/` 7,8 GB usados, **104 GB libres** · `/boot/firmware` 69 MB / 510 MB |
| Journal | `Storage=volatile` (no escribe logs persistentes en SD) |

## 3. Pantalla 7" HDMI táctil

| Elemento | Valor medido |
|---|---|
| Salida activa | `HDMI-A-2` (puerto HDMI **1** de la placa, el más alejado del USB-C). `HDMI-A-1` desconectado |
| EDID | Fabricante `LEN`, nombre `L1950wD` (EDID **genérico/prestado**, habitual en paneles Waveshare). Tamaño físico 154 × 86 mm (≈ 7,0") |
| Resolución nativa | **1024 × 600 @ 59,82 Hz** (modo *preferred* del EDID, DTD0) |
| Modo en uso | **1920 × 1080 @ 60 Hz** forzado por `~/.config/kanshi/config` → el panel reescala ⇒ imagen borrosa y texto diminuto. **Pendiente de decisión** (ver §8) |
| Transformación / escala | `normal`, escala 1.0, horizontal |
| Retroiluminación | No existe `/sys/class/backlight` → **sin control de brillo por software** vía HDMI. DDC/CI no comprobado (`ddcutil` no instalado) |
| Táctil | USB HID `0eef:0005` **"WaveShare WS170120"**, driver `hid-multitouch`, `/dev/input/event9`, `ID_INPUT_TOUCHSCREEN=1` |
| Mapeo táctil | `~/.config/labwc/rc.xml`: `mapToOutput="HDMI-A-2"`, `mouseEmulation="no"` (modificado 2026-11-08 17:23; copia en `rc.bak` con `mouseEmulation="yes"`) |
| Teclado en pantalla | `squeekboard` 1.21 activo (layout `es`) |
| Verificación física del toque | **PENDIENTE** — requiere tocar la pantalla con el diagnóstico de eventos activo |

Pantalla DSI 5": no conectada (reservada para Fase 7, sin modo dual).

## 4. Alimentación y térmica

| Elemento | Valor medido |
|---|---|
| Fuente negociada | `max_current = 5000 mA` (USB-PD 5 A detectada), `usb_max_current_enable=1` |
| Tensión entrada | `EXT5V_V` = 5,07 V · `HDMI_V` = 5,08 V |
| Throttling | `get_throttled = 0x0` (sin undervoltage ni throttling **desde el arranque**) |
| Consumo núcleo | `VDD_CORE_A` ≈ 1,90 A @ 0,85 V (lectura PMIC, no es consumo total del sistema) |
| Temperatura CPU | 57,6 – 60,4 °C en reposo con Chromium |
| Ventilador | `pwm-fan` operativo: 2 440 – 2 450 rpm, PWM 125/255, estado de enfriamiento 2/4 |
| Batería RTC | `BATT_V = 0,00 V` → **sin pila RTC**. Trickle-charge desactivado |
| Batería principal / UPS | **No hay medidor** ⇒ la UI debe mostrar "Batería: no disponible" |

La etiqueta física de la fuente (27 W, 5,1 V / 5 A) **no ha sido inspeccionada visualmente**; la negociación 5 A lo hace probable pero no lo prueba.

**Actualización 2026-11-12: la alimentación pasa a una UPS Geekworm X1202.** Es una UPS de 4 celdas, con salida máxima de 5,1 V / 5 A, conectada a la red. Desde ese momento la tabla anterior queda desactualizada:

- **Cómo alimenta:** la UPS alimenta la Pi por GPIO, no por USB-C con PD. Por eso la Pi lee `max_current = 3000 mA` y, sin más ajuste, limita todos los USB juntos a 600 mA.
- **Qué fallaba:** al enchufar el nodo LoRa Heltec V4, el pico de arranque producía sobrecorriente en todos los puertos (32 eventos `over-current change` a las 22:27). Se reiniciaban todos los USB, incluido el de la pantalla táctil, que parpadeaba. Después el nodo se reconectaba cada 12–18 s.
- **Arreglo:** con autorización del usuario se añadió `usb_max_current_enable=1` a `/boot/firmware/config.txt` (límite USB 1,6 A). Copia previa en `config.txt.bak-20261112`. Para deshacerlo, borrar la línea y el comentario, también posible desde un PC leyendo la microSD.
- **Resultado verificado:** nodo conectado en el primer intento, 0 sobrecorrientes, 0 desconexiones en más de 1 min y `get_throttled = 0x0`.
- **Puerto USB de la propia UPS:** solo da alimentación, sin datos. Un nodo enchufado ahí se enciende, pero la Pi no lo ve.
- **Lectura de la UPS:** desde 2026-11-12 la hace `survival-ups.timer`, cada 30 s y solo en lectura (`scripts/ups-status.py`). El resultado va a `/run/survival-os/ups.json`, que lee device-api (`battery`, `mains`).
  - **Red eléctrica (GPIO6, pin 31): verificada.** La UPS conduce el pin activamente, y lo mantiene aunque se cambie la resistencia interna de la Pi:
    - alto = hay red: con pull-down se lee alto;
    - bajo = sin red: con pull-up se lee bajo.

    El lector lee con las dos resistencias: si el valor sigue a la resistencia, el pin está al aire y no informa nada.

    Prueba de desenchufar el cargador: el pin pasó de bajo a alto a las 23:48:16, en el mismo segundo de volver a enchufar, y la tensión de 5 V subió de 5,03 a 5,06 V.

    **Hallazgo:** el pin ya estaba en bajo desde al menos las 23:44, es decir, la Pi funcionaba con batería aunque el cargador pareciera enchufado. Al volver a enchufarlo se arregló.
  - **Batería, medidor MAX17040 en I²C-1, dirección 0x36: SIN RESPUESTA.**
    - Se activó `dtparam=i2c_arm=on` en `config.txt`; copia previa en `config.txt.bak-20261112-i2c`.
    - Los pines 2 y 3 quedan como SDA1/SCL1, pero `i2cdetect -y 1` no ve ningún dispositivo, ni en modo lectura ni en quick-write.
    - Sospecha: los pines con resorte de I²C no hacen contacto, porque el GPIO6 sí lo hace.
    - Hasta que responda, la UI muestra la batería como no disponible, con ese motivo.

## 5. Reloj

| Elemento | Valor medido |
|---|---|
| RTC | `rpi-rtc` presente (`/dev/rtc0`), **sin pila** |
| Sincronización | `systemd-timesyncd` con NTP (`2.debian.pool.ntp.org`), sincronizado |
| Respaldo | `fake-hwclock` instalado |
| Evidencia | `who -b` registra el arranque como **2026-02-27 23:29** (hora restaurada antes de NTP) ⇒ **sin red, la hora tras un corte es incorrecta**. Fuentes válidas offline futuras: pila RTC o GNSS |

Zona horaria: `Europe/Madrid`.

## 6. Puertos y buses

| Elemento | Valor medido |
|---|---|
| USB | Bus 1: táctil Waveshare · Bus 3: teclado inalámbrico "mini keyboard" (`1997:2433`, Riitek, con touchpad) · Buses 2/4 (USB 3) libres |
| Serie USB (`ttyUSB*`/`ttyACM*`) | **Ninguno** ⇒ GPS y ESP32 no conectados ahora |
| UART | `serial0 → ttyAMA10` (conector debug). `enable_uart=0`. `cmdline.txt` tiene `console=serial0,115200` (consola en el debug UART, no en GPIO14/15) |
| SPI | `spidev0.0`, `spidev0.1`, `spidev10.0` (`dtparam=spi=on`) |
| I²C | `i2c-1`, `i2c-4`, `i2c-6`, `i2c-10`, `i2c-11`, `i2c-13`, `i2c-14` (`dtparam=i2c_arm=on`) |
| Cámara | Overlays `imx708` y `imx708,cam0` en `config.txt` (sin verificar si hay cámara física) |
| Botón power | `pwr_button` (gpio-keys) presente; `logind` con valores por defecto |
| `ModemManager` | **Activo** — puede sondear `ttyACM*` y molestar a GPS/ESP32 (actuar en Fase 4/6) |

## 7. Software y red

| Elemento | Valor medido |
|---|---|
| Sesión gráfica | `lightdm` autologin `pi` → `LXDE-pi-labwc` (**Wayland, labwc 0.8.4**), `wf-panel-pi`, `pcmanfm --desktop`, `kanshi` |
| Chromium | 145.0.7632.109 (`rpi-chromium-mods`), en ejecución en modo escritorio normal |
| Node.js / npm | **No instalados** |
| Python | 3.11.2 |
| Herramientas | `git`, `wlr-randr`, `grim` (capturas), `libinput` presentes · `gpsd`, `kiwix-serve`, `cryptsetup`, `sqlite3`, `ddcutil`, `brightnessctl` **ausentes** |
| Red | `wlan0` IP de la LAN por DHCP (Wi-Fi doméstica, NetworkManager) · `eth0` sin cable |
| Escuchando | `:22` SSH (todas las interfaces) · **`:5900` wayvnc (todas las interfaces)** · `127.0.0.1:631` CUPS · mDNS |
| Servicios no necesarios para campo | `cups`, `cups-browsed`, `bluetooth`, `avahi-daemon`, `ModemManager`, `wayvnc` (candidatos a desactivar en Fase 2/7, tras validar recuperación) |
| Ficheros previos | `~/.pp_backup/.config/` (copia de configuración de escritorio del 2026-02-27), `~/prueba.jpg`. **No hay aplicación previa** en `/opt`, `/srv`, `~/Desktop` ni unidades systemd propias |

## 8. Hallazgos y decisiones pendientes

1. **Resolución**: el panel es 1024×600 nativo pero se fuerza 1920×1080. Recomendado volver a 1024×600 (más nítido, menos GPU). Cambio reversible en `~/.config/kanshi/config`; requiere autorización del usuario porque la configuración se modificó hoy a mano.
2. **Toque**: verificación física pendiente (prueba guiada con `libinput debug-events`).
3. **Hora sin red**: sin pila RTC. Recomendado instalar pila RTC oficial (ML-2020 recargable) o depender de GNSS (Fase 4). La UI mostrará la fuente de hora real.
4. **Exposición en LAN**: `wayvnc` en `0.0.0.0:5900` y SSH en todas las interfaces. Aceptable en desarrollo; revisar antes de habilitar un AP público (Fase 6/7).
5. **Contraseña de `pi` débil** y `sudo` sin contraseña: cambiar antes de introducir cualquier dato privado (obligatorio antes de Fase 5).
6. **EEPROM**: actualización disponible, no aplicada. Aplicar solo con copia de seguridad de la SD.
7. **Diálogo "Unlock Keyring"** visible en escritorio (Chromium + gnome-keyring con autologin). Resolver en Fase 2 (perfil Chromium dedicado con `--password-store=basic`).
8. **ModemManager** activo: añadir regla udev de exclusión o deshabilitarlo cuando se conecten GPS/ESP32.

## 9. Estado de aceptación Fase 0

| Criterio | Estado |
|---|---|
| Pantalla 7" operativa | ✅ detectada y mostrando escritorio (modo no nativo) |
| Toque operativo | ⏳ dispositivo detectado y mapeado; falta prueba física |
| Alimentación sin undervoltage | ✅ `0x0` en reposo · ⏳ falta prueba bajo carga |
| Recuperación SSH | ✅ SSH accesible por LAN |
| Recuperación por teclado local | ✅ teclado USB inalámbrico conectado (falta probar TTY con Ctrl+Alt+F2) |

## 10. Hallazgos posteriores (2026-11-08, tarde) — microSD y arranque

Medido tras instalar los servicios de la Fase 2 (arranques de 2–3 min y UI a los ~4 min):

| Hallazgo | Evidencia | Acción |
|---|---|---|
| **La microSD da timeouts** | `/sys/kernel/debug/mmc0/err_stats`: 22–26 *Data Timeout*, 6 *Command Timeout*, 2 *Request Timedout* en cada arranque; 4 nuevos en 30 s de lecturas concurrentes **con el sistema ya arrancado**; `Card stuck being busy` en `dmesg` | Probado `dtparam=sd_cqe=0` (desaparece el mensaje, siguen los timeouts) y reloj a 100 MHz (sin mejora, revertido). **Conclusión: la tarjeta (o su contacto) falla. Sustituirla.** La UI muestra ahora estos contadores y alerta si > 0 |
| Overlays de cámara forzados sin cámara | `dtoverlay=imx708` ×2 → ciclos de dependencias; firmware Wi-Fi/BT bloqueado 33 s | Comentados (queda `camera_auto_detect=1`) |
| `NetworkManager-wait-online` y `wayvnc` retrasaban el fin del arranque | `systemd-analyze critical-chain` | Desactivados (wayvnc además estaba expuesto en `0.0.0.0:5900`) |
| labwc ejecuta su `autostart` ~36 s tarde | tiempos de proceso | Kiosco por unidad systemd de usuario (ADR 0006) |

Resultado en la tarjeta defectuosa: arranque de 2:57 → ~1:00–1:50 (variable por los timeouts). El usuario
reinstala Raspberry Pi OS; en la instalación nueva se repite la Fase 0 con `scripts/diagnose.sh` y se
comprueban los contadores de error de la nueva tarjeta en **Sistema → Almacenamiento**.

### 10.1 Tras reinstalar Raspberry Pi OS (Bookworm, imagen 2026-10-06) en la **misma** tarjeta

| Medida | Instalación anterior | Instalación limpia |
|---|---|---|
| Arranque (`systemd-analyze`) | 1:50–2:57 | **10,4 s** (1,8 s kernel + 8,6 s espacio de usuario) |
| Errores SD tras arrancar | 22–26 data timeouts | **0** |
| Estrés: 10 lectores concurrentes con E/S directa, 30 s | +4 data timeouts | +4 data timeouts (recuperados por reintento) |

**Conclusión corregida:** la lentitud venía sobre todo de la instalación anterior (overlays de cámara sin
cámara, servicios esperando a la red, estado de la imagen). La tarjeta funciona con normalidad en uso
real; solo muestra timeouts recuperables bajo una carga sintética extrema. Se mantiene la vigilancia de los
contadores en la UI (aviso, no alarma) y la recomendación de una tarjeta A2 de mayor margen a medio plazo.

## 11. Brillo del panel (2026-11-09, comprobación en solo lectura)

- `/sys/class/backlight/` vacío: **no hay control de retroiluminación por el kernel**.
- Buses DDC presentes (`/dev/i2c-13`, `/dev/i2c-14`, uno por HDMI), pero `ddcutil` no está instalado, así que DDC/CI
  no está comprobado.
- La EDID del panel es la de otro monitor («Lenovo L1950wD», 19"): el panel chino de 7" copia una EDID ajena. Estos
  paneles casi nunca implementan DDC/CI; el brillo suele ir por botones o un potenciómetro en la placa.
- **Decisión:** el brillo físico es `unavailable` (no se simula). La app ofrece «atenuación» por software, que no
  ahorra energía de la retroiluminación, y el apagado del panel (`wlopm`).
- **DDC/CI comprobado (2026-11-09, ddcutil 1.4.1 instalado con autorización del usuario):**
  - `ddcutil detect` lee la EDID por `/dev/i2c-14` (`card1-HDMI-A-2`), pero responde «Invalid display / DDC
    communication failed»;
  - `getvcp 10` (brillo): en i2c-14, «DDC communication failed»; en i2c-13, «No monitor detected».

  **El panel no implementa DDC/CI: no hay brillo real por software** (verificado). Para quitar la herramienta:
  `sudo apt-get remove -y ddcutil`.
- **Brillo por USB HID (2026-11-09, probado por rpi5-survival-81 con el usuario mirando el panel):**
  - El panel es un Waveshare «WS170120», USB `0eef:0005`, bcdDevice 1.11, con un informe HID 4 de fabricante
    (`0xFF00`, 63 B).
  - Se reprodujo el protocolo del binario oficial (`04 AA 01 00 00 00 <brillo×10>` por `/dev/hidrawN`, de 38 y 64 B,
    al 10/20/50/100 %): `write()` se acepta, pero **la retroiluminación no cambia**. Según el wiki, es función de la
    revisión 4.1.
  - No usar el binario oficial: ejecuta `sudo chmod 777 /dev/hidraw*`.
- **Conclusión:** brillo físico `unavailable`, verificado por DDC/CI y por USB HID. Solo queda la atenuación por
  software, apagar el panel con wlopm, o una modificación PWM de hardware, que no se hace sin el usuario.
