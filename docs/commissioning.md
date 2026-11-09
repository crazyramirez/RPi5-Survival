# Puesta en marcha, pruebas de aceptación y recuperación

## 1. Preparar el sistema (una vez)

1. **Soporte**: microSD A2 de calidad (p. ej. tarjeta oficial Raspberry Pi A2 128 GB) o SSD. La tarjeta
   auditada el 2026-11-08 daba *timeouts* de datos en cada arranque (ver `hardware-inventory.md` §10).
2. **Raspberry Pi Imager** → Raspberry Pi 5 → *Raspberry Pi OS (64-bit)* con escritorio. En *Editar ajustes*:
   hostname, usuario de escritorio (p. ej. `survival-pi`; cualquier nombre sirve, el instalador lo detecta) con **contraseña robusta**, Wi-Fi, zona `Europe/Madrid`, teclado `es`, **SSH activado**.
3. Primer arranque con red. Comprobar acceso: `ssh <usuario>@<IP>`.

## 2. Instalar Survival OS (PC → Pi)

```sh
# PC (repositorio)
npm ci && node scripts/fetch-map-assets.mjs     # recursos de mapa (una vez)
npm run check && npm run build && npm run release
scp release/survival-os-0.7.0.tar.gz* scripts/install-system.sh <usuario>@<IP>:/tmp/

# Pi
sudo bash /tmp/install-system.sh /tmp/survival-os-0.7.0.tar.gz
```

`install-system.sh` (idempotente): usuario `survival`, `/opt/survival-os` (release verificada con SHA-256),
Node 24 LTS, kiwix-tools 3.8.2 (hash fijado), paquetes `gpsd cryptsetup-bin poppler-utils`, unidades systemd,
regla polkit (apagar/reiniciar), regla udev (ESP32), kiosco (unidad de usuario `survival-kiosk.path`), y
desactiva `cups`, `ModemManager`, `NetworkManager-wait-online` y `wayvnc`. Deshacer: `uninstall-system.sh`.

## 3. Contenidos

```sh
sudo /opt/survival-os/current/scripts/content-fetch.sh basico        # ~0,3 GB: Wikipedia Médica, Wikiviajes, Wikilibros
sudo /opt/survival-os/current/scripts/content-fetch.sh recomendado   # ~18 GB: + Wikipedia ES completa, iFixit, Wikcionario
# Mapas preparados en el PC (pmtiles extract, ver docs/content-sources.md):
scp espana-20261108-z15.pmtiles <usuario>@<IP>:/tmp/
sudo /opt/survival-os/current/scripts/maps-install.sh /tmp/espana-20261108-z15.pmtiles <sha256>
```

Documentos propios: copiar `.md/.txt/.html/.pdf` a `/var/lib/survival-os/library/docs/` y pulsar
«Reindexar» en Biblioteca.

## 4. Pruebas de aceptación

| Fase | Prueba | Cómo |
|---|---|---|
| 1 | Sin recursos externos, loopback, CSP, rutas privadas | `scripts/test-offline.sh` → 0 fallos |
| 1 | UI y táctil | Tocar cada módulo, Atrás/Inicio, panel Pantalla, desbloqueo por pulsación larga |
| 2 | Arranque autónomo hasta la UI | Reiniciar desde **Sistema → Reiniciar**; la UI vuelve sola |
| 2 | Vuelta tras fallo | `sudo systemctl kill survival-web` → el vigilante/systemd la recupera; Chromium se relanza si se cierra |
| 2 | Pantalla | **Sistema → Apagar pantalla**; un toque la enciende. Inactividad: `SCREEN_OFF_SECONDS` en `/etc/survival-os/kiosk.env` |
| 3 | Biblioteca sin red | Con `nmcli radio wifi off` (desde el teclado de la Pi): buscar «agua», abrir un artículo ZIM y un protocolo |
| 4 | Mapa sin red | Abrir Mapas sin red; desplazar/zoom; añadir un punto |
| 4 | GPS real | Al aire libre con el receptor: Navegación muestra fijación 3D; grabar un track de 5 min y exportar GPX |
| 5 | Bóveda | `sudo scripts/vault-selftest.sh` → 0 fallos (LUKS2/Argon2id, contraseña errónea, robo de SD simulado, cabecera) |
| 5 | Bóveda UI | Crear con documentos **ficticios**, bloquear, desbloquear, contraseña errónea ×4 (espera), copia `vault-backup.sh` y restauración |
| 6 | ESP32 | `python3 scripts/esp32-sim.py /tmp/esp32-sim` + pasarela con `ESP32_PORTS=/tmp/esp32-sim`: aparece, se mata el simulador → «desconectado» sin afectar a la UI |
| 7 | Copias | `sudo scripts/backup.sh /media/<usuario>/<USB>` y `restore.sh` en una instalación limpia |
| 7 | Energía | `docs/power-tests.md` (requiere medidor USB-C) |

## 5. Mantenimiento y recuperación

- **Estado**: `systemctl status 'survival-*'` · registros `journalctl -u survival-web -b` (volátiles).
- **Salir del kiosco** (SSH, como `pi`): `touch ~/.config/survival-os/kiosk.disabled; systemctl --user stop survival-kiosk`.
  Volver: `rm ~/.config/survival-os/kiosk.disabled; systemctl --user start survival-kiosk`.
- **Teclado local**: `Ctrl+Alt+F2` → TTY con login.
- **Volver a una release anterior**: `sudo ln -sfn /opt/survival-os/releases/<anterior> /opt/survival-os/current && sudo systemctl restart 'survival-*'`.
- **Apagado**: Sistema → Apagar equipo, o el botón de la placa. Cortar la alimentación solo con el LED verde apagado.
- **Diagnóstico**: `scripts/diagnose.sh > diag.txt` (solo lectura).
