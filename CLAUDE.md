# CLAUDE.md — Survival OS

Especificación maestra: `SURVIVAL_OS_RPI5_CLAUDE.md` (leer §13 fases y §15 prohibiciones antes de cambiar nada).
Estado: v0.7.0, fases 0–7 validadas en la Pi salvo pruebas físicas (táctil, GPS exterior, ESP32 real, energía).

## Comandos

- `npm run check` — lint + typecheck + tests (obligatorio antes de desplegar).
- `npm run dev` — device-api + Nuxt en 127.0.0.1 (en Windows las sondas dan "no disponible": correcto).
- `npm run build && npm run release` — tarball en `release/`.
- En la Pi: `bash install.sh <tarball>`, `~/survival-os/current/scripts/test-offline.sh`, `run.sh`.

## Dispositivo

- Raspberry Pi 5 8 GB en la LAN, usuario de escritorio `survival-pi` y hostname `survival-pi` (renombrados desde `pi` el 2026-11-09), IP asignada por DHCP (ver `docs/hardware-inventory.md`). Pedir credenciales al usuario; no guardarlas en el repo.
- Nunca suponer el usuario `pi` en scripts: el usuario de escritorio se detecta (autologin de lightdm → UID 1000).
- Pantalla HDMI-A-2 nativa 1024×600, táctil USB `0eef:0005`. Wayland/labwc. Capturas: `grim` o Chromium headless + CDP.
- Instalación de sistema: `sudo install-system.sh <tarball>` → `/opt/survival-os`, usuario `survival`, unidades `survival-*`, kiosco `survival-kiosk.path` (usuario de escritorio, autodetectado).
- Mapas de prueba en `.data/maps/` (gitignored, con SHA256SUMS); `pmtiles.exe` en `.data/`.
- Antes de compilar en un clon nuevo: `node scripts/fetch-map-assets.mjs` (glifos/sprites, gitignored).

## Reglas del proyecto

- Nunca inventar datos: todo valor pasa por `Probe<T>` (ADR 0003). Sin medida → `unavailable` con motivo.
- Nada externo: sin CDN/fuentes/APIs remotas; la CSP lo bloquea. Comprobar con `test-offline.sh`.
- Textos de UI en `apps/frontend/app/locales/es.ts`, nunca literales en plantillas.
- En `<style scoped>` no usar `:global(X) .y` (Vue descarta `.y`; hay test).
- Cambios de sistema en la Pi (systemd, kanshi, labwc, paquetes, EEPROM, red) solo con autorización explícita del usuario y plan de vuelta atrás.
- En comandos remotos `pkill -f` usar patrón `[s]cripts/start.mjs` para no matar la propia sesión.
- `packages/shared-types` solo tipos: los servicios compilados no lo tienen en runtime.
- La lentitud original era de la instalación previa; la microSD solo da timeouts bajo estrés extremo. Vigilar contadores.
- `pkill -f` remoto: anclar con `^` (el `[x]` falla si el nombre aparece en otra parte del comando).
