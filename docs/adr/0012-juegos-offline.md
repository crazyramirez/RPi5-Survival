# ADR 0012 — Juegos offline (copia local de Viseni Games)

- **Estado:** aceptada (2026-11-13) a petición del usuario. El usuario es el autor del sitio
  (`d:/DEV/Games ViseniDEV`).
- **Contexto:** el usuario quiere un botón «Juegos», antes de «Bloquear», que abra
  [games.viseni.com](https://games.viseni.com/) completo y sin Internet, y otro botón para volver a descargarlo.

  El sitio es un portal Nuxt pregenerado con 11 juegos 3D, la mayoría en Babylon.js (≈ 1,6 GB). Los juegos cargan
  sus modelos, texturas y audio desde JavaScript, así que un rastreador no encuentra todos los archivos.
- **Decisión:**
  - **Inventario publicado por el propio sitio,** sin rastreo:
    - **Portal:** `sw.js`, que ya genera `modules/service-worker`, lista cada archivo con `sha256[:16]`.
    - **Juegos, media y capturas:** `offline-manifest.json` (`format: viseni-offline/1`), con ruta, tamaño y
      SHA-256 completo. Lo genera `npm run offline-manifest` (`tools/offline-manifest.mjs`) en el repositorio del
      portal, porque las builds de los juegos no están en git y se suben aparte.
    - El manifiesto también lista los recursos externos (CDN, Google Fonts) encontrados en el HTML y el CSS de
      los juegos: esos no funcionarán sin red.
  - **Descarga:** tarea `games` (`survival-admin@games`, root), que ejecuta `scripts/games-sync.py sync|remove`.
    - La URL base es fija en el código; la web local solo elige la acción.
    - Valida cada ruta (sin `..`, ocultos ni absolutas) y verifica cada archivo con su hash.
    - Límites: 20 000 archivos, 6 GB en total y 1 GB por archivo; antes comprueba el espacio libre.
    - Los archivos sin cambios se enlazan (hardlink) desde la copia actual: solo se baja lo nuevo.
    - Monta la copia en `releases/.staging-*` y cambia el enlace `current` de golpe. Si falla a medias, la copia
      anterior queda intacta.
    - Estado en `/var/lib/survival-os/games/state.json`. Un archivo que no se verifica tras 3 intentos no se
      instala, y su juego queda marcado como «incompleto».
  - **Servicio** `survival-games` (`scripts/games-server.mjs`):
    - usuario `survival`, `127.0.0.1:8790`, solo GET/HEAD, sin listados, sin salir de la copia (`realpath`);
    - admite rangos para audio y vídeo, y sirve `<ruta>/index.html` y `200.html` como la SPA.
    - **Otro origen a propósito:** los juegos son código de terceros. La web solo acepta acciones de su mismo
      origen exacto, con host y puerto (`isTrustedActionRequest`, endurecido aquí). La CSP de los juegos
      bloquea toda la red externa (`connect-src 'self'`) y solo deja embeberlos en `127.0.0.1:3000`.
    - El `sw.js` del portal se sustituye por uno que se da de baja, para no duplicar la copia en la caché de
      Chromium.
  - **Interfaz:**
    - botón «Juegos» en la barra inferior (no en la vista pública) que abre `/juegos`;
    - en `/juegos`, un iframe con `sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-modals"`:
      sin navegación de la página superior, sin ventanas nuevas y sin pantalla completa. Atrás e Inicio
      siguen siempre disponibles;
    - la CSP de la web añade `frame-src http://127.0.0.1:8790`;
    - en Mantenimiento, la tarjeta «Juegos offline»: descargar o volver a descargar, quitar, registro de la
      tarea, juegos incompletos y avisos de recursos externos.
- **Consecuencias:**
  - Ocupa ≈ 1,6 GB en la microSD.
  - Cada vez que el autor cambie juegos o media, debe regenerar y subir `offline-manifest.json`. Si no, el
    equipo marcará como incompletos los archivos cuyo hash ya no coincida.
  - Robert's Bunker carga Babylon.js, Google Fonts y showdown desde CDN: no funcionará offline hasta que esos
    recursos estén dentro de su build.
  - Otros juegos pueden pedir al CDN de Babylon componentes opcionales en tiempo de ejecución (decodificadores).
    Se comprueba abriendo cada juego en el equipo sin red.
  - Las clasificaciones online, como la de TURBOWAVE (backend PHP), no funcionan offline.
- **Vuelta atrás:**
  - Tarea `games` con `remove`, o borrar `/var/lib/survival-os/games`.
  - `systemctl disable --now survival-games`.
  - Quitar el botón de `ActionBar.vue`.
