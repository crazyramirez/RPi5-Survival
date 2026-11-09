# ADR 0011 — Hora de respaldo sin red (GNSS / LoRa)

- **Estado:** aceptada e implementada (2026-11-09), con autorización del usuario («para tener todo tipo de backup si
  no detecta la hora y fecha y se desajusta»).
- **Problema:** la Pi 5 no tiene pila de reloj. Sin Internet arranca con la hora guardada al apagarse
  (`fake-hwclock`), que puede ir horas o días atrasada. Esto afecta a los registros, a la antigüedad de las posiciones
  y a las fechas de la bóveda.

## Decisión

El servicio `survival-timesync` (oneshot) se lanza con su temporizador cada 60 s, como root. Solo tiene la capacidad
`CAP_SYS_TIME`, red limitada a loopback y escritura únicamente en `/run/survival-os` y `/etc/fake-hwclock.data`.

Las fuentes se usan por orden de prioridad:

1. **NTP** (`systemd-timesyncd`) sincronizado: no se toca nada.
2. **GNSS por gpsd**, con cualquier receptor (GPIO o USB):
   - exige fijación 2D/3D;
   - exige dos lecturas coherentes, con ± 3 s de margen.

   Hoy no hay receptor: el GY-NEO6MV2 del GPIO está roto.
3. **LoRa** (`survival-mesh` `GET /time`). Las posiciones Meshtastic solo llevan hora si el nodo la tiene de calidad
   (de su GPS o del teléfono), y es la hora del envío. Para fiarse de ellas:
   - **solo cuentan las del canal privado**, el que tiene clave propia de 16 bytes o más. Así nadie de la malla
     pública puede colar una hora falsa;
   - hacen falta dos muestras de los últimos 45 min que coincidan con ± 10 s de margen;
   - cada muestra se proyecta a «ahora» con el reloj monótono del proceso, que no le afectan los saltos del reloj
     de pared;
   - se descarta cualquier hora anterior a 2026-01-01.

Si la hora elegida difiere más de 60 s del reloj, este se ajusta con `clock_settime` y se ejecuta `fake-hwclock save`.
Puede adelantar o atrasar el reloj. Cuando NTP vuelve, `systemd-timesyncd` manda.

Cada pasada deja su estado en `/run/survival-os/timesync.json`: fuente, comprobación, nodo y último ajuste. `/run` se
borra al reiniciar. A partir de ahí:

- `device-api` informa de la fuente `lora` o `gnss` solo si la comprobación es de hace menos de 12 h; si no,
  «no verificada»;
- la barra de estado y la pantalla Sistema muestran «LoRa», la hora de la comprobación y el último ajuste.

## Verificación

- Pruebas:
  - `tests/python/test_time_sync.py` (prioridades, umbral, datos absurdos);
  - `test_survival_mesh.py` (solo canal privado, coherencia, caducidad);
  - `parsers.test.ts` (`timeSourceFrom`).
- En la Pi: con NTP desactivado y el reloj atrasado a propósito, se recuperó la hora con la del nodo de bolsillo
  (ver CHANGELOG).

## Vuelta atrás

- Desactivar: `sudo systemctl disable --now survival-timesync.timer`. NTP no se toca en ningún caso.
- Desinstalar: `uninstall-system.sh` borra todas las unidades `survival-*`.
