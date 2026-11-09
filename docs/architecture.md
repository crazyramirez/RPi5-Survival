# Arquitectura (v0.7.0)

```text
 Pantalla HDMI 7" 1024×600 + táctil USB
   │  sesión labwc (usuario de escritorio) ── survival-kiosk.path → kiosk.sh → Chromium --kiosk (perfil propio)
   │                                   └─ swayidle/wlopm (apagado de pantalla) · agente FIFO
   ▼  http://127.0.0.1:3000  (CSP default-src 'self'; frame-ancestors 'self')
 ┌───────────────────────────── survival-web (Nuxt 4 SPA + Nitro) ─────────────────────────────┐
 │ UI · /api/health · /api/system/{power,display} · /maps-data (Range) · /map-assets (glifos)   │
 │ middleware: rutas privadas (/boveda, /api/vault, /api/system) solo loopback + cabecera acción │
 └──┬──────────────┬────────────────┬──────────────────┬───────────────┬──────────────┬────────┘
    │8781          │8782            │8783 (/kiwix)     │8784           │8785          │socket Unix
 device-api     library         kiwix-serve        navigation     esp32-gateway    vault (root)
 (sysfs,        (protocolos,    (ZIM)              (cliente gpsd, (USB serie,      (LUKS2, sin red,
  vcgencmd)      FTS5, favs)                        waypoints,     JSON Lines v1)   montaje privado)
                                                    tracks GPX)       │
                                                       │2947          └─ /dev/ttyACM* (ESP32-S3)
                                                     gpsd ── receptor GNSS USB/UART
 Vigilante: survival-healthcheck.timer (cada 60 s) → reinicia componentes caídos tras 3 fallos.
```

Todos los servicios TCP escuchan en `127.0.0.1` y tienen `IPAddressDeny=any` + `IPAddressAllow=localhost`
(garantía offline en el kernel). La bóveda tiene `PrivateNetwork=yes` y solo socket Unix.

## Servicios

| Unidad | Usuario | Datos | Notas |
|---|---|---|---|
| `survival-web` | survival | `/var/lib/survival-os` (mapas, lectura) | Proxy a todos los servicios; nunca expone sus puertos |
| `survival-device-api` | survival + video | — | `/dev/vcio` para vcgencmd; `AF_NETLINK` para interfaces |
| `survival-library` | survival | `library/` (SQLite FTS5, docs, favoritos) | `node:sqlite`, sin dependencias nativas |
| `survival-kiwix` | survival | `library/zim/` | kiwix-tools estático 3.8.2 |
| `survival-navigation` | survival | `navigation/` (waypoints JSON, tracks JSONL) | Escrituras atómicas; GNSS simulado solo en desarrollo |
| `survival-esp32-gateway` | survival + dialout | — | `DeviceAllow` solo ttyACM/ttyUSB |
| `survival-vault` | root | `vault/` (contenedor LUKS2) | Socket 0660 root:survival; volumen visible solo en su espacio de montaje |
| `survival-healthcheck` | root | `/run/survival-os` | Publica también contadores de error de la microSD |
| `survival-kiosk` (usuario) | pi | perfil Chromium | Arranca al aparecer el socket Wayland |

## Contratos

- `packages/shared-types`: solo tipos (nada en runtime). `Probe<T>` = `ok | unavailable | error` (ADR 0003).
- Acciones con efecto (apagar, bóveda, favoritos, waypoints, tracks): POST/PUT/PATCH/DELETE con cabecera
  `x-survival-action: 1` y `Origin` loopback (CSRF).
- Protocolo ESP32 v1: ver `services/esp32-gateway/README.md`.

ADR: [0001 SPA local](adr/0001-stack-y-spa-local.md) · [0002 instalación](adr/0002-instalacion-no-invasiva.md) ·
[0003 Probe](adr/0003-contrato-probe-datos-honestos.md) · [0004 bóveda](adr/0004-boveda-luks2.md) ·
[0005 mapas](adr/0005-mapas-pmtiles.md) · [0006 kiosco](adr/0006-kiosco-systemd-usuario.md) ·
[0007 puertos serie](adr/0007-puertos-serie-esp32-gps.md)
