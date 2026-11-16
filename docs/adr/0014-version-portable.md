# ADR 0014 — Versión portable: carpeta autocontenida para Windows, macOS y Linux

- **Estado:** aceptada (2026-11-16) a petición del usuario. **Ampliada por los ADR 0015 y 0016:** la portable es
  igual de completa que la Pi. Los apartados «Solo en la Pi» y «kiwix-serve no se incluye» de abajo ya no aplican.
- **Contexto:**
  - El usuario quiere usar Survival OS fuera de la Pi, desde un USB o un disco, en Windows, macOS o Linux.
  - También quiere poder instalarlo en el propio equipo.
  - Pide que sea lo más intuitivo posible: «una carpeta desde la que ejecutar la app».
  - Datos de partida:
    - los servicios Node no tienen dependencias npm en tiempo de ejecución (`node:sqlite`);
    - el build de Nuxt no lleva binarios nativos;
    - todas las rutas se configuran por variables de entorno;
    - `Probe<T>` ya informa «no disponible» fuera de Linux.
- **Decisión:**
  - **Una carpeta, `Survival OS/`:**
    - `app/`: la web (`.output` de Nuxt), device-api, library, navigation, el contenido, `games-server.mjs` y `portable/`;
    - `runtime/<so-arq>/`: Node v24.22.2, el mismo que en la Pi;
    - `data/`: todo lo del usuario;
    - lanzadores en la raíz.
  - **Plataformas:** win-x64, darwin-arm64, darwin-x64, linux-x64 y linux-arm64 (Raspberry Pi OS de 64 bits).
    `npm run release:portable` incluye las cinco (≈ 580 MB, zip de ≈ 210 MB); `--targets=` genera una a medida.
  - **Lanzador** (`portable/launcher.mjs`), en lugar de systemd:
    - **Puertos:** loopback, preferidos 47800–47810 (fijos para que el origen y los ajustes del navegador no cambien
      entre arranques); si están ocupados se usa uno libre y se guarda en `data/ports.json`.
    - **Servicios:** reinicio con espera creciente (máximo 5) y registros en `data/logs/` con rotación a 5 MB.
    - **Una sola instancia:** usa `data/run.json`; si ya está abierta, solo se abre otra ventana.
    - **Ventana propia:** Chrome, Edge, Brave o Chromium con `--app`, perfil en `data/browser` y `--password-store=basic`.
      Al cerrar la ventana se detiene todo. Sin navegador Chromium, o si se desvincula en menos de 8 s (snap),
      se usa el navegador predeterminado y se sale con «Cerrar Survival OS».
    - **Errores:** se ven aunque no haya consola (MessageBox, `osascript`, zenity o kdialog). Se avisa de una USB
      protegida contra escritura o llena.
  - **Lanzadores por sistema:**
    - Windows: `Abrir Survival OS.cmd` → `wscript` + `.vbs`, sin ventana de consola.
    - macOS: `Survival OS.app` (script, `Info.plist`, icono `.icns`).
    - Linux: `abrir-survival-os.sh`.
  - **Zip** con permisos Unix en el atributo externo: `node`, `.sh` y el ejecutable de la `.app` con 0755.
    Escritor propio sin dependencias y sin Zip64 (menos de 4 GiB).
  - **Icono** (brújula) generado sin dependencias en PNG, ICO e ICNS.
  - **«Instalar en este equipo»** (`portable/install.mjs`; desde Mantenimiento o con `launcher.mjs --install`):
    - **Destino**, por usuario y sin administrador:
      - Windows: `%LOCALAPPDATA%\Programs\Survival OS`;
      - macOS: `~/Applications/Survival OS`;
      - Linux: `~/.local/share/survival-os`.
    - **Copia** solo el runtime de ese sistema. Si ya hay una instalación, actualiza `app/` y `runtime/` y **conserva sus datos**.
    - **Accesos directos:**
      - Windows: `.lnk` en el menú Inicio y el escritorio (wscript + .vbs, con icono);
      - macOS: la `.app` (Launchpad y Spotlight) y se quita la cuarentena;
      - Linux: un `.desktop`.
  - **Modo portable en la web** (`SURVIVAL_PORTABLE=1`, `NUXT_PUBLIC_PORTABLE=true`). En el servidor:
    - se rechazan las tareas de administración (409);
    - se rechazan apagar, reiniciar, la pantalla y el escritorio (`assertLinux` también comprueba que no sea portable:
      **nunca se apaga el equipo anfitrión**, aunque sea Linux);
    - la bóveda responde 503, porque LUKS solo existe en la Pi;
    - la CSP toma el origen de los juegos de `NUXT_GAMES_URL`.
  - **Modo portable en la interfaz:**
    - Mantenimiento muestra la tarjeta «Survival OS portable»: dónde se ejecuta, espacio libre, botones para abrir las
      carpetas de mapas, documentos, ZIM y datos, «Instalar en este equipo» y «Cerrar Survival OS»;
    - Sistema cambia «Apagar/Reiniciar» por «Cerrar Survival OS»;
    - el inicio oculta la Bóveda.
  - **Wikipedia (kiwix-serve):** el lanzador la arranca si encuentra `runtime/<so-arq>/kiwix-serve` y ficheros `.zim`
    en `data/zim`. El binario **no se incluye todavía**.
- **Consecuencias y límites:**
  - **Sin firma de código.**
    - macOS (Gatekeeper) pide «clic derecho → Abrir» la primera vez. Si el zip se descargó de Internet puede decir
      «dañada»: se arregla con `xattr -dr com.apple.quarantine` (explicado en LEEME.txt).
    - Windows puede mostrar SmartScreen.
  - **Solo en la Pi:** la bóveda, el GPS, LoRa, el UPS, el asistente LLM y las tareas de mantenimiento (descargas,
    red, actualizaciones). La portable lo dice en lugar de fallar o inventar datos.
  - **Contenido:** se añade copiando ficheros en `data/` (o con la copia de seguridad del equipo). La descarga guiada
    de contenidos queda para el asistente de primera puesta en marcha.
  - **Riesgo de corrupción:** retirar el USB con la app abierta puede dañar el índice SQLite de la biblioteca. LEEME y
    la tarjeta piden cerrar antes de retirarlo.
  - **Validado el 2026-11-16:**
    - **Windows 11 x64:** arranque, APIs, rechazo de las tareas de la Pi, cierre sin procesos restantes, e instalación
      con accesos directos redirigidos a una carpeta temporal.
    - **Linux arm64 (la Pi):** el zip se descomprime con `unzip` y se arranca con el `.sh`.
    - **macOS: pendiente** de probar en un Mac real.
