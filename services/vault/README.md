# vault (socket Unix /run/survival-os/vault.sock)

Bóveda LUKS2/Argon2id en fichero; servicio root sin red cuyo montaje solo existe en su espacio de
nombres. Diseño y límites: `docs/adr/0004-boveda-luks2.md`. Prueba: `sudo scripts/vault-selftest.sh`.

API: `GET /status`, `POST /setup {passphrase,sizeMiB}`, `POST /unlock {passphrase}`, `POST /lock`,
`POST /touch`, `GET /files`, `POST /files?name=&tags=&review=` (cuerpo binario ≤ 100 MB),
`GET /files/:id/raw`, `PATCH|DELETE /files/:id`, `GET /removable`, `POST /import {media,path}`.
Recuperación (ADR 0013): `POST /recover {recoveryKey,newPassphrase}`, `POST /recovery-key {passphrase}`,
`POST /discard {confirm:"DESCARTAR"}`.
Nunca registra contraseñas, nombres ni contenidos.
