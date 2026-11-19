# CLAUDE.md — Survivelia OS

**Si te piden INSTALAR o CONFIGURAR Survivelia OS** (en una Raspberry Pi, en un Linux o la versión portable) por
encargo de una persona, sigue la guía para agentes:

@AGENTS.md

Lo que sigue son las reglas para **desarrollar** en este repositorio.

Especificación maestra: `SURVIVAL_OS_RPI5_CLAUDE.md` (leer §13 fases y §15 prohibiciones antes de cambiar nada).
Estado: v0.7.0, fases 0–7 validadas en la Pi salvo pruebas físicas (táctil, GPS exterior, ESP32 real, energía).

## Comandos

- `npm run check` — lint + typecheck + tests (obligatorio antes de desplegar).
- `npm run dev` — device-api + Nuxt en 127.0.0.1 (en Windows las sondas dan "no disponible": correcto).
- `npm run build && npm run release` — tarball en `release/`.
- `npm run release:portable [-- --targets=win-x64]` — versión portable Windows/macOS/Linux (ADR 0014), carpeta + zip en `release/`.
- `npm run release:android [-- --debug --abi=x86_64]` — APK Android (ADR 0020) en `release/`; necesita JDK 17+, SDK, NDK y Go.
- Emulador: AVD `survival-tablet` (Android 16, tablet x86_64); APK de depuración = `org.survivalos.app.debug` (`run-as` para leer el token).
- `npm run set-version -- X.Y.Z` — versión única en todos los package.json y package-lock.json (sin argumento: comprueba).
- `npm run release:publish [-- --yes]` — publicar (siempre con los APK de Android; `--no-android` solo para revisar) en GitHub Releases para que las instalaciones se actualicen solas (ADR 0021):
  - sin `--yes` solo comprueba, compila, firma y describe;
  - exige `main` limpio y subido, `## X.Y.Z` en CHANGELOG.md y la clave `~/.survival-os/update-signing-key.pem` (nunca en el repo).
  - **Autorización permanente del usuario (2026-11-16): tras cada cambio en la app, generar las apps nuevas y
    publicar una release nueva** (`npm run set-version -- X.Y.Z`, sección `## X.Y.Z` en CHANGELOG, commit y push de
    `main`, `npm run release:publish -- --yes` **desde Bash, no PowerShell**: PowerShell se come el `--` y solo hace
    un ensayo). Siempre con los APK de Android.
  - **Después, borrar las releases antiguas** (`gh release delete vX.Y.Z --yes`): en GitHub queda solo la última.
    **Esperar al menos 11 minutos tras publicar** (o borrarla al publicar la siguiente): la landing cachea 10 min
    el enlace al APK y, si se borra antes, `/descargar/android` lleva a un APK que ya no existe.
  - **Y vincular la release en Survivelia Landing** (`../Survivelia Landing`): poner `version = 'X.Y.Z'` en
    `app/data/site.ts` (portada, pie, estado y JSON-LD), commit y push de `main` (Plesk despliega por webhook; luego
    en Plesk: NPM install → build → Restart App). El botón del APK (`/descargar/android`) ya redirige solo al
    `-android-arm64.apk` de la última release (caché de 10 min): comprobar que apunta a la nueva.
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
- Textos de UI en `apps/frontend/app/locales/es.ts` (y la misma clave traducida en `en.ts`, `fr.ts`, `it.ts`, `de.ts`, `zh.ts`, `ja.ts`; ADR 0017), nunca literales en plantillas. Protocolos nuevos: también en `content/protocols/<idioma>/`.
- En `<style scoped>` no usar `:global(X) .y` (Vue descarta `.y`; hay test).
- Cambios de sistema en la Pi (systemd, kanshi, labwc, paquetes, EEPROM, red) solo con autorización explícita del usuario y plan de vuelta atrás.
- En comandos remotos `pkill -f` usar patrón `[s]cripts/start.mjs` para no matar la propia sesión.
- `packages/shared-types` solo tipos: los servicios compilados no lo tienen en runtime.
- La lentitud original era de la instalación previa; la microSD solo da timeouts bajo estrés extremo. Vigilar contadores.
- `pkill -f` remoto: anclar con `^` (el `[x]` falla si el nombre aparece en otra parte del comando).
