# Changelog

## 0.8.0 — 2026-11-09 · Interfaz premium, cofre, guía en papel y calidad

### Interfaz premium en todas las pantallas
- Sistema de diseño (`docs/ui-design.md`):
  - Tokens: `--surface-grad`, `--radius-lg`, `--hairline`.
  - Clases globales con prefijo `ui-`.
  - AppCard con filo e icono del tono de estado.
  - Píldoras con punto de estado.
  - Botones con degradado y respuesta táctil `scale(.97)`.
  - Diálogos con entrada de 160 ms.
  - Sin desenfoques ni animaciones continuas: probado a 1024×600.
- **Sistema:**
  - Estado global derivado de alertas medidas.
  - Medidores radiales (temperatura, carga, memoria, disco).
  - Tendencias de 15 min con huecos donde no hubo medida.
  - Paneles de hardware y software.
  - Rejilla de control táctil.
- **Mantenimiento:**
  - Resumen y pestañas fijas.
  - Paquetes y modelos en tarjetas.
  - Interfaces de red.
  - Esquema en color de los pines GPIO.
- **Resto de pantallas:**
  - Inicio, Navegación (brújula SVG con rumbo medido), Mapas (controles opacos sin desenfoque sobre el mapa),
    Bóveda, Emergencias, Herramientas, Comunicaciones y Preguntar (fases reales, respuesta como texto plano y
    fuentes numeradas).
  - Barras, bloqueo y panel de pantalla.

### Rutas sin conexión (ADR 0010)
- BRouter 1.7.10 en la Pi (Java 17), con datos OSM de España y Canarias. Botón «Ruta» en Mapas:
  - a pie, en bici o en coche;
  - origen GNSS, LoRa o centro del mapa; destino centro del mapa o un punto guardado;
  - línea en el mapa con distancia, tiempo y desnivel, y exportación a GPX.
- Instalar o quitar desde Mantenimiento → «Rutas sin conexión».
- En la Pi: 20 km en 0,3 s; Madrid → Sevilla en 10,5 s.

### Mapas y bóveda
- Posición de respaldo del nodo LoRa en el mapa (rombo ámbar «LoRa · hace N min») y centrado en ella sin GNSS.
- Ficha «Añadir punto» arriba (el teclado en pantalla ya no la tapa) y más ancha: los 6 tipos en una fila.
- Bóveda:
  - las imágenes se abren a pantalla completa con zoom (pellizco, doble toque, rueda, botones);
  - los documentos se pueden renombrar (la extensión se conserva).
- Los errores muestran el motivo del servicio en lugar de «Bad Request».
- Usuario de escritorio renombrado a `survival-pi`: el instalador detecta el usuario real (nunca supone `pi`).

### Emergencias: 41 protocolos
- 33 protocolos nuevos (de 8 a 41), con fuentes ERC 2025, OMS, Ministerio de Sanidad, DGPCE, INTCF, NHS/NICE, CDC y
  WMS. Categorías nuevas: «Intoxicaciones y picaduras» y «Desastres y entorno».
- Revisión independiente de cifras y dosis contra la fuente. Cambios:
  - tormentas: regla del NWS («si oyes truenos, estás a su alcance»);
  - aspirina: ajustada al texto del ERC 2025;
  - aguijón: se rasca de lado, no se pellizca;
  - cuándo llamar al 112 en 4 protocolos que no lo decían.
- Pantalla Emergencias: búsqueda local (sin tildes) y chips por categoría.

### Cofre de alta seguridad (ADR 0008) — RETIRADO el mismo día a petición del usuario
- Se quitaron el código, la interfaz y las pruebas; la bóveda LUKS2 sigue igual (`vault-selftest.sh` vuelve a 11/11).

**Historial** (lo que se hizo antes de retirarlo):
- Segunda capa dentro del volumen LUKS:
  - contraseña propia (Argon2id nativo de Node, 256 MiB);
  - AES-256-GCM por elemento, con el id como AAD y títulos incluidos;
  - nada en claro en disco.
- Solo se abre con el equipo **sin red** (operstate real de `/sys/class/net`, verificado en la Pi). Se cierra solo a
  los 120 s, si aparece red o al cerrar la bóveda.
- Rechaza frases semilla (regla del §15). No copia al portapapeles. Los secretos se tapan solos a los 20 s.
- Revisión de rpi5-survival-81 aplicada:
  - un cofre dañado nunca se sobrescribe; copia `.bak` de recuperación;
  - escrituras con `fsync`;
  - una sola derivación Argon2id a la vez (también en `/setup` y `/unlock` de la bóveda).
- Tipos: acceso, datos personales y nota segura. Pruebas unitarias (25) y 4 comprobaciones nuevas en
  `vault-selftest.sh` (15/15 esperadas).

### Fase 8 — Guía de emergencia en papel
- `/emergencias/imprimir`:
  - portada con el 112;
  - índice por categorías;
  - un protocolo por hoja con fuente y fecha de revisión;
  - A5/A4; «Guardar como PDF» desde el kiosco.
- `npm run guide`: HTML y PDF sin red en el PC (`docs/guia-emergencia-a5|a4.pdf`, 41 protocolos), con el mismo CSS que la página.

### Fase 9 — Calidad
- `npm run e2e -- <url>`: E2E por CDP sin dependencias nuevas.
  - En cada pantalla: sin errores JS, sin peticiones externas, sin desbordamiento horizontal, objetivos táctiles
    ≥ 44 px y h1.
  - Además: un toque navega y un arrastre táctil desplaza.
- Primera ejecución: 61/61. Encontró botones de cabecera de 40–42 px, ya corregidos a 44 px.
- Historial de métricas medidas en memoria (90 muestras × 10 s) y tendencias en Sistema.

### Fase 10 — Punto de acceso Wi-Fi local y vista pública (ADR 0009)
- Comunicaciones → «Punto de acceso Wi-Fi local»:
  - encender, con confirmación y aviso de que se pierde el SSH por Wi-Fi;
  - apagar, que vuelve a la red de casa;
  - generar una contraseña nueva;
  - ver SSID, contraseña oculta hasta tocar, URL, clientes, cortafuegos y pasarela.
- Al reiniciar el equipo siempre arranca apagado (`autoconnect=no`), y si algo falla al encender se revierte todo.
- Red sin Internet: nft corta el reenvío; desde el AP solo se aceptan DHCP, DNS y HTTP. Portal cautivo: el móvil
  abre Survival OS solo.
- Pasarela `survival-public`: solo GET/HEAD, con lista blanca de mapas, emergencias, libros Kiwix y salud. La web
  sigue en loopback y el guardián privado deniega lo privado aunque algo se colara.
- Vista pública en el móvil: solo Mapas, Biblioteca (estantería) y Emergencias. Sin estado del equipo, posición,
  búsqueda, documentos propios, asistente, bóveda ni sistema.

### Malla LoRa Meshtastic por USB (servicio `survival-mesh`)
- Nodo Heltec V4 (ESP32-S3, firmware 2.7.26) conectado por USB: el iPhone sigue por Bluetooth a la vez
  (Meshtastic solo admite un cliente BLE; la API serie convive con él).
- Servicio Python `survival-mesh` (127.0.0.1:8787, usuario `survival`, sin red, solo dispositivos serie):
  nodos (batería, SNR, saltos, última vez oído, posición si la hay), canales (sin claves), mensajes de texto
  en SQLite (máx. 2000) y envío con límite de 200 bytes y 1 mensaje cada 3 s. Lo que el nodo no informa es null;
  batería 101 = alimentación externa; horas anteriores a 2020 = desconocidas.
- Dependencias fijadas con hash (`services/mesh/requirements.txt`, `pip --require-hashes --only-binary`).
- Instalación, cambio de puerto y desinstalación desde la página `/malla` (tarea root `mesh`; puerto
  `/dev/serial/by-id/…`). La pasarela ESP32 ya no reclama el puerto de Meshtastic aunque sea `303a:*`.
- Comunicaciones: la tarjeta LoRa muestra el estado real y enlaza a `/malla`. No está en la vista pública del AP.
- Build: `nitro.externals.traceInclude` con `@vue/compiler-core` → se acaba el fallo intermitente de
  `estree-walker` (antes 0/3 builds válidos, ahora 3/3).

### Hora de respaldo sin red (ADR 0011, `survival-timesync.timer`, `survival-mesh` 0.3.0)
- Cada minuto, como root y con solo `CAP_SYS_TIME`, la Pi elige la fuente de hora en este orden: NTP, después GNSS
  por gpsd y después LoRa. La hora LoRa solo vale si llega por el canal privado y hay dos muestras que coinciden con
  ± 10 s de margen.
- El reloj solo se ajusta si la diferencia pasa de 60 s.
- `device-api` informa de la fuente `lora` o `gnss` si se comprobó hace menos de 12 h. Sistema → Hora muestra
  «Comprobada sin red» y el «Último ajuste».
- **Prueba real en la Pi:**
  - con NTP desactivado y el reloj atrasado 1 h a propósito, se recuperó la hora con la del GPS de la base
    (L76K). Error final −0,2 s respecto a la hora real, medido con el reloj monótono;
  - después se volvió a activar NTP y la Pi quedó sincronizada.
- GPS del GPIO (GY-NEO6MV2) retirado con `gps-uart-setup.sh --undo`.
- **Hallazgo:** la Pi 5 interfiere en la banda del GPS. Pegada a la Pi, la base no fijaba; separada 1–2 m, fijó en
  unos 90 s desde arranque en frío.

### Malla: nodo base + nodo de bolsillo seguido por radio (`survival-mesh` 0.2.0)
- Esquema de dos Heltec V4:
  - una base fija por USB en la Pi («Survival Base»);
  - el nodo de bolsillo va con el usuario, emparejado con el iPhone por BLE.
  - La Pi recibe su posición por LoRa, sin cables.
- Canales en los dos nodos:
  - principal «Survival» con PSK aleatoria y precisión de posición completa (32 bits). La PSK se generó en la Pi
    y se copió de nodo a nodo por USB sin imprimirse;
  - LongFast como secundario, para seguir en la malla pública. El canal público recorta la posición a 13 bits,
    unos 2,9 km.
- Nodo de bolsillo: posición cada 15 min y, si se mueve, cada 2 min y 50 m como mínimo.
- Nodo seguido:
  - API `GET/POST /track`; `status.tracked` y `status.trackId`;
  - botón «Seguir en el mapa» en `/malla`; la elección queda guardada en la Pi.
  - El respaldo de navegación usa el nodo seguido (`remote`, `nodeName`, `precisionM`), y el mapa indica
    «posición de X por LoRa» y «± d» si está recortada.
- Última posición conocida guardada por nodo, solo la del propio y la del seguido. La anterior, sin id de nodo, se
  descarta porque podía atribuirse al nodo equivocado.
- Pasarela ESP32:
  - un nodo Meshtastic tiene el mismo USB (`303a:1001`) que un ESP32 propio. La pasarela lo reconoce por su
    registro serie («DEBUG | hh:mm:ss n [Hilo] …») y suelta el puerto;
  - antes se quedaba con cualquier segundo nodo enchufado y bloqueaba su configuración.
- Verificado en la Pi: la base recibe la posición del nodo de bolsillo con precisión completa (SNR +5,75, directo),
  y `/api/nav/status` da el respaldo `remote: true`.

### Fase 11 — Brillo
- Comprobado y descartado el brillo por software en este panel (Waveshare WS170120):
  - DDC/CI (`ddcutil`): no responde;
  - USB HID: protocolo de Waveshare probado; el panel acepta la escritura, pero no cambia.

  Brillo físico `unavailable` (verificado); se mantienen la atenuación y el apagado del panel.

## 0.7.0 — 2026-11-08 · Fases 2–7 (software)

Validado en la Pi reinstalada (Bookworm 2026-10-06, misma microSD) el 2026-11-08: arranque 6,8 s y kiosco a
los ~7 s; `test-offline.sh` 21/21; `vault-selftest.sh` 11/11 y prueba E2E de la bóveda por API; pasarela
ESP32 con simulador (conexión, basura, desconexión, reconexión); búsqueda unificada con 3 ZIM; mapa de
España con GPU real. 100 tests en el PC. **Pendiente de persona delante:** táctil, GPS al aire libre,
ESP32 real, pruebas de energía.

Correcciones durante la validación: `AF_NETLINK` para kiwix-serve; búsqueda Kiwix por id de contenido
(`content=`) e intercalado por relevancia; espejos de Kiwix con umbral de velocidad (50 KB/s → 9 MB/s);
`wayvnc` ya no se desactiva sin `--disable-vnc` (decisión del usuario); aviso si falta WebGL2; nombres de
región con tilde; simulador ESP32 incluido en la release.

### Asistente de consulta con IA local (2026-11-08, noche)
- llama.cpp compilado en la Pi (commit fijado `7d7f028`) y servicio `survival-llm` (loopback, sin red).
- Catálogo cerrado de modelos con SHA-256: Qwen3 4B Instruct 2507 (recomendado, Apache-2.0), Gemma 3 4B, Llama 3.2 3B.
  Benchmark en la Pi: lectura 17–43 tok/s, generación 2,9–4,6 tok/s.
- Respuestas basadas en la biblioteca: palabras clave, raíces, prioridad a protocolos y a la Wikipedia (médica),
  máx. 4 fuentes, citas [n], «No lo encuentro en la biblioteca» si no hay base. Página Biblioteca → Preguntar.
- Instalación, cambio de modelo, borrado y desactivación desde Mantenimiento (tarea `llm`).
- Tareas de mantenimiento con bloqueo por grupos (una descarga de contenidos ya no impide otras tareas).
- `content-fetch` retira otras variantes (nopic/maxi) del mismo libro al instalar una nueva.
- Fragmentos de artículo elegidos por la zona con más palabras distintas de la pregunta (no la primera
  aparición): «síntomas de la deshidratación» ya llega a la sección de síntomas.
  A igualdad, gana la zona con las palabras más juntas y, después, la primera del artículo.
- `install-system.sh` vuelve sola a la release anterior si `/api/health` no responde (probado en la Pi).
- `release.mjs` arranca el servidor de `.output` en una copia fuera del repo y exige `/api/health`: el trazado
  de Nitro omite a veces `estree-walker` 2 (anidado en `@vue/compiler-core`) y el servidor no arrancaba.
  Además exige que `GET /` sea HTML de producción con sus scripts `/_nuxt` presentes: un `nuxt dev` vivo en el
  repo durante el build regeneró `.nuxt` en modo dev y la app quedaba en blanco aunque `/api/health` diera 200.
- Asistente: si el navegador abandona la página, el proxy corta la petición y se libera el modelo; el aviso de
  «ocupado» dice cuánto lleva la otra pregunta y ofrece «Cancelar la pregunta en curso y preguntar».
- Proxy: vuelve a respetar `timeoutMs` (900 s para el asistente; se había quedado fijo en 120 s).
- Historial de consultas al asistente (solo en el equipo, máx. 200): columna «Consultas anteriores» en
  Preguntar, abrir (`?h=<id>`), borrar una, vaciar (con confirmación) e interruptor «No guardar historial».
  Las consultas guardadas aparecen como fuente «Consultas anteriores» en la búsqueda de la Biblioteca.
  No se guardan las preguntas canceladas ni las fallidas.
- Lector: oculto el botón «Go to welcome page» (🏠) del visor de Kiwix.
- Preguntar muestra el nombre amigable del modelo («Qwen3 4B (recomendado)»), no el fichero; catálogo único en
  `app/utils/llm.ts`, compartido con Mantenimiento.

### Todo operable desde la pantalla (2026-11-08, noche)
- **Mantenimiento** (Sistema → Mantenimiento): descargar/borrar contenidos Kiwix con progreso, importar mapas y
  documentos desde USB, copia de seguridad a USB, actualizar Survival OS desde USB, ajustar fecha/hora,
  encender/apagar Wi-Fi y configurar el GPS en la UART del GPIO. Tareas root como `survival-admin@<tarea>.service`
  (`scripts/admin-job.py`, validación estricta), lanzables por `survival` solo vía regla polkit acotada.
- **Táctil como táctil**: labwc sin emulación de ratón (arrastrar desplaza, ya no selecciona texto) y estilos
  táctiles inyectados en el lector Kiwix y en los documentos. Verificado con eventos táctiles en la pantalla real.
- **Teclado en pantalla propio** (español, ñ, tildes, símbolos): squeekboard no arranca en la instalación limpia.
- Fuente de emojis para la barra del lector Kiwix.

### Fase 2 — Kiosco y energía (validada en la Pi)
- Instalación de sistema `install-system.sh` / `uninstall-system.sh`: usuario `survival`, `/opt/survival-os`, systemd con `IPAddressDeny`.
- Kiosco Chromium por unidad de usuario activada por el socket Wayland; página de arranque/recuperación local.
- Apagar/reiniciar desde la UI (polkit limitado); apagar pantalla (agente FIFO + swayidle/wlopm); vigilante de salud.
- Pantalla a 1024×600 nativo. Arranque 2:57 → ~1:00: sin overlays de cámara fantasma, sin `wait-online` ni `wayvnc`.
- **Diagnóstico: la microSD da timeouts de datos** → contadores en la UI y alerta; recomendado sustituirla.

### Fase 3 — Biblioteca y emergencias
- Servicio `library`: FTS5 (`node:sqlite`) para documentos propios, búsqueda unificada con Kiwix, favoritos.
- kiwix-serve 3.8.2 estático (hash fijado), `content-fetch.sh` con presets y manifiesto de procedencia.
- 8 protocolos de emergencia con fuentes (ERC 2021, OMS, CDC, SODIS), fecha de revisión y aviso de redacción con IA.

### Fase 4 — Mapas y GPS
- Servicio `navigation`: cliente gpsd, waypoints, tracks (grabación opt-in), GPX import/export.
- Mapas MapLibre 6 + PMTiles locales (España z15 3,4 GB, Canarias), glifos/sprites/worker servidos localmente.

### Fase 5 — Bóveda
- Servicio `vault` LUKS2/Argon2id, root sin red, montaje privado, límite de intentos, autobloqueo, importación USB.
- `vault-selftest.sh` (robo de SD simulado, cabecera) y `vault-backup.sh` (copia cifrada y restauración).

### Fase 6 — ESP32
- `esp32-gateway`: protocolo JSON Lines v1 validado, límites, hotplug y desconexión sin bloqueo; regla udev.
- Firmware de ejemplo (sin probar en hardware) y simulador por pty.

### Fase 7 — Campo
- `backup.sh` / `restore.sh`, hoja de campo para imprimir, protocolo de pruebas de energía.

## 0.1.0 — 2026-11-08 · Fase 0 + Fase 1

### Fase 0
- Auditoría de hardware no destructiva por SSH → `docs/hardware-inventory.md`.
- Hallazgos: panel nativo 1024×600 forzado a 1920×1080 por kanshi; sin pila RTC; wayvnc expuesto en LAN; ModemManager activo; EEPROM con actualización disponible (no aplicada).

### Fase 1
- Monorepo npm workspaces, TypeScript estricto, ESLint, Vitest (51 tests).
- `services/device-api`: estado real (CPU/térmica, ventilador, memoria, disco, alimentación/throttling, PSU negociada, RTC, hora, red, pantallas, entrada, serie, software) con contrato `Probe<T>`.
- `apps/frontend`: UI táctil 1024×600 con barra de estado, Inicio + 8 módulos con estados honestos, bloqueo anti-toques, alto contraste, texto grande, atenuación visual. `/api/health`, `/api/device/status`.
- Seguridad: loopback por defecto, CSP `default-src 'self'`, guardia de rutas privadas (`/boveda`, `/api/vault`).
- Scripts: `diagnose.sh`, `install.sh` (no invasivo), `run.sh`, `start.mjs`, `test-offline.sh`, `release.mjs`.
- Unidades systemd de ejemplo (no instaladas).

### Corregido durante la validación en la Pi
- `install.sh` abortaba con SIGPIPE (`tar | head` + `pipefail`).
- Chromium mostraba la burbuja de Google Translate → `translate="no"` + meta `notranslate`.
- **Texto grande dejaba la pantalla en blanco**: `:global(:root[...]) .date` en `<style scoped>` se compila a `:root[...] { display:none }`. Regla movida a CSS global + test de regresión.
