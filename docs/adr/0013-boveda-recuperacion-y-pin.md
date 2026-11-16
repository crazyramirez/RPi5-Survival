# ADR 0013 — Bóveda: clave de recuperación, descarte y contraseñas sencillas

- **Estado:** aceptada (2026-11-16) a petición del usuario. Amplía y modifica el ADR 0004.
- **Contexto:**
  - El ADR 0004 dejaba una única clave. Si se olvidaba la contraseña, la única salida era borrar el contenedor por SSH.
  - El usuario pide dos cosas:
    - poder recuperar el acceso si olvida la contraseña;
    - poder usar contraseñas sencillas, incluso solo números, porque es un equipo personal.
- **Decisión:**
  - **Clave de recuperación** en un segundo keyslot LUKS2, con la misma KDF que la contraseña: Argon2id, 256 MiB, 2 s.
    - Son 20 bytes de `crypto.randomBytes` (160 bits) en base32 de Crockford, en el formato `XXXX-XXXX-…` (8 grupos de 4).
    - Se genera al crear la bóveda y se muestra **una sola vez**. No se guarda en ningún sitio: el usuario la apunta en papel.
    - Al teclearla se normaliza: da igual mayúsculas o minúsculas, espacios o guiones, y se corrigen `O→0` e `I/L→1`.
  - **Endpoints nuevos.** Todos pasan por el mismo cerrojo `busy` y el mismo límite de intentos que `/unlock`:
    - `POST /recover {recoveryKey, newPassphrase}`:
      1. Comprueba la clave con `cryptsetup open --test-passphrase -v`, que dice qué keyslot abre.
      2. Añade la contraseña nueva autenticando con la clave.
      3. Borra el keyslot de la contraseña olvidada.
      - Los documentos se conservan y la clave de recuperación sigue valiendo.
    - `POST /recovery-key {passphrase}`: crea una clave de recuperación (bóvedas anteriores a este ADR) o la regenera.
      - Primero añade la nueva y después borra la anterior, así que nunca queda el contenedor sin clave.
      - Rechaza la clave de recuperación usada como contraseña: si no, se borraría el keyslot de la contraseña.
    - `POST /discard {confirm:"DESCARTAR"}`: para cuando no hay ni contraseña ni clave.
      - Solo con la bóveda bloqueada.
      - **Renombra** el contenedor a `vault.luks.descartada-<fecha>` (sigue cifrado, no se borra) y se puede crear otro.
      - `status.discardedBytes` muestra cuánto ocupan los descartados, que se borran a mano por SSH.
  - **Paso de secretos.** La contraseña o clave que autentica va por stdin (`--key-file=-`). La clave nueva va en un
    fichero efímero dentro de `/run/survival-vault`: el RuntimeDirectory del servicio, en tmpfs (RAM), con permisos
    0700 de root y privado del servicio.
    - El fichero tiene nombre aleatorio y modo 0600; se sobrescribe con ceros y se borra en cuanto termina cryptsetup.
    - No se usa `/dev/fd/3` porque los descriptores extra de Node son sockets y cryptsetup no puede abrirlos.
      Ese error apareció en la Pi el 2026-11-16 («Failed to open key file»).
    - Ningún secreto aparece en argumentos (visibles en `/proc`), en disco ni en los registros.
  - **Contraseñas:** mínimo 4 caracteres; se admiten PIN numéricos.
    - Solo se rechazan las triviales: un carácter repetido, secuencias (`1234`, `98765`, `qwerty…`) y `password`/`survival`.
    - La interfaz marca como **débil** la contraseña de menos de 12 caracteres, solo de dígitos o de una sola clase sin
      ser frase. La acepta, pero avisa del riesgo.
- **Consecuencias y límites declarados:**
  - **Con un PIN, la bóveda NO resiste el robo de la microSD.**
    - El límite de intentos solo frena la pantalla. Con el contenedor copiado se prueban claves offline.
    - Argon2id (2 s y 256 MiB por intento en la Pi) lo encarece, pero un PIN de 4 dígitos son 10⁴ intentos: horas, no años.
    - La especificación (§15) prohíbe presentar un PIN como protección suficiente. Por eso la interfaz lo dice
      claramente en lugar de ocultarlo.
  - **La clave de recuperación equivale a la contraseña:** quien tenga el papel abre la bóveda. Hay que guardarla fuera del equipo.
  - Las copias de `vault-backup.sh` hechas antes de una recuperación o rotación conservan los keyslots de ese momento.
  - **Validación:** el comportamiento real de cryptsetup se prueba en la Pi con `sudo vault-selftest.sh` (17/17):
    - ejecuta las funciones reales del servicio (`services/vault/dist/luks.js`), no una imitación en bash;
    - añadir clave, detectar el keyslot y comprobar que no queda el fichero efímero;
    - sustituir la contraseña y comprobar que la olvidada ya no abre.
