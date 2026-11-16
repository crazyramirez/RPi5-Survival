# Changelog

## 0.11.2 — 2026-11-16 · Actualizaciones de la portable en Linux

### Corregido
- **La portable en Linux (y macOS) no se actualizaba sola** cuando el navegador era Firefox o Chromium en snap:
  cerrar la ventana no cierra Survivelia OS, así que la versión descargada («se aplica al cerrar») nunca se
  aplicaba, y al volver a abrirla solo se abría otra ventana de la versión antigua. Ahora, al volver a abrir
  Survivelia OS con una actualización preparada, la instancia en marcha la aplica y se reabre con la versión nueva.
  - Las portables ya instaladas necesitan aplicar esta versión una vez a mano: Mantenimiento → Actualizaciones →
    «Instalar ahora», o Sistema → «Cerrar Survivelia OS» y volver a abrir.

## 0.11.1 — 2026-11-16 · «Descargarlo todo» en español

### Corregido
- **«Descargarlo todo» decía «Selección no válida» en español** (bienvenida y Mantenimiento, en la Pi, Linux,
  la portable y Android): con el catálogo actual el plan completo en español pasa de 100 elementos y la API y la
  tarea root solo aceptaban 100. El tope sube a 500 y un test comprueba que el plan completo de cada idioma cabe.

## 0.11.0 — 2026-11-16 · Survivelia OS, icono de Android y actualizaciones al abrir

### Cambiado
- **La app se llama Survivelia OS** en toda la interfaz (cuatro idiomas), la app Android, la portable (ventana,
  «Survivelia OS.exe», «Survivelia OS.app», accesos directos, memoria USB) y la Pi (quiosco y servicios).
  - Las instalaciones existentes siguen funcionando: se conservan la carpeta de datos `SurvivalOS` de Android, el
    paquete de la app, `/opt/survival-os` y los nombres de los ficheros de las versiones.
  - Si ya estaba instalada en el equipo como «Survival OS», se sigue usando esa carpeta; sus lanzadores y accesos
    antiguos se sustituyen o se actualizan solos. «Abrir al conectar» ya activado sigue valiendo.
  - Las memorias USB nuevas se llaman «SURVIVELIA».

### Añadido
- **Buscar actualizaciones al abrir la app y al volver a primer plano** (también al recuperar la conexión), si hay
  Internet: como mucho una comprobación cada 10 minutos. Sin conexión no se anota ningún error. Con
  «Automática» además se descarga; «Desactivada» no se conecta nunca.

### Corregido
- **Icono de Android** con marco blanco: ahora es un icono adaptativo (fondo y brújula a sangre, y versión
  monocroma para los iconos temáticos de Android 13).
- `npm run dev` funcionaba mal si la carpeta del repositorio tenía espacios.

## 0.10.0 — 2026-11-16 · App Android, actualizaciones automáticas y herramientas de campo

### Añadido
- **Buscar un lugar sin conexión (Mapas → «Buscar lugar»):** pueblos, barrios, aldeas y parajes de los mapas
  instalados, con los nombres en el idioma de la interfaz y primero los más cercanos al centro del mapa. Desde el
  resultado, «Ruta hasta aquí» o «Guardar como punto». El servicio de biblioteca indexa la capa de lugares de los
  PMTiles (lector PMTiles v3 + MVT propio, sin dependencias) en `places.sqlite` con FTS5 y lo rehace al cambiar los
  mapas. Disponible también para los móviles de la red local (solo datos del mapa).
- **Medir distancia y área** en el mapa, tocando o con la mira del centro.
- **Herramientas de campo** (Herramientas → «De campo»), calculadas en el equipo y con su fuente:
  - **Sol y Luna:** alba, salida, puesta, anochecer, horas de luz, mediodía solar y fase lunar (NOAA), para la
    posición GNSS, la del nodo LoRa o las coordenadas escritas;
  - **Señales:** linterna, SOS y mensajes en Morse con la pantalla (tiempos de la UIT);
  - **Frecuencias de emergencia:** marina, aviación, balizas, CB, PMR446, radioaficionados, Meshtastic, FRS y GMRS,
    con su fuente y si exigen licencia;
  - **Agua y comida** por personas y días (mínimos del Manual Esfera);
  - **Conversor de unidades:** longitud, peso, volumen, temperatura, velocidad y presión.
- **Notas (Biblioteca → Notas):** notas, diario y listas con casillas (`- [ ]`), plantillas de kit de emergencia
  (Ready.gov) y diario de incidencias. Entran en la búsqueda de la biblioteca y como fuente del asistente. Se
  guardan sin cifrar y la pantalla lo dice (para datos sensibles, la bóveda).
- **App Android (ADR 0020):** un APK para tablets (Android 10+, arm64; y x86_64 para el emulador y los
  Chromebooks) con la misma aplicación que la portable.
  - Instalar el APK y listo: la primera vez se elige dónde guardar los datos (carpeta SurvivalOS en la memoria
    interna o en la microSD, que se conserva al desinstalar) y se conceden los permisos (ubicación, batería,
    notificaciones).
  - **Sin Internet, todo en la tablet:** mapas y rutas (BRouter), Wikipedia (kiwix-serve), manuales con búsqueda
    (pdftotext), asistente (llama.cpp con la mejor variante de CPU del dispositivo), bóveda, juegos y «Descargarlo
    todo».
  - **Hardware de la tablet:**
    - GNSS interno como receptor GPS;
    - batería y cargador reales;
    - nodo LoRa/Meshtastic, GPS y placas ESP32 por USB OTG;
    - memorias USB y microSD para importar y hacer copias;
    - actualizar desde un APK verificado en una memoria USB;
    - «Fijar la pantalla» (quiosco).
  - **Sigue funcionando con la pantalla apagada** (servicio en primer plano; CPU despierta solo mientras descarga).
  - **Seguridad:** en Android cualquier app puede conectarse a 127.0.0.1, así que todos los servicios exigen un
    token por arranque. La bóveda y la ubicación van por sockets privados.
  - `npm run release:android` (binarios: `android/scripts/natives.mjs`).
- **Asistente ligero (Qwen2.5 1.5B, 1,1 GB)** para equipos con poca memoria: «Descargarlo todo» y la bienvenida ya
  no proponen modelos que no caben en la RAM y, en su lugar, dejan activo el ligero.
- **Actualizaciones desde GitHub (ADR 0021)** en la Pi, la portable y Android:
  - Mantenimiento → Red → «Actualizaciones»: versión instalada y última, novedades en tu idioma, «Buscar ahora» e
    «Instalar»; aviso en la barra de estado cuando hay versión nueva;
  - modos **Automática**, **Solo avisar** y **Desactivada**:
    - la portable de escritorio viene en «Automática»: descarga sola y aplica al cerrar Survival OS, sin
      interrumpir nunca;
    - en la Pi y en Android, «Solo avisar» por defecto. En la Pi, «Automática» instala de 02:00 a 06:00 con la
      bóveda cerrada;
  - solo instala versiones **firmadas** (Ed25519) y comprueba tamaño y SHA-256 de lo descargado. Nunca baja de
    versión; sin conexión, lo dice;
  - la portable arranca la versión nueva en **autoprueba** y, si no responde, **vuelve sola** a la anterior (como
    ya hacía la Pi);
  - `npm run express -- update` (agentes): estado, «Buscar ahora», modo e instalar.
- **Publicación sincronizada:**
  - `npm run release:publish` se niega a publicar si el árbol tiene cambios, `main` no está subido, las versiones
    no coinciden, falta el CHANGELOG o fallan los tests;
  - compila la Pi, la portable completa y una por sistema (y el APK con `--android`), comprueba la versión dentro
    de cada fichero, firma el manifiesto, publica y verifica lo publicado;
  - `npm run set-version -- X.Y.Z` alinea todos los `package.json` y `package-lock.json`.

### Cambiado
- **Visores a todo el ancho:** los documentos (tipografía adaptable, tablas, código y citas con estilo, día y noche)
  y el PDF ajustado sin el tope de 1100 px. El Markdown admite tablas GFM y bloques de código.
- Mapas: botones del carril de 48 px para que quepan nueve en la pantalla de la Pi. Las rejillas de Herramientas
  llenan siempre las filas (2 columnas en la Pi, 4 en pantallas anchas).
- Versiones del monorepo alineadas: serial-hub, vault y shared-types estaban en 0.8.0/0.1.0.
- La carpeta `app/` de la portable y la del APK salen del mismo montaje (`scripts/stage-app.mjs`); el zip se
  extrae con `scripts/zip.mjs` (sin programas externos).

### Corregido
- Motor de descargas: instalar un modelo con `model install` registraba el estado en el elemento de Qwen3 4B,
  fuera cual fuera el modelo.
- Textos de los servicios sin traducir en el mapa («Receptor conectado, esperando datos»).
- **Progreso de los mapas:** se quedaba en 0 % hasta terminar. Ahora sigue el porcentaje de pmtiles o, si va por
  delante, los bytes que lleva recibidos.
- **Descargas cortadas** (app cerrada, reinicio): se quedaban en «Descargando 0 %» y bloqueaban el botón de
  descargar. Ahora salen como «Descarga interrumpida» y se pueden relanzar.
- **Empaquetado (portable y APK):** se niega a seguir si la compilación tiene ficheros de código llenos de ceros.
  Pasó una vez y el APK no arrancaba.
- **Tarjeta «Sistema» del inicio:** sin la telemetría de la Pi (portable, Android) muestra la batería del equipo
  en lugar de «Sin datos de alimentación».

## 0.9.0 — 2026-11-16 · Portable completa, mapas de cualquier país, cuatro idiomas y memoria USB integrada

### Añadido
- **Memoria USB de Survival OS integrada en Windows, macOS y Linux (ADR 0019):**
  - **Icono y nombre propios** de la unidad. Al abrirla solo se ve «Survival OS»: las carpetas internas quedan ocultas.
  - **Windows:** `Survival OS.exe` con su icono, en lugar del `.cmd`.
  - **Linux (GNOME):** ofrece «Ejecutar» al conectarla.
  - **Ventana de la app** con el icono de Survival OS (favicon y manifest).
  - **«Abrir al conectar esta memoria»:**
    - opcional, una vez por equipo, sin administrador y desactivable;
    - solo reacciona ante tu memoria (identificador aleatorio); pregunta antes de abrir, o abre directamente si lo eliges;
    - añade «Survival OS (USB)» al menú de aplicaciones;
    - la primera vez que abres la memoria en un equipo, Survival OS lo ofrece.
  - **Expulsar la memoria USB** (Mantenimiento y Sistema): cierra todo, la expulsa con seguridad y avisa cuando se puede retirar.
  - **Preparar una memoria USB:**
    - copia Survival OS a otra memoria, para todos los sistemas y con tus datos si quieres;
    - nunca pisa los datos que ya tenga;
    - avisa de FAT32 (límite de 4 GB) y la deja integrada.
- **Juegos en «Descargarlo todo»:** los juegos son un contenido más del catálogo (grupo «Juegos») y se descargan también con un clic. En la barra, «Juegos» va antes que «Pantalla» y solo aparece si están descargados.
- **Mapas de cualquier país (ADR 0018):**
  - buscador en Mapas («Añadir país») y en Mantenimiento, por nombre en cualquier idioma, con tamaño estimado;
  - mapa con zoom según el tamaño del país y rutas sin conexión opcionales;
  - 242 países con datos de dominio público.
- **Idioma y región del equipo:**
  - el país se detecta sin Internet: posición GNSS o LoRa, zona horaria o idioma del navegador;
  - el idioma inicial, por el navegador y la zona horaria;
  - los contenidos por defecto, en tu idioma: 33 libros nuevos en francés, italiano e inglés; en inglés si no existe en el tuyo;
  - en Mantenimiento solo se ven los contenidos de tus idiomas (los demás, con un interruptor).
- **«Descargarlo todo»** al principio de Contenidos y en la bienvenida (un clic):
  - completa lo que falta para tu idioma y tu país, incluidos todos los modelos del asistente, ajustado al espacio;
  - si no falta nada, lo confirma.
- Mantenimiento → Contenidos: las tarjetas de Kiwix y del asistente ocupan todo el ancho.
- **Portable igual de completa que la Pi (ADR 0016):**
  - **Mantenimiento** con las mismas secciones y tareas.
  - **USB y copias:**
    - memorias y discos USB en Windows, macOS y Linux;
    - importar mapas y documentos;
    - copia de seguridad verificada (bóveda cifrada incluida).
  - **Actualizar desde USB** (zip + `.sha256`):
    - verifica, cambia la aplicación al cerrarse sin tocar los datos y reabre sola;
    - guarda la versión anterior.
  - **Reiniciar la aplicación** y **GPS por USB** (puerto y velocidad).
  - **Pasarela ESP32 de sensores** en los tres sistemas (dentro de `serial-hub`).
  - **Red y hora** se muestran; las gestiona el sistema operativo del ordenador.
- **Idiomas: español, inglés, francés e italiano (ADR 0017).**
  - **Interfaz completa** en los cuatro idiomas (917 textos): se elige en la bienvenida (lo primero) o en Pantalla, y se recuerda. Fechas, números, etiquetas del mapa y `lang` del HTML siguen al idioma.
  - **Teclado en pantalla por idioma:** AZERTY con ç en francés, QWERTY con ñ en español, y teclas de acento de cada idioma (´ ` ^ ¨).
  - **Protocolos de emergencia** (41) en inglés, francés e italiano: traducción fiel de la ficha revisada en español, con las mismas cifras y dosis comprobadas automáticamente. La ficha avisa de que prevalece el original en español.
  - **Servicios en el idioma de la interfaz:** catálogo de descargas, búsqueda, asistente (responde en el idioma de quien pregunta) y motivos de «no disponible».
  - Test que impide que una traducción se quede sin una clave o cambie un marcador `{x}`.
- **Visor integrado de documentos (`/visor`):** los PDF y enlaces de los libros de la biblioteca (ZIM) que antes abrían una ventana sin salida en el kiosco se abren ahora dentro de la app, con barra para volver y cerrar. Ningún enlace (`target="_blank"`, `window.open`, navegación de la ventana principal) puede sacar al usuario de la app; los enlaces externos se ignoran (no hay Internet). El lector de ZIM va en un iframe con `sandbox` sin ventanas emergentes ni navegación superior.
- **Barras de desplazamiento del tema** en toda la app (listas, modales, textos, paneles) y dentro de los artículos de la biblioteca y del visor: píldora redondeada sin flechas sobre pista transparente, que se ilumina en el acento al usarla; clara u oscura según la página y el modo noche; variante de alto contraste.
- **Visor de PDF propio** (pdf.js 6.4.299, Apache-2.0, servido por el equipo): sustituye al del navegador, que no admite los estilos de la app. Páginas sobre el fondo del tema con la barra de desplazamiento de la app; barra flotante táctil con página actual y anterior/siguiente, zoom (botones, pellizco y Ctrl+rueda), ajustar al ancho y modo noche. Solo dibuja las páginas cercanas a la vista y libera las lejanas (probado con un manual de 488 páginas en la Pi). La CSP admite `'wasm-unsafe-eval'` (solo compilar WebAssembly, para los decodificadores de imágenes JPEG 2000/JBIG2; sigue sin permitir `eval`).
- **Manuales en PDF (ADR 0015, ampliado):** 66 manuales, 709 MB, 59 de ellos en español. Cada uno se ha verificado (URL directa, licencia y SHA-256 fijado) y se descarga desde la fuente oficial, sin copias de terceros.
  - **Salud:**
    - Hesperian: «Donde no hay doctor», «… para mujeres», «Donde no hay dentista», «Un libro para parteras», «Guía comunitaria para la salud ambiental» y «Aprendiendo a promover la salud»;
    - OMS/CICR: atención básica de emergencia;
    - CICR: primeros auxilios y cirugía con recursos limitados;
    - MSF: medicamentos esenciales y guía clínica;
    - OMS/OPS: primera ayuda psicológica, salud mental, diarrea y cólera, obstetricia, pediatría, cadáveres y víctimas en masa;
    - FICR y CAWST: agua y saneamiento.
  - **Preparación:**
    - Protección Civil: autoprotección, inundaciones, meteorología adversa y riesgo químico o nuclear;
    - guía para las familias (Educación/Interior);
    - IGN: terremotos y tsunamis, y lectura del mapa topográfico;
    - FICR: refugio;
    - OPS: agua en emergencias;
    - Scouts: orientación y cabuyería;
    - IARU y URE: telecomunicaciones de emergencia;
    - FAO: huertos, conservación de alimentos, silos, agua de lluvia, aves y conejos;
    - Ejército de EE. UU.: supervivencia y navegación terrestre (en inglés, de dominio público).
  - **Libros por capítulos** (Hesperian): cada capítulo se verifica por separado.
  - **Búsqueda dentro de los manuales**, también en la portable: se descarga `pdftotext` (Xpdf 4.06) para el sistema. Los resultados muestran el título real del libro y del capítulo (`titles.json`).
  - **`scripts/catalog-pin-docs.mjs`:** herramienta para fijar nuevos manuales (descarga, comprueba que es un PDF y calcula el SHA-256).
  - **Fuera por ahora:** el Manual Esfera, porque ReliefWeb rechaza las descargas automáticas (HTTP 406) y spherestandards.org tiene protección anti-bots.
- **Interfaz adaptable a cualquier pantalla:** portátil 16:10 y 16:9, monitor grande, tablet, móvil y el panel de 1024×600 de la Pi.
  - **Tipografía y espaciado fluidos:** 16 px en la Pi y en móvil, hasta 20 px en 1920×1200. En pantallas ultrapanorámicas el contenido se centra (máximo 1880 px) y las barras se alinean con él.
  - **Inicio:** cuadrícula según el número de módulos (4×2 sin filas cojas).
    - Las tarjetas escalan icono, título y resumen con su tamaño (container queries).
    - En vertical o en móvil, 2 columnas con desplazamiento.
  - **Barra de estado** con prioridades según su ancho: primero se oculta la fecha, luego los textos secundarios, y la hora y su verificación se ven siempre. La **barra inferior** queda solo con iconos en móvil.
  - **Estados vacíos claros y con acción** (componente `EmptyState`):
    - Mapas → «Descargar mapas»;
    - Biblioteca → «Descargar contenidos»;
    - asistente → «Descargar el asistente».
  - **Móvil:**
    - las cabeceras de estado se apilan;
    - el conversor de coordenadas se reparte en dos filas;
    - el buscador de la biblioteca baja a su propia fila;
    - el pie del catálogo solo se queda fijo cuando hay algo seleccionado.
  - **Portable:**
    - Comunicaciones muestra «Compartir en la red local» en lugar del punto de acceso de la Pi;
    - la bóveda describe su cifrado real (AES-256-GCM);
    - Herramientas lista los puertos COM o `/dev/cu.*`.
- **Portable igual de completa que la Pi (ADR 0016):**
  - **Nuevo servicio `serial-hub`:** malla LoRa (Meshtastic) y GPS por USB en Windows, macOS y Linux, sin módulos nativos.
    - Ofrece la misma API que `survival-mesh` y un servidor compatible con gpsd, así que la interfaz y la navegación no cambian.
    - Detecta solo el nodo y el receptor.
    - Contra el nodo Heltec V4 real da lo mismo que la versión Python.
  - **Bóveda portable:** Argon2id (256 MiB) y AES-256-GCM.
    - Keyslots para la contraseña y la clave de recuperación, como en LUKS.
    - Documentos cifrados por bloques, con detección de manipulación y truncado, e índice cifrado.
    - Misma API y misma pantalla que en la Pi.
  - **Batería y hora del portátil:** Windows (PowerStatus y w32tm), macOS (pmset) y Linux (adaptador del kernel).
  - **Juegos:** la tarea `games` usa `games-sync.mjs`, y el servidor de juegos arranca en cuanto hay copia.
  - **«Compartir en la red local»:** pasarela de solo lectura en la IP de la Wi-Fi. Nunca se activa sola.
- **Motor de descargas y catálogo (ADR 0015):** catálogo único `content/catalog.json` y motor `scripts/content-engine.mjs`, iguales en la Pi y en la portable.
  - **Catálogo:** 38 contenidos.
    - Biblioteca ampliada, en español: MedlinePlus, Ready.gov, Proyecto Gutenberg, Wikisource, Low-Tech Magazine, WikiRoca, Wikiversidad y PhET.
    - Supervivencia en inglés, solo lo que no existe en español: bibliotecas zimgit (desastres, medicina, agua, nudos, alimentos), Military Medicine, Appropedia, energypedia, Stack Exchange (outdoor, bricolaje, huerto, mecánica, radio, cocina) y los manuales del Ejército de EE. UU.
    - Mapas: España, Canarias y mundo.
    - Rutas: España y Canarias.
    - Asistente.
  - **Detecta el sistema** y descarga el componente adecuado con su SHA-256 fijado: kiwix-tools, llama.cpp, go-pmtiles, Java (Temurin) y BRouter, para Windows, macOS y Linux x64/arm64.
  - **Descargas de ZIM:**
    - espejos con reanudación;
    - SHA-256 del servidor maestro, con reintentos ante 429;
    - registro en la biblioteca y retirada de versiones anteriores.
  - **Mapas:** extracción por región del último build de Protomaps.
  - **Primera puesta en marcha** (`/bienvenida`):
    - todo marcado por defecto, español primero;
    - se ajusta solo al espacio libre, desmarcando primero lo de menor prioridad;
    - avisa de que el sistema tardará en estar listo al 100 % y de que se puede usar mientras tanto;
    - el inicio muestra el progreso.
  - **Mantenimiento → Contenidos:** catálogo completo para instalar y quitar. En la Pi, tarea `content` (admin-job.py, validada contra el catálogo).
  - **Portable:**
    - descargas, asistente (llama.cpp), Wikipedia (kiwix-serve) y rutas (BRouter) funcionan igual que en la Pi;
    - el lanzador arranca cada servicio en cuanto existen su componente y sus datos.
- **Versión portable (ADR 0014):** Survival OS en una carpeta para USB, disco o equipo; Windows, macOS y Linux (x64 y arm64).
  - `npm run release:portable` genera `release/portable/Survival OS/` y un zip.
    - Node v24.22.2 de cada sistema, verificado con SHA-256.
    - El zip conserva los permisos Unix, así que `node`, el `.sh` y la `.app` son ejecutables al descomprimir.
  - Se abre con doble clic:
    - Windows: «Abrir Survival OS», sin consola;
    - macOS: «Survival OS.app»;
    - Linux: «abrir-survival-os.sh».
  - El lanzador:
    - arranca los servicios en loopback con puertos libres y reinicios;
    - abre una ventana propia del navegador y lo detiene todo al cerrarla;
    - deja los registros en `data/logs` y muestra los errores de forma visible.
  - «Instalar en este equipo», sin administrador: copia la app a la carpeta de aplicaciones del usuario y crea accesos
    directos. Si ya estaba instalada, la actualiza y conserva sus datos.
  - Modo portable en la interfaz:
    - tarjeta en Mantenimiento: carpetas de contenido, instalar y cerrar;
    - «Cerrar Survival OS» en Sistema;
    - la Bóveda se oculta.
  - Modo portable en el servidor:
    - nunca se apaga ni se toca el equipo anfitrión;
    - las tareas de la Pi se rechazan con un aviso claro.
  - Probado en Windows 11 y en Linux arm64. Falta probarlo en macOS.
- Inicio: si no hay medida de alimentación, Sistema dice «Sin datos de alimentación» en lugar de «Revisar alimentación/temperatura».
- **Bóveda: clave de recuperación (ADR 0013).**
  - Al crear la bóveda se genera una clave aleatoria de 160 bits (`XXXX-XXXX-…`). Se muestra una sola vez para apuntarla en papel.
  - Queda en un segundo keyslot LUKS2 con la misma KDF Argon2id que la contraseña.
  - «He olvidado la contraseña»: con la clave se pone una contraseña nueva y los documentos se conservan.
  - Con la bóveda abierta se puede crear la clave (bóvedas antiguas) o regenerarla.
  - «Descartar bóveda»: si no hay ni contraseña ni clave, aparta el contenedor cifrado (no lo borra) para crear otra.
  - `vault-e2e.sh` prueba la API real en la Pi con una instancia temporal (14/14).
  - `vault-selftest.sh` ejecuta en la Pi el código real del servicio (`dist/luks.js`) contra un contenedor temporal (17/17).
  - Corregido antes de usarse: crear la bóveda fallaba con «Error interno de la bóveda» (`luksAddKey: Failed to open key file`).
    - Causa: la clave se pasaba por `/dev/fd/3`, y en Node ese descriptor es un socket.
    - Ahora va en un fichero efímero en tmpfs, privado del servicio.
- **Bóveda: se admiten contraseñas sencillas y PIN** (mínimo 4 caracteres; solo se rechazan `1111`, `1234`…).
  - La pantalla avisa de que una contraseña débil no protege si roban la microSD.
- **Juegos offline (ADR 0012):** botón «Juegos» en la barra inferior, antes de «Bloquear», que abre la copia local completa de Viseni Games.
  - Tarea `games` (`scripts/games-sync.py`): descarga verificada por hash.
    - El inventario sale de `sw.js` y de `offline-manifest.json`, ambos publicados por el propio sitio.
    - Las actualizaciones son incrementales (hardlinks) y el cambio de copia es atómico.
  - Servicio `survival-games`, en `127.0.0.1:8790`: otro origen a propósito, con CSP sin red externa.
  - Tarjeta «Juegos offline» en Mantenimiento: descargar, volver a descargar o quitar.
  - El botón «Juegos» de la barra inferior solo aparece si la copia está descargada; aparece o desaparece al terminar la descarga o al quitarla.
- Seguridad: las acciones de la web exigen ahora su mismo origen exacto, con host y puerto (`isTrustedActionRequest`).
- UPS Geekworm X120x (X1202): `survival-ups.timer` lee cada 30 s, sin escribir nunca en el chip.
  - **Red eléctrica:** por el GPIO6, leído con pull-down y con pull-up para descartar un pin al aire.
  - **Batería:** por el medidor MAX17040 (I²C 0x36): carga y tensión de la celda.
  - device-api expone `battery` (ahora también `voltageV`) y el nuevo `mains`.
  - La barra de estado muestra «Con red eléctrica», «Batería N % · sin red», etc.
  - Sistema muestra «Red eléctrica (UPS)» y la tensión de la batería.
  - Alertas: aviso al quedarse sin red y peligro si además la batería está al 20 % o menos.
  - Requiere `dtparam=i2c_arm=on` para la batería; la red funciona sin I²C.
  - `i2c-dev` se añade a `modules-load.d`.

### Corregido
- **Kiosco de la Pi tras reiniciarlo:** ya no se queda sin la app en pantalla. Esperaba a que se cerrase el Chromium anterior y, si no, salía.
- **Malla y Comunicaciones:** un fallo momentáneo del servicio (por ejemplo, al actualizar, que lo reinicia unos 2 s) mostraba «no disponible» y la configuración con «Buscar puertos USB», aunque el nodo estuviera configurado por USB.
  - Ahora se conserva el último estado bueno y se reintenta a los 2 s.
  - Solo tras 3 fallos seguidos se informa de que el servicio no responde.
  - Comunicaciones consultaba una única vez al abrir la página; ahora se refresca cada 10 s.
- **`content-engine.mjs` no hacía nada en la Pi:** `/opt/survival-os/current` es un enlace simbólico y la comprobación de «ejecutado directamente» fallaba. Ahora compara rutas reales.
- **Pasarela pública:** el portal cautivo incluye el puerto en la redirección cuando no es el 80.
- Nodo LoRa enchufado después de arrancar: `survival-mesh` daba `PermissionError` en bucle y la pasarela ESP32 daba `stty_failed`.
  - Causa: `DeviceAllow=char-ttyACM` y `char-ttyUSB` se resuelven al arrancar la unidad. Si el driver aún no está cargado, el permiso queda vacío.
  - Arreglo: nuevo `systemd/modules-load.d/survival-os-serial.conf`, que carga `cdc_acm` y `usbserial` al arrancar.
  - Lo instala `install-system.sh` y lo quita `uninstall-system.sh`.

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
