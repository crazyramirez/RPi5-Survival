# ADR 0018 — Mapas de cualquier país, contenidos por idioma y región, y «Descargarlo todo»

- **Estado:** aceptada (2026-11-16) a petición del usuario.
- **Contexto:**
  - Solo había mapas de España, Canarias y el mundo.
  - Lo descargado por defecto era siempre en español, aunque la interfaz ya estaba en cuatro idiomas (ADR 0017).
  - El usuario pide:
    - mapas de cualquier país con un buscador;
    - valores por defecto según el idioma y la ubicación del equipo (español si no se sabe);
    - un botón que lo descargue todo y confirme que no falta nada;
    - un asistente inicial de un solo clic.
- **Decisión:**
  - **Países:** `content/countries.json` se genera con `scripts/build-countries.mjs` a partir de dos fuentes de
    dominio público.
    - **Natural Earth 1:50m:** 242 países con su nombre en es/en/fr/it.
    - **Zonas rectangulares:** las partes cercanas se agrupan; los islotes de menos de 500 km² se descartan; los
      territorios a más de 20° se marcan `far` y no se descargan con el país.
    - **IANA `zone.tab`:** zona horaria → país.
  - **Lógica común** (`scripts/country-maps.mjs`, para motor y servidor):
    - zoom según la superficie: 15 hasta 700 000 km², luego 14, 13 y 12;
    - tamaño estimado calibrado con España (3,4 GB a z15);
    - cuadrículas BRouter que cubren el país.
  - **Motor:** plantillas `mapa-pais` y `rutas-pais` en el catálogo y país como variante (`mapa-pais:fra`), el
    formato que la tarea de la Pi ya valida.
    - Un mapa por zona (`pais-fra[-n]-<fecha>-z<zoom>.pmtiles`).
    - Rutas: solo las cuadrículas que existen en el índice de BRouter (las de mar no); en la Pi, con
      `routing-install.sh install-tiles`.
  - **Detección del país, sin Internet ni servicios externos:**
    1. posición medida: GNSS o, si no hay, la última del nodo LoRa (la interfaz dice cuál);
    2. si no, la zona horaria del sistema;
    3. si no, la región del idioma del navegador;
    4. si nada, España con la interfaz en español.
    - El usuario puede elegir otro país y se recuerda.
  - **Idioma inicial:** solo la primera vez, en la bienvenida. Es el del navegador, salvo que sea inglés genérico
    en un país de otra lengua (Chromium de la Pi viene en inglés).
  - **Contenidos por idioma:**
    - **Catálogo:** 33 libros nuevos verificados en el OPDS de Kiwix (francés, italiano y equivalentes en inglés),
      enlazados por `equivalentOf`.
    - **Plan** (`utils/content.ts → downloadPlan`): por tema, la opción en el idioma de la interfaz; si no existe,
      en inglés; nunca en un idioma que el usuario no ha elegido.
    - **Mapas:** los del país (España conserva los suyos) y el del mundo.
  - **«Descargarlo todo»:**
    - al principio de Mantenimiento → Contenidos y en la bienvenida (allí sin confirmación: es un clic);
    - descarga todo el catálogo en los idiomas del usuario, también lo no marcado, más los mapas y rutas del país
      y todos los modelos del asistente;
    - lo ya descargado no se repite y lo que no cabe se avisa;
    - el modelo recomendado se instala el último, porque instalar un modelo lo deja activo.
- **Consecuencias y límites:**
  - Los tamaños son estimados y se dicen como tales: Andorra se estimó en 8 MB y midió 10 MB; sus rutas, 120 MB
    frente a 115 MB.
  - **Territorios de ultramar:** no se descargan (Guayana Francesa, Hawái…). Habría que añadirlos como
    elección aparte.
  - **Manuales en PDF:** siguen en español e inglés. Los de otros idiomas son una ampliación del catálogo.
  - **Validado el 2026-11-16:**
    - descarga real de Andorra (mapa y rutas) con el motor portable en Windows;
    - interfaz en la Pi: Mapas («Añadir país»), Contenidos («Descargarlo todo») y bienvenida.
