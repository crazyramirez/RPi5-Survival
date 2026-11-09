# Modelo de seguridad

## Amenazas consideradas

1. Pérdida o robo del equipo y extracción de la microSD.
2. Acceso indebido desde la red (LAN doméstica hoy; AP Wi-Fi propio en el futuro).
3. Desbloqueo por observación (alguien ve la contraseña).
4. Cortes de alimentación durante escrituras.

**No** se afirma resistencia a análisis forense avanzado sin auditoría especializada.

## Controles implementados (v0.7.0)

| Control | Dónde | Verificación |
|---|---|---|
| Web y device-api escuchan solo en `127.0.0.1` | `.env.example`, `scripts/start.mjs`, `services/device-api/src/config.ts` | `test-offline.sh` §3 (no responde por la IP LAN) |
| `/boveda` y `/api/vault/**` solo para loopback y sin cabeceras de proxy | `apps/frontend/server/middleware/00.private-guard.ts` | Tests unitarios (rutas ofuscadas `//boveda`, `%62oveda`) + `test-offline.sh` (403) |
| CSP `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'self'` (el lector embebe solo contenido propio) | `server/middleware/10.security-headers.ts` | `test-offline.sh` §2 |
| El navegador nunca habla con servicios de sistema | Solo `/api/device/status` (lectura) vía Nitro | Revisión de código |
| `device-api` no usa shell; binarios fijos con timeout | `services/device-api/src/sys.ts` (`execFile`) | Revisión de código |
| Sin secretos en el repo; `.env` ignorado; solo `.env.example` | `.gitignore` | — |
| Logs JSON sin contenido privado | `services/device-api/src/server.ts` | — |
| Bloqueo de pantalla = anti-toques, **declarado no seguro**; además cierra la bóveda | `LockOverlay.vue` | Texto visible en la UI |
| Servicios como usuario `survival` sin login, `IPAddressDeny=any` + `IPAddressAllow=localhost` | `systemd/*.service` | `test-offline.sh` §5 |
| Apagar/reiniciar sin sudo: regla polkit limitada a 4 acciones de logind y al usuario `survival` | `systemd/polkit/50-survival-os.rules` | `pkcheck` (probado: `survival` sí, `nobody` no) |
| Acciones con efecto: cabecera `x-survival-action` + `Origin` loopback (CSRF) | `server/utils/net.ts` | Tests unitarios; 403 sin cabecera u origen ajeno |
| Bóveda LUKS2/Argon2id, servicio sin red, montaje privado, límite de intentos, autobloqueo | `services/vault`, ADR 0004 | `vault-selftest.sh` |
| Documentos de usuario en iframe `sandbox` sin scripts; Markdown con renderizador que escapa todo | `services/library/src/markdown.ts` | Tests (XSS, `javascript:`) |
| wayvnc, cups, ModemManager desactivados | `install-system.sh` | `systemctl is-enabled` |

## Riesgos abiertos (del inventario)

| Riesgo | Severidad | Acción | Fase |
|---|---|---|---|
| Contraseña de `pi` débil + `sudo` sin contraseña | Alta (antes de datos privados) | Cambiar contraseña; valorar `sudo` con contraseña | Antes de la 5 |
| `wayvnc` en `0.0.0.0:5900` | — | **Resuelto**: desactivado por `install-system.sh` | 2 |
| microSD con timeouts (riesgo de corrupción) | Alta | Sustituir la tarjeta; alerta visible en la UI | 7 |
| SSH por contraseña en todas las interfaces | Media | Claves SSH; desactivar contraseña; no exponer en el AP | 2 / 6 |
| SD sin cifrar | Alta para datos privados | Bóveda LUKS2 separada; nunca automontada | 5 |
| `ModemManager` sondea puertos serie | Baja | Regla udev de exclusión | 4 / 6 |

## Bóveda (implementada, ver ADR 0004)

- Volumen LUKS2 (Argon2id) en fichero o partición dedicada; contraseña robusta. Un PIN de UI nunca deriva la clave.
- Desbloqueo manual en la pantalla local; nunca al arranque.
- Al bloquear: cerrar descriptores, desmontar, `cryptsetup close`, limpiar miniaturas/caché de Chromium.
- API por socket Unix, no TCP; Nitro reenvía solo desde loopback (middleware ya activo).
- Límite de intentos en UI y servicio (no sustituye a la KDF).
- Prohibido almacenar semillas, claves privadas de wallets o PIN de hardware wallets.
- El cofre de alta seguridad (ADR 0008) se retiró el 2026-11-09 a petición del usuario: la bóveda LUKS2 es la única capa.
- Antes de datos reales: prueba de extracción de SD, bloqueo, copia cifrada y restauración.
