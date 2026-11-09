# Pruebas de energía y térmica

**Regla:** solo se registran valores medidos con instrumento identificado. Las lecturas del PMIC de la Pi
(`vcgencmd pmic_read_adc`) son útiles para tendencias, **no** sustituyen a un medidor USB-C en línea.

## Línea base (lecturas internas, 2026-11-08)

| Estado | EXT5V | VDD_CORE | CPU °C | Ventilador | Throttling | Notas |
|---|---|---|---|---|---|---|
| Escritorio + Chromium, reposo, 1920×1080 escalado | 5,07 V | 1,90 A @ 0,85 V | 57,6–61,7 | 2 440–2 550 rpm, PWM 125 | `0x0` | Fuente negocia 5 A |
| + Chromium headless (capturas) | 5,07 V | — | 65–66 | — | `0x0` | Pico breve |

## Protocolo (pendiente de instrumento)

Instrumento requerido: medidor USB-C PD en línea (tensión, corriente, Wh) entre fuente y Pi.
Cada prueba: 10 min estabilizado, registrar media de W y temperatura final.

| Escenario | W medio | °C final | `get_throttled` | Fecha | Instrumento |
|---|---|---|---|---|---|
| Idle, UI en Inicio | | | | | |
| Lectura de manual (Biblioteca) | | | | | |
| GPS activo (Fase 4) | | | | | |
| Mapa con desplazamiento (Fase 4) | | | | | |
| Wi-Fi local activo / desactivado | | | | | |
| Pantalla atenuada (CSS) | | | | | |
| Pantalla HDMI apagada (`wlr-randr --off`) | | | | | |
| Mismo caso con DSI 5" (Fase 7) | | | | | |

Observaciones a confirmar:
- La atenuación de la UI es visual: el panel HDMI no expone retroiluminación (`/sys/class/backlight` vacío).
- Apagar la salida HDMI no garantiza apagar la retroiluminación del panel: medir.
- Baterías: ninguna es compatible hasta demostrar 5 V / 5 A (o 5 V / 3 A con `usb_max_current_enable`) sin undervoltage bajo carga.
