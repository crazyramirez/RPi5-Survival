# systemd — propuestas (NO instaladas)

Estos ficheros son **ejemplos para revisión**. En Fase 1 la aplicación se arranca a mano
(`~/survival-os/current/scripts/run.sh`). Nada de esta carpeta se copia al sistema sin autorización.

## Plan de Fase 2 (pendiente de aprobar)

1. Crear usuario de servicio sin login: `sudo useradd --system --home /opt/survival-os --shell /usr/sbin/nologin survival`.
2. Instalar runtime y release en `/opt/survival-os` (propiedad `root`, solo lectura para `survival`).
3. Configuración en `/etc/survival-os/survival-os.env` (`root:survival`, `0640`), copiada de `.env.example`.
4. Copiar las dos unidades, `systemctl daemon-reload`, `enable --now`.
5. Verificar `IPAddressDeny=any` + `IPAddressAllow=localhost` con `scripts/test-offline.sh`.
6. Solo entonces, kiosco (ver abajo) y watchdog sobre `/api/health`.

## Kiosco (propuesta, labwc/Wayland)

Entrada en `~/.config/labwc/autostart` **después** de validar la app y la recuperación por SSH/TTY:

```sh
/opt/survival-os/current/scripts/kiosk.sh &
```

`kiosk.sh` (por escribir en Fase 2) esperará a `/api/health`, mostrará una página local de
recuperación si no responde, y lanzará Chromium con perfil dedicado:

```sh
chromium --kiosk --ozone-platform=wayland \
  --user-data-dir=$HOME/.config/survival-kiosk \
  --password-store=basic --noerrdialogs --disable-session-crashed-bubble \
  --disable-features=Translate,MediaRouter --no-first-run \
  --check-for-update-interval=31536000 \
  http://127.0.0.1:3000
```

`--password-store=basic` evita el diálogo "Unlock Keyring" observado en la auditoría.
Salida del kiosco para mantenimiento: SSH, o `Ctrl+Alt+F2` (TTY) con el teclado USB.

## Riesgos a validar antes de activar

- Que la Pi arranque sin red (sin `network-online.target` como dependencia).
- Que un fallo de la web no deje una pantalla negra (página de recuperación local).
- Que `Restart=on-failure` + `StartLimitBurst` no genere bucles que desgasten la SD.
