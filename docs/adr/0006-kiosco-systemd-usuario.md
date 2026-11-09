# ADR 0006 — Kiosco lanzado por una unidad systemd de usuario activada por el socket Wayland

- **Estado:** aceptada (2026-11-08)
- **Contexto:** en el equipo auditado labwc ejecutaba su `autostart` ~36 s después de arrancar, retrasando
  la interfaz. El arranque completo además esperaba a `NetworkManager-wait-online` y `wayvnc`.
- **Decisión:** `survival-kiosk.path` (`PathExists=%t/wayland-0`) arranca `survival-kiosk.service`
  (`kiosk.sh`): página local de arranque (`file://`) que espera a `/api/health`, Chromium `--kiosk` con perfil
  propio (`--password-store=basic`, sin traducción, sin red de fondo), relanzamiento con espera creciente,
  `swayidle`/`wlopm` para apagar la pantalla y un agente FIFO para órdenes de la UI. Se desactivan
  `NetworkManager-wait-online` y `wayvnc` (además, expuesto en la LAN).
- **Recuperación:** SSH, `Ctrl+Alt+F2`, o `~/.config/survival-os/kiosk.disabled`. El escritorio sigue debajo.
