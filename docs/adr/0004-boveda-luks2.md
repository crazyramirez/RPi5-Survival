# ADR 0004 — Bóveda: contenedor LUKS2 en fichero, servicio root sin red y montaje privado

- **Estado:** aceptada (2026-11-08)
- **Decisión:**
  - Contenedor `/var/lib/survival-os/vault/vault.luks` (fichero con `fallocate`), LUKS2, AES-XTS, KDF
    Argon2id (256 MiB, 2 s). Sin reparticionar la SD. Única clave: contraseña robusta (≥ 12 caracteres o
    frase de 4+ palabras); no hay PIN que derive claves.
  - Servicio `survival-vault` como root (cryptsetup/mount lo requieren) con `PrivateNetwork=yes` y socket
    Unix `0660 root:survival`. El volumen se monta **dentro del espacio de montaje privado del servicio**
    (`ProtectSystem=strict`): ningún otro proceso ve los ficheros descifrados; solo se sirven por el socket.
  - Nunca se abre al arrancar; tras un corte, el servicio cierra cualquier mapeo previo. Bloqueo por
    inactividad (300 s), al bloquear la pantalla y al parar el servicio; `drop_caches` al cerrar.
  - Intentos: sin espera los 3 primeros fallos, luego 2^(n-3) s hasta 15 min, persistido en disco.
  - Respuestas `no-store`; vistas previas con `blob:` revocados al cerrar/bloquear.
- **Limitaciones declaradas:** el límite de intentos no protege frente a un ataque offline del contenedor
  copiado (lo hace Argon2id + la contraseña). Copias en RAM del navegador mientras se ve un documento.
  Sin auditoría forense independiente. Sin datos reales hasta superar `vault-selftest.sh` y la prueba de
  copia/restauración.
