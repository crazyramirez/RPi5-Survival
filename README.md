# Survival OS

Terminal portátil de supervivencia **100 % offline** sobre Raspberry Pi 5 (8 GB) con pantalla
HDMI táctil de 7" (1024×600). Interfaz Nuxt + TypeScript servida en `127.0.0.1`, servicio local
de estado del equipo y contenidos locales. Especificación completa:
[SURVIVAL_OS_RPI5_CLAUDE.md](SURVIVAL_OS_RPI5_CLAUDE.md).

**Estado: v0.7.0 — fases 0–7 implementadas y validadas en la Pi** salvo las pruebas que requieren a una persona
delante (táctil, GPS al aire libre, ESP32 real, energía): ver [docs/commissioning.md](docs/commissioning.md) §4.
[CHANGELOG](CHANGELOG.md).

| Módulo | Qué hace |
|---|---|
| Inicio / barra de estado | Hora y su fuente, GNSS, red, °C, disco, batería (solo si hay medidor), alertas reales (incl. errores de la microSD) |
| Mapas | MapLibre + PMTiles offline, posición, puntos, track en grabación, coordenadas copiables |
| Navegación | Fijación GNSS, destino con distancia/rumbo, tracks GPX, importación |
| Biblioteca | Kiwix (Wikipedia ES…), documentos propios con búsqueda FTS, favoritos, modo noche |
| Emergencias | 112 y 41 protocolos con fuentes y fecha |
| Bóveda | LUKS2 cifrada, solo pantalla local, autobloqueo, importación USB |
| Comunicaciones / Herramientas | Interfaces de red, ESP32 por USB, conversor de coordenadas |
| Sistema | Alimentación, térmica, SD, servicios, apagar/reiniciar, apagar pantalla |

## Estructura

```text
apps/frontend/          Nuxt 4 (SPA) + servidor Nitro: UI, /api/health, proxy a device-api
services/device-api/    Estado del equipo (sysfs, /proc, vcgencmd, timedatectl, nmcli, systemctl)
services/library/       Protocolos, FTS5 de documentos, pasarela Kiwix, favoritos
services/navigation/    Cliente gpsd, waypoints, tracks GPX
services/vault/         Bóveda LUKS2 (root, sin red, socket Unix)
services/esp32-gateway/ ESP32 por USB serie (JSON Lines v1)
content/protocols/      Protocolos de emergencia (Markdown con fuentes)
firmware/               Firmware de ejemplo para ESP32
kiosk/                  Página local de arranque/recuperación
packages/shared-types/  Contrato Probe<T> (ok | unavailable | error) compartido
packages/content-schema/ Metadatos obligatorios de contenidos (licencia, origen, SHA-256)
scripts/                diagnose.sh, install.sh, run.sh, start.mjs, test-offline.sh, release.mjs
systemd/                Unidades de EJEMPLO (no instaladas) para Fase 2
docs/                   Inventario de hardware, arquitectura, seguridad, puesta en marcha
```


## Desarrollo (PC)

Requisitos: Node ≥ 24.15.

```sh
npm install
npm run dev          # device-api :8781 + Nuxt :3000, ambos en 127.0.0.1
npm run check        # lint + typecheck + tests
```

En Windows/macOS casi todas las sondas responden "no disponible (solo Linux)": es correcto, la
UI muestra estados vacíos honestos. Para ver datos reales, despliega en la Pi.

## Despliegue en la Raspberry Pi (Fase 1, no invasivo)

Todo se instala en `~/survival-os` del usuario de escritorio: **sin sudo, sin paquetes del sistema, sin
tocar arranque, systemd ni escritorio**. Desinstalar = `rm -rf ~/survival-os`.

```sh
# En el PC
npm run build && npm run release        # → release/survival-os-X.Y.Z.tar.gz (+ .sha256)
scp release/survival-os-*.tar.gz* scripts/install.sh <usuario>@<IP>:/tmp/

# En la Pi (descarga Node 24 LTS de nodejs.org la primera vez y verifica SHA-256)
bash /tmp/install.sh /tmp/survival-os-X.Y.Z.tar.gz
~/survival-os/current/scripts/test-offline.sh
~/survival-os/current/scripts/run.sh    # primer plano; Ctrl+C para parar
```

Abrir en la Pi: `http://127.0.0.1:3000`. Desde el PC, sin exponer nada en la LAN:
`ssh -L 3000:127.0.0.1:3000 <usuario>@<IP>` y abrir `http://localhost:3000`.

Instalación sin red: pasar el tarball de Node como segundo argumento de `install.sh`
(con su `SHASUMS256.txt` al lado como `<tarball>.SHASUMS256.txt`).

## Principios

- **Nunca inventar datos.** Sin medidor → "Batería: no disponible". Sin GNSS → sin coordenadas.
- **Nada externo.** Fuentes, iconos y JS empaquetados; CSP `default-src 'self'`; sin telemetría.
- **Loopback por defecto.** Web y device-api escuchan en `127.0.0.1`. `/boveda` y `/api/vault`
  se deniegan a cualquier origen no loopback o reenviado por proxy.
- **Cambios de sistema solo con autorización**, copia de seguridad y plan de vuelta atrás.

Documentación: [arquitectura](docs/architecture.md) · [inventario](docs/hardware-inventory.md) ·
[seguridad](docs/security-model.md) · [puesta en marcha](docs/commissioning.md) ·
[energía](docs/power-tests.md) · [fuentes y licencias](docs/content-sources.md) · [ADR](docs/adr/).
