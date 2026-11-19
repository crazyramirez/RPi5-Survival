# ADR 0017 — Interfaz y protocolos en español, inglés, francés, italiano, alemán, chino y japonés

> **Ampliación (2026-11-19, v0.14.0):** alemán (`de`), chino simplificado (`zh`, `zh-Hans` en mapas y HTML) y japonés
> (`ja`), a petición del usuario, con el mismo alcance que francés e italiano: interfaz, mensajes de los servicios,
> herramientas de campo, 41 protocolos (traducidos con IA, sin revisión nativa ni sanitaria), catálogo de descargas
> con contenidos propios de cada idioma (Wikipedia completa y médica, Wikcionario, Wikiviajes, Wikisource, iFixit,
> Wikilibros, Gutenberg, Wikiversidad y PhET donde Kiwix los publica), asistente, nombres de países y lugares.
> - **Teclado en pantalla:** QWERTZ con ä, ö, ü y ß en alemán; en chino y japonés escribe letras latinas (no hay
>   método de entrada propio: para caracteres hace falta teclado físico con el del sistema).
> - **Búsqueda en chino y japonés:** sin espacios entre palabras, la pregunta se parte en pares de caracteres
>   (bigramas), como hace Kiwix con estos idiomas.
> - **Fuentes:** la interfaz usa la fuente del sistema para los caracteres CJK (en la Pi, Droid Sans Fallback, ya
>   instalada); los mapas los dibujan con `localIdeographFontFamily` sin glifos descargados.
> - **Notas de versión:** siguen en es/en/fr/it (`scripts/update-lib.mjs`): las instalaciones ya desplegadas
>   rechazarían un manifiesto con notas en otro idioma. En de/zh/ja se muestran las de inglés.

- **Estado:** aceptada (2026-11-16) a petición del usuario («Todo en inglés, francés e italiano también»).
- **Contexto:**
  - Hasta ahora todo estaba en español: la interfaz (`locales/es.ts`), los protocolos de emergencia, los motivos
    de «no disponible» de los servicios, el catálogo de descargas y el asistente.
  - Quien no lee español no podía usar justo la parte crítica (Emergencias).
- **Decisión:**
  - **Interfaz:** `locales/en.ts`, `fr.ts` e `it.ts` con las mismas claves que `es.ts`.
    - El tipo `Record<MessageKey, string>` obliga a que estén todas, y `test/i18n.test.ts` comprueba también los
      marcadores `{x}`.
    - El español sigue siendo el idioma por defecto y la referencia.
  - **Elegir idioma:**
    - en la bienvenida (lo primero, con cada idioma escrito en su propio idioma) y en Pantalla;
    - se guarda en el navegador y en la cookie `survival-lang`;
    - cambiarlo recarga la app, así nada queda a medio traducir.
    - Fechas y números (`toLocaleString`), etiquetas del mapa, `lang` del HTML y teclado en pantalla siguen al
      idioma: AZERTY con ç en francés, QWERTY con ñ en español, y teclas de acento propias de cada idioma.
  - **Servicios:** el servidor web pasa el idioma de la cookie a los servicios en `x-survival-lang` (proxy).
    - **Biblioteca:**
      - protocolos de `content/protocols/<idioma>/`; si falta una ficha, se usa la española;
      - búsqueda y asistente en ese idioma: prompt, frase de «no lo encuentro» y palabras vacías.
    - **Catálogo de descargas:** títulos y descripciones de `content/catalog-i18n/<idioma>.json`.
  - **Motivos de los servicios** (`Probe.reason`, errores):
    - los servicios siguen hablando español;
    - la interfaz los traduce con `translateServer` (tabla `locales/server/<idioma>.ts`, exacta o con plantillas
      `{0}`);
    - lo que no está en la tabla se muestra en español: mejor el motivo real que ocultarlo (ADR 0003).
- **Protocolos traducidos:**
  - Son traducciones fieles de la ficha revisada en español:
    - mismas cifras, dosis y estructura (comprobado automáticamente);
    - `id`, `reviewed` y `sources` idénticos;
    - campo `translatedFrom: es`.
  - La ficha y la guía imprimible avisan de que, ante la duda, prevalece el original en español.
  - Se tradujeron con IA y no han pasado revisión sanitaria nativa; igual que el original, siguen pendientes de
    revisión profesional (aviso `em.aiNotice`).
- **Límites:**
  - **Contenidos descargables:** el catálogo solo tiene contenidos en español y en inglés. Con la interfaz en
    francés o italiano, las descargas por defecto siguen siendo en español. Añadir ZIM en francés e italiano es
    una ampliación del catálogo, no de la interfaz.
  - **Registros técnicos** (registro de tareas, `journalctl`): siguen en español.
  - **Guía en PDF** generada en el PC (`npm run guide`): sigue en español. La guía imprimible desde la pantalla sí
    sale en el idioma activo.
