# Guía de diseño de la interfaz

Pantalla objetivo: 1024×600 táctil en una Raspberry Pi 5, que funciona sin Internet. El objetivo es un aspecto premium sin coste de rendimiento. La referencia viva es `pages/sistema/index.vue`.

## Principios

1. **Primero el estado.** Cada pantalla abre con lo que importa: una cifra grande, un estado con su color o un resumen. Los detalles van debajo.
2. **Datos honestos.** Todo valor pasa por `Probe<T>`. Si no hay medida, se muestra «—» con el motivo (`ProbeNote`). Nunca se dibuja un arco, una barra o un número estimado.
3. **Uso táctil.** Toda zona pulsable mide al menos `var(--touch)` (48 px) y nada depende del *hover*. Al pulsar, `transform: scale(.97)`.
4. **Rendimiento en la Pi.** Las únicas animaciones son entradas de una sola vez (≤ 200 ms) y transiciones de `transform`, `opacity` o `width` al cambiar un dato. No se usan:
   - `backdrop-filter` ni `filter: blur`;
   - sombras grandes animadas;
   - animaciones continuas;
   - fuentes o recursos externos.

   Los degradados estáticos y las sombras finas (`box-shadow` de 0 0 0 Npx) no tienen coste apreciable.
5. **Textos.** Todos en `locales/es.ts`, nunca literales en la plantilla. En `<style scoped>` no se usa `:global(X) .y`.

## Tokens (`assets/css/main.css`)

| Token | Uso |
|---|---|
| `--surface-grad` | Fondo de tarjeta: degradado de `--surface-2` a `--surface` |
| `--radius-lg` (14px) | Bloques destacados: resumen, diálogos, baldosas de inicio |
| `--hairline` | Separadores finos de listas y filas clave/valor |
| `.tone-*` → `--tone` | Color semántico: ok, warn, danger, info, muted |

## Clases globales (prefijo `ui-` para no chocar con las clases de cada página)

- `.ui-sec`: título de sección en versalitas con filete (p. ej. «HARDWARE»).
- `.ui-chip` + `.tone-*`: etiqueta compacta con tono (incidencias, filtros pasivos).
- `.ui-figure` > `.num` / `.unit` / `.cap`: cifra destacada (5,08 V, 1024×600…).
- `.ui-field`: campo táctil con anillo de foco del acento.
- `.ui-row`: fila de lista táctil con separador fino.
- `.btn`, `.btn-primary`, `.btn-danger`: con degradado y respuesta al pulsar.

## Componentes

- `AppCard` (title, icon, tone, pill): tarjeta estándar con filo superior e icono del color del tono. Sin `tone`, el icono usa el acento.
- `StatePill`: píldora con punto de estado.
- `KvRow`: fila etiqueta/valor; `mono` para cifras y `tone` para colorear el valor.
- `SysGauge`: medidor radial de 270° (ratio 0–1 o null, marcas de umbral).
- `ConfirmDialog`: confirmación con icono en círculo. Obligatorio para toda acción destructiva o larga.

## Patrones

- **Resumen** (bloque superior): icono en círculo con halo del tono, titular, una línea de detalle y 2–4 cifras a la derecha separadas por filetes. Fondo: degradado del tono del 14 % a transparente sobre `--surface-grad`.
- **Bento**: `grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr))`, `gap: var(--gap)`, `align-items: stretch`.
- **Listas**: filas de 48 px o más, separador `--hairline`, punto de estado de 0,55 rem con anillo `0 0 0 3px` del tono al 18 %.
- **Controles**: rejilla de botones con icono, título y una pista corta (`small`) debajo. La acción peligrosa va al final, en el tono `danger`.
