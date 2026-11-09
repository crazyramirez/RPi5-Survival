# ADR 0008 — Cofre: segunda capa cifrada dentro de la bóveda

- **Estado:** RETIRADA (2026-11-09). El usuario pidió quitarla: «demasiado lío y demasiadas contraseñas». Se
  eliminaron el código, la interfaz y las pruebas; la bóveda LUKS2 queda como única capa. Si se llegó a crear un
  `secure/cofre.json` dentro de la bóveda, sigue ahí cifrado y sin tocar: se puede leer reinstalando una release
  anterior (se conservan en `/opt/survival-os/releases/`) o borrarlo con la bóveda abierta.
- **Estado original:** aceptada (2026-11-09)
- **Contexto:** el usuario quiere guardar contraseñas, datos personales y notas sensibles con más protección que un
  documento de la bóveda. Decidió explícitamente **no** guardar semillas ni claves de carteras (regla del §15, que se
  mantiene). No se crean contenedores, montajes ni unidades nuevas, ni se toca el LUKS existente.
- **Decisión:**
  - El cofre es un fichero (`secure/cofre.json`) **dentro del volumen LUKS ya montado** en el espacio privado del
    servicio `survival-vault`. Sin cambios de systemd ni de permisos.
  - Tiene una **segunda contraseña**, con la misma política que la bóveda. La clave se obtiene con Argon2id nativo
    de Node (`crypto.argon2`, 256 MiB, 3 pasadas, paralelismo 4, sal aleatoria de 16 B). Los parámetros se guardan
    en el fichero.
  - Cada elemento (incluido el título) se cifra con **AES-256-GCM**, con IV aleatorio de 12 B y su id como AAD: un
    bloque movido o manipulado no se autentica. Un bloque dañado se marca y no impide leer los demás.
  - Para verificar la contraseña se descifra un bloque de comprobación y se compara en tiempo constante.
  - El texto en claro solo existe en la memoria del servicio mientras atiende la petición y en la vista del navegador.
    La clave se guarda en un `Buffer` que se sobrescribe con ceros al cerrar. Respuestas `no-store`; nada se copia al
    portapapeles; los valores ocultos se vuelven a tapar solos a los 20 s.
  - **Sin red:** por defecto solo se abre si ninguna interfaz (salvo `lo`) está activa, según
    `/sys/class/net/*/operstate`. Si solo se ve `lo` (no verificable), se rechaza. Mientras está abierto, se comprueba
    cada 5 s y, si aparece red, se cierra. El usuario puede desactivar la exigencia, con confirmación y un aviso.
  - Se cierra solo tras 120 s sin uso (`VAULT_COFRE_AUTOLOCK_SECONDS`), al cerrar la bóveda y al parar el servicio.
    Los intentos fallidos tienen su propio contador y la misma espera exponencial que la bóveda.
  - Se rechazan valores con forma de frase semilla BIP-39: 12–24 palabras (o 25/33), solo minúsculas de 3–8 letras,
    con o sin numeración. Es una heurística, no una garantía; la regla sigue siendo no guardarlas.
  - **Integridad:** cada escritura es duradera (fichero temporal con `fsync`, `rename` y `fsync` del directorio).
    La versión anterior válida se guarda en `cofre.json.bak`; si el principal se daña, por ejemplo por un corte de
    luz, se lee la copia y se pierde como mucho el último cambio. Un cofre dañado sin copia válida **nunca** se
    considera «no configurado»: no se puede crear otro encima y el fichero no se toca (error 500).
  - **Una sola derivación Argon2id a la vez** (256 MiB; `MemoryMax=512M`): la marca se pone antes de cualquier
    `await`, y una segunda petición recibe 409. Revisión de rpi5-survival-81, 2026-11-09.
  - La copia de seguridad la cubre la copia existente de la bóveda cifrada (Mantenimiento → Copia a USB, con la
    bóveda cerrada): el cofre viaja doblemente cifrado.
- **Limitaciones declaradas:**
  - Las cadenas de JavaScript no se pueden borrar de memoria: pueden quedar copias del texto en claro en la memoria
    del servicio o del navegador hasta que se recolecten.
  - Mientras el cofre está abierto, root o un compromiso de `survival` con acceso al socket puede pedir su
    contenido. La exigencia de estar sin red reduce el riesgo remoto, no el local.
  - La comprobación de red usa `operstate`. Verificado en la Pi el 2026-11-09: con `PrivateNetwork=yes`,
    `/sys/class/net` sigue mostrando las interfaces reales del host (`eth0`, `wlan0`), porque sysfs no se remonta.
    **Si se añade `ProtectKernelTunables` o se remonta `/sys` en la unidad, hay que volver a comprobarlo**: si solo se
    viera `lo`, el cofre se negaría a abrir (fallo seguro).
  - Sin auditoría criptográfica independiente. Probar en la Pi antes de guardar datos reales y **cambiar antes la
    contraseña débil de `pi`**.
