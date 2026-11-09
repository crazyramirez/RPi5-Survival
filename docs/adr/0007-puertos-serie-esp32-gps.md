# ADR 0007 — Política de puertos serie: ESP32 frente a GPS

- **Estado:** aceptada (2026-11-08)
- **Contexto:** CH340, CP210x, FTDI y PL2303 se usan tanto en placas ESP32 como en receptores GPS; gpsd
  (hotplug USB) y la pasarela podrían pelear por el mismo puerto. ModemManager además sondea puertos serie.
- **Decisión:**
  - La pasarela reclama automáticamente solo ESP32 con USB nativo de Espressif (`303a:*`, p. ej. ESP32-S3).
  - Placas con puente USB-serie se asignan explícitamente con `ESP32_PORTS=/dev/serial/by-id/…`.
  - Nunca se abre un puerto que gpsd esté usando (consulta al servicio navigation).
  - Regla udev: ESP32 nativo → `dialout` + `ID_MM_DEVICE_IGNORE`; puentes comunes fuera de ModemManager
    (que además se desactiva en la instalación).
- **Consecuencia:** la JC2432W328 (ESP32 + CH340) requiere configurar su ruta `by-id`. Las JC3248W535 y
  JC4827W543 (ESP32-S3) se detectan solas si el firmware usa USB CDC nativo.
