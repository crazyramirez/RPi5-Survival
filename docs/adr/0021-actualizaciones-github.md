# ADR 0021 — Actualizaciones desde GitHub Releases

- **Estado:** aceptada (2026-11-16) a petición del usuario («un sistema de actualización basado en GitHub que detecte
  la última versión instalada y la actualice automáticamente; todo tiene que estar perfectamente sincronizado y
  funcional»). Amplía el ADR 0002 (instalación no invasiva), el 0014/0016 (portable) y el 0020 (Android).
- **Contexto:**
  - Ya había tres caminos de actualización **sin conexión**, desde un fichero en una memoria USB:
    - **Pi:** `survival-os-X.Y.Z.tar.gz` + `.sha256` → `install-system.sh`. Conserva la release anterior, comprueba
      `/api/health` y vuelve atrás sola si la nueva no responde.
    - **Portable:** `survival-os-X.Y.Z-portable*.zip` + `.sha256` → `.update/` → `apply-update.mjs` al cerrar el
      lanzador. Nunca toca `data/`.
    - **Android:** APK verificado → instalador del sistema, que pide un toque.
  - Un `.sha256` publicado **junto** al fichero protege de descargas dañadas, no de alguien que controle la cuenta
    de GitHub: podría subir las dos cosas.
  - Survival OS es un equipo de emergencia **sin Internet** por diseño (§1, §15). Nada puede depender de la red ni
    bloquear el arranque, y la interfaz no puede hablar con el exterior (CSP, `IPAddressDeny=any`).
- **Decisión:** GitHub Releases es **una fuente más** para los caminos que ya existían. No hay un instalador nuevo.
  - **Publicación (`npm run release:publish`, `scripts/release-publish.mjs`).** Se niega a publicar si algo no
    cuadra:
    - el árbol tiene cambios, la rama no es `main`, o `HEAD` no coincide con `origin/main`;
    - las versiones de los `package.json` del monorepo no coinciden (`npm run set-version -- X.Y.Z` las alinea,
      también en `package-lock.json`);
    - la etiqueta `vX.Y.Z` ya existe, o la versión no es mayor que la última publicada;
    - falta la sección `## X.Y.Z` en `CHANGELOG.md`;
    - `npm run check` falla.

    Después compila y empaqueta:
    - el tarball de la Pi;
    - la portable completa (todos los sistemas) y una por sistema, más pequeña;
    - siempre, los APK de Android (arm64 y x86_64): toda release lleva la versión Android. `--no-android` solo
      vale para revisar sin `--yes` en un equipo sin el toolchain de Android.

    Comprueba que cada fichero lleva **dentro** la versión correcta y genera el **manifiesto**
    `survival-os-update.json`: versión, fecha, commit, `minFrom`, notas por idioma, y nombre, plataformas, tamaño y
    SHA-256 de cada fichero. Lo **firma con Ed25519** (`survival-os-update.json.sig`) y verifica la firma con las
    claves que llevan las instalaciones, para no publicar nunca algo que no aceptarían.

    Sin `--yes` solo describe lo que haría. Con `--yes` crea la etiqueta, la sube, crea la release con `gh` y
    después descarga el manifiesto publicado, comprueba que es idéntico, verifica la firma y comprueba el tamaño
    de cada fichero publicado.
  - **Firma.**
    - La clave privada vive **solo** en el equipo de quien publica: `~/.survival-os/update-signing-key.pem`, o
      `SURVIVAL_UPDATE_SIGNING_KEY`. Nunca va al repositorio ni a CI.
    - Las claves públicas de confianza están en `scripts/update-lib.mjs` (`TRUSTED_KEYS`), con su identificador.
    - **Rotación:** una versión puede llevar la clave siguiente en `TRUSTED_KEYS` antes de usarla. Si se pierde la
      clave privada, las instalaciones existentes solo se pueden actualizar a mano, por USB.
  - **Comprobación (`scripts/update-engine.mjs`, Node sin dependencias, el mismo en todas las plataformas):**
    - baja `releases/latest/download/survival-os-update.json` y su `.sig`. No usa la API de GitHub: ni token ni
      límite de peticiones;
    - comprueba la firma y que el manifiesto está bien formado;
    - compara versiones (semver) y elige el fichero de **esta** plataforma. La portable con varios `runtime/` (una
      memoria USB para todos los sistemas) usa el zip completo, para no perder los otros sistemas;
    - respeta `minFrom` y nunca baja de versión;
    - envía un User-Agent genérico (`SurvivalOS-updater/<versión>`) y ningún identificador del equipo.

    Sin red, el estado lo dice («sin conexión») con la hora de la última comprobación correcta: no se inventa nada
    (ADR 0003). La comprobación automática se hace como mucho cada 20 h.
  - **Descarga:** reanudable, con el descargador del motor de contenidos (ADR 0015). Comprueba antes el espacio
    libre y después el tamaño y el SHA-256 **del manifiesto firmado**.
  - **Aplicación (lo que ya había, más vuelta atrás automática en la portable):**
    - **Pi:** tarea root `update-online` (o `update-auto` del temporizador). Instala con el `install-system.sh` de la
      **release nueva**, extraído del tarball ya verificado. Solo toca `/opt/survival-os`: nunca apt, el kernel,
      Wayland ni la EEPROM (§15). Las descargas y el estado van en `/var/lib/survival-os-update` (de root): el
      usuario `survival` no puede cambiarlos entre la verificación y la instalación.
    - **Portable:** se prepara en `.update/`.
      - Con el botón se aplica al momento: el lanzador se cierra y se reabre.
      - En modo automático, **al cerrar** Survival OS: nunca interrumpe.
      - `apply-update.mjs` arranca la versión nueva en modo **autoprueba** (`launcher.mjs --self-test`: servicios
        sin navegador hasta `/api/health`). Si no responde, **vuelve sola** a la anterior.
      - Mientras dura, un candado (`.update/applying.json`) hace esperar a un lanzador que se abra a la vez.
    - **Android:** se descarga el APK verificado y se abre el instalador del sistema, que pide un toque (Android no
      permite instalar en silencio). Debe estar firmado con la misma clave que el instalado.
    - **Desarrollo** (`npm run dev`, sin instalación): no se ofrece.
  - **Modos** (Mantenimiento → Red → «Actualizaciones»):
    - **Automática:** comprueba, descarga y aplica en un momento seguro.
    - **Solo avisar:** comprueba y avisa; se instala con un toque.
    - **Desactivada:** nunca se conecta sola; el botón «Buscar ahora» sigue funcionando.

    Por defecto:
    - **portable de escritorio:** Automática; se aplica al cerrar y no interrumpe nada;
    - **Pi y Android:** Solo avisar. En la Pi instalar es un cambio de sistema (reglas del proyecto); elegir
      «Automática» es la autorización explícita del usuario.
  - **Momento seguro en la Pi (modo Automática).** El temporizador `survival-update.timer` lanza cada hora
    `survival-admin@update-auto`. Instala solo si se cumple todo:
    - entre las 02:00 y las 05:59 (hora local);
    - la bóveda está cerrada;
    - no hay otra tarea de sistema ni de contenidos en curso.

    Si no, lo deja descargado y avisa («se instalará esta noche · Instalar ahora»).
  - **Interfaz:** tarjeta «Actualizaciones» con:
    - la versión instalada y la última, sus notas en el idioma de la pantalla (o en español si no existen) y el
      estado honesto;
    - los botones «Buscar ahora» e «Instalar»;
    - el modo, y en la barra de estado un aviso cuando hay versión nueva.

    `npm run express -- update` hace lo mismo desde fuera (AGENTS.md).
- **Consecuencias:**
  - La primera versión con actualizador (0.10.0) se instala a mano (USB, `express pi` o la portable nueva). A partir
    de ella, todas las demás llegan solas.
  - Publicar exige la clave de firma y un árbol limpio. Es intencionado: lo publicado sale siempre de una etiqueta
    de `main`, con tests verdes.
  - Una cuenta de GitHub comprometida no basta para instalar código en los equipos: sin la clave privada no hay
    firma válida.
  - Cada release pesa más (una portable por sistema), pero cada portable descarga solo lo suyo.
  - Las migraciones de datos tienen que poder repetirse sin efecto (idempotentes). Si una versión no puede venir
    directamente de otra antigua, se sube `minFrom` y la interfaz pide pasar antes por la intermedia.
