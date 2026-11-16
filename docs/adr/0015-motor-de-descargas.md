# ADR 0015 — Motor de descargas único, catálogo y asistente de primera puesta en marcha

- **Estado:** aceptada (2026-11-16) a petición del usuario.
- **Contexto:**
  - El usuario pide cuatro cosas:
    - ampliar la Biblioteca con más manuales, documentos y libros;
    - un asistente de primera puesta en marcha con todo marcado por defecto y aviso de que el sistema tardará en
      estar listo al 100 %;
    - que la versión portable sea **igual de completa** que la Pi y que **detecte el sistema y descargue el
      componente adecuado**;
    - contenidos **siempre en español por defecto**, y en inglés solo si no existe en español.
  - Antes había tres caminos distintos en bash y Python, solo para la Pi:
    - `content-fetch.sh` con presets;
    - `llm-install.sh`;
    - mapas preparados a mano en el PC.
- **Decisión:**
  - **Catálogo único**, `content/catalog.json`:
    - **Contenidos** (38 al crearlo):
      - ZIM de Kiwix, mapas Protomaps por región, rutas BRouter y el asistente;
      - cada uno con grupo, idioma, prioridad (1 imprescindible, 2 recomendado, 3 extra), si va marcado por
        defecto, tamaño orientativo, licencia y `equivalentOf`;
      - un contenido en inglés que ya tiene equivalente en español **no** se marca.
    - **Componentes por sistema** (win-x64, darwin-arm64/x64, linux-x64/arm64), con **SHA-256 fijado**:
      - kiwix-tools 3.8.2 (3.8.1 en Windows): Kiwix no publica hash, así que se calculó al fijar la versión;
      - llama.cpp b12428 y go-pmtiles 1.31.2: digest publicado por GitHub;
      - Temurin JRE 21.0.13+9: API de Adoptium;
      - BRouter 1.7.10.
    - **Modelos del asistente**, con SHA-256.
    - **Fuentes:** catálogo OPDS de Kiwix, espejos, builds de Protomaps, segmentos de BRouter y Hugging Face.
  - **Motor único**, `scripts/content-engine.mjs`: Node sin dependencias. Órdenes `install`, `remove`, `status`,
    `model` y borrado de ZIM y mapas.
    - **Perfil `pi`:** lo lanza la tarea `content` de `admin-job.py` como root, con lista cerrada validada contra
      el catálogo; deja los ficheros a nombre de `survival`. El asistente y las rutas siguen delegando en
      `llm-install.sh` y `routing-install.sh` (compilación nativa, Java del sistema, systemd).
    - **Perfil `portable`:** lo lanza el servidor web como proceso hijo (`portable-jobs.ts`), con el mismo contrato
      `AdminJobStatus` y registro, así que Mantenimiento no cambia. Las tareas `llm`, `routing`, `content-delete` y
      `maps-delete` de la portable se traducen a órdenes del motor.
    - **Detecta el sistema** (`platformKey`) y baja solo el componente de ese equipo a `runtime/<so-arq>/<componente>/`.
    - **ZIM:**
      - última versión según OPDS;
      - espejos con reanudación (Range); se abandona un espejo por debajo de 200 KB/s;
      - SHA-256 del servidor maestro, con reintentos ante 429;
      - registro con `kiwix-manage`, retirada de versiones anteriores y manifiesto de procedencia.
      - La descarga se da por completa según el `Content-Length` del servidor: el `length` de OPDS va redondeado a KiB.
    - **Mapas:** `pmtiles extract` del último build de Protomaps por bbox y zoom; SHA-256 calculado en `SHA256SUMS`.
    - **Estado:** `content-state.json`, con progreso y errores. Lo que hay **en disco** manda: la interfaz detecta
      también lo instalado con los scripts antiguos.
  - **Portable**, estructura igual que la Pi (`data/library/zim`, `data/maps`, `data/llm`, `data/routing`). El
    lanzador arranca kiwix-serve, llama-server y BRouter en cuanto existen su componente y sus datos (lo comprueba
    cada 10 s), y reinicia llama-server si cambia el modelo activo.
  - **Interfaz:**
    - `ContentCatalog.vue` por grupos, con etiqueta «inglés» y «Ya cubierto en español», estados, espacio libre y
      variantes (Wikipedia con o sin imágenes);
    - en el asistente, **ajuste automático al espacio** (desmarca primero prioridad 3 y luego 2, lo más grande antes;
      nunca lo imprescindible) y orden de descarga de imprescindible a extra, y de pequeño a grande;
    - `/bienvenida` aparece una vez (estado en `setup.json`) y avisa de que tardará en estar listo al 100 % y de que
      se puede usar mientras tanto; el inicio muestra el progreso;
    - Mantenimiento → Contenidos lleva el catálogo completo, para instalar y quitar.
- **Consecuencias y límites:**
  - Todo lo marcado por defecto suma unos 47 GB (32,6 en español, 14,5 en inglés sin equivalente). En la microSD de
    128 GB de la Pi, el ajuste automático lo adapta al espacio libre.
  - **Integridad:**
    - kiwix-tools no publica hash: el fijado protege frente a cambios posteriores, no frente a un servidor
      comprometido el día de la fijación;
    - las extracciones de mapas y las cuadrículas de BRouter no tienen hash publicado: se registra el calculado
      (honesto, no verificable de antemano).
  - Los presets antiguos (`content-fetch`) siguen funcionando, pero la interfaz ya usa el catálogo.
  - **Validado el 2026-11-16:**
    - **Windows 11, portable:** ZIM, kiwix-tools, mapa de Canarias, rutas de Canarias con JRE y BRouter, y el
      asistente: llama.cpp más Qwen3 4B, una respuesta real con cita del protocolo y unos 18 tokens/s.
    - **Pi, perfil pi:** tarea `content` con WikiRoca; kiwix pasó de 6 a 7 libros.
- **Ampliación (2026-11-16): manuales en PDF.**
  - **Tipo `doc`:** un PDF, o un libro por capítulos (`parts`), con URL, SHA-256 y tamaño fijados por fichero (`scripts/catalog-pin-docs.mjs`).
  - **Ubicación:** se guardan en `library/docs/manuales/`, donde la biblioteca los indexa (texto completo con `pdftotext`).
  - **Portable:** se descarga Xpdf 4.06 para el sistema. Componente opcional: no hay binario para linux-arm64, donde se usa el del sistema.
  - **Selección:** 66 documentos, revisados por dos búsquedas independientes con la licencia comprobada documento a documento:
    - abiertos: CC BY, CC BY-NC-SA IGO, reutilización del sector público español, dominio público de EE. UU.;
    - o descarga gratuita del editor para uso personal: MSF, CICR, OMS anteriores a 2019, FAO.
  - **Sin redistribución:** el equipo los descarga siempre de la fuente oficial; el proyecto no redistribuye copias.

