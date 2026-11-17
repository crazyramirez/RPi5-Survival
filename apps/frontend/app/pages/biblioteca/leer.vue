<script setup lang="ts">
import { DOC_SCROLLBAR_CSS, isDocumentLink, linkTitle, syncDocScrollbar, viewerUrl } from '~/utils/viewer'
import { ArrowLeft, Moon, Sun } from '@lucide/vue'
import { isSafeReaderPath } from '~/utils/snippet'
import { readerPosition, rememberReaderPosition, restoreWindowScroll } from '~/utils/scroll-memory'

/**
 * Lector Kiwix embebido (mismo origen vía proxy /kiwix). Mantiene la barra de estado
 * y las acciones de Survivelia OS visibles. Modo noche (por defecto) por inversión de color.
 */
definePageMeta({ guideCatalog: true })

const t = useT()
const route = useRoute()
const router = useRouter()
const backTo = useBackTo()
const { loadFavorites } = useLibrary()
/** Vista pública (punto de acceso): sin favoritos (son del equipo, no del móvil). */
const publicView = isPublicView()

function routeSrc(): string | null {
  const u = typeof route.query.u === 'string' ? route.query.u : ''
  return isSafeReaderPath(u) ? u : null
}
/**
 * Lo que carga el iframe. Fijo mientras se lee: el artículo abierto se anota en la URL (replace, más abajo) para
 * volver a él —p. ej. desde un PDF enlazado— sin recargar el iframe. Solo otro enlace al lector lo cambia.
 */
const src = ref(routeSrc())
watch(
  () => route.query.u,
  () => {
    const u = routeSrc()
    if (u !== current.value) src.value = u
  },
)
/** Modo noche por defecto (kiosco de uso nocturno); el usuario puede pasar a día. */
const night = useState<boolean>('reader:night', () => true)
const title = ref(t('lib.reader'))
const frame = ref<HTMLIFrameElement | null>(null)

/** Estilo táctil para documentos del lector: sin selección accidental, desplazamiento con el dedo. */
const TOUCH_CSS =
  'html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:pan-x pan-y;overscroll-behavior:contain}' +
  'a,button{touch-action:manipulation}' +
  // Barra de desplazamiento de la app (claro u oscuro según la página y el modo noche).
  DOC_SCROLLBAR_CSS +
  // Icono «imagen interactiva» de los banners de Wikiviajes: en la web lo colocan pequeño con CSS/JS que el
  // ZIM no incluye, así que se pinta a ~250 px encima de la foto. Decorativo y sin función offline.
  'img[src*="Interactive_icon"]{display:none!important}' +
  // Pantallas estrechas (móvil del punto de acceso): nada más ancho que la pantalla. Las tablas anchas
  // se desplazan dentro de su propio bloque en lugar de empujar toda la página.
  // Solo en pantallas estrechas: el kiosco (1024 px) conserva la maquetación original de los artículos.
  '@media (max-width:700px){' +
  // Reflujo: ningún elemento más ancho que su contenedor (maquetaciones de escritorio con anchos fijos,
  // p. ej. iFixit o Wikilibros). Las tablas anchas se desplazan dentro de su bloque (regla de abajo).
  'body *{max-width:100%!important;min-width:0!important;box-sizing:border-box}' +
  'html,body{max-width:100%;overflow-x:hidden}' +
  'img,video,svg,canvas,iframe,embed,object{max-width:100%!important}' +
  // Sin !important: respeta las alturas que fija el propio artículo (iconos); solo corrige el atributo height.
  'img,video{height:auto}' +
  'table{display:block;max-width:100%;overflow-x:auto}' +
  'pre,code{white-space:pre-wrap;overflow-wrap:anywhere}' +
  'body{overflow-wrap:break-word}' +
  '}' +
  // Sin botón «Go to welcome page» (🏠) del visor: la navegación es la de Survivelia OS.
  // Sin «Go to welcome page» (🏠): la biblioteca de Survivelia OS ya es la portada. Solo ese botón:
  // su contenedor .kiwix_button_cont también incluye el título del libro y el aleatorio (🎲).
  '#kiwix_serve_taskbar_library_button{display:none!important}' +
  // Modo noche inteligente. Visor de Kiwix: se invierte su barra (clara), no el artículo.
  'html.survival-night[data-survival-viewer] body{background:#1a1a1a}' +
  'html.survival-night[data-survival-viewer] body>:not(iframe){filter:invert(.9) hue-rotate(180deg)}' +
  // Artículos claros (p. ej. iFixit): se invierten; los que ya son oscuros (Wikipedia) se respetan.
  'html.survival-night[data-survival-light]{background:#1a1a1a!important}' +
  'html.survival-night[data-survival-light] body{filter:invert(.9) hue-rotate(180deg);background-color:var(--survival-bg,#fff)!important;min-height:100vh}' +
  // Las fotos se re-invierten para verse con sus colores.
  'html.survival-night :is([data-survival-viewer] body>:not(iframe),[data-survival-light] body) :is(img,picture,video,canvas){filter:invert(1) hue-rotate(180deg)}'

/** Color de fondo efectivo del documento (sin el modo noche aplicado). */
function backgroundOf(doc: Document): string {
  const win = doc.defaultView
  if (!win || !doc.body) return 'rgb(255, 255, 255)'
  for (const el of [doc.body, doc.documentElement]) {
    const bg = win.getComputedStyle(el).backgroundColor
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1]
    if (bg && bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0.5)) return bg
  }
  return 'rgb(255, 255, 255)'
}

function isLight(rgb: string): boolean {
  const [r = 255, g = 255, b = 255] = (rgb.match(/[\d.]+/g) ?? []).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

function applyNight(doc: Document | null | undefined): void {
  const root = doc?.documentElement
  if (!doc || !root) return
  // Clasificación una sola vez por documento, antes de aplicar nada.
  if (!root.hasAttribute('data-survival-kind')) {
    if (doc.getElementById('content_iframe')) {
      root.setAttribute('data-survival-viewer', '')
    } else if (doc.body) {
      const bg = backgroundOf(doc)
      if (isLight(bg)) {
        root.setAttribute('data-survival-light', '')
        root.style.setProperty('--survival-bg', bg)
      }
    } else {
      return
    }
    root.setAttribute('data-survival-kind', '')
  }
  root.classList.toggle('survival-night', night.value)
  // Pista de la barra del color de la página tal como se ve (con o sin el filtro del modo noche).
  if (!root.hasAttribute('data-survival-viewer')) syncDocScrollbar(doc, night.value && root.hasAttribute('data-survival-light'))
}

/** Documento del visor y artículos que muestra en su iframe interno. */
function readerDocs(): Document[] {
  try {
    const doc = frame.value?.contentDocument
    if (!doc) return []
    const inner = Array.from(doc.querySelectorAll('iframe'), (f) => f.contentDocument).filter((d): d is Document => !!d)
    return [doc, ...inner]
  } catch {
    return []
  }
}

watch(night, () => readerDocs().forEach(applyNight))

function injectTouch(doc: Document | null | undefined): void {
  if (!doc?.head) return
  applyNight(doc)
  if (doc.getElementById('survival-touch')) return
  const st = doc.createElement('style')
  st.id = 'survival-touch'
  st.textContent = TOUCH_CSS
  doc.head.appendChild(st)
  doc.addEventListener('contextmenu', (e) => e.preventDefault())
  // Enlaces que sacarían al usuario de la app (PDF, ventana nueva, ventana principal): al visor integrado.
  doc.addEventListener('click', (e) => keepInApp(e), true)
  // El visor de Kiwix muestra el artículo en un iframe interno: se aplica también ahí.
  for (const inner of Array.from(doc.querySelectorAll('iframe'))) {
    inner.addEventListener('load', () => {
      injectTouch(inner.contentDocument)
      syncArticle(inner.contentDocument)
      trackArticle(current.value, inner.contentWindow)
    })
    injectTouch(inner.contentDocument)
  }
}

/**
 * Los ZIM de bibliotecas (zimgit, manuales) enlazan PDF y a veces abren en ventana nueva o en la ventana
 * principal. En el kiosco eso deja al usuario sin forma de volver: se abren en /visor, con barra para volver.
 */
function keepInApp(e: MouseEvent): void {
  const a = (e.target as Element | null)?.closest?.('a')
  if (!a || !a.href) return
  const target = (a.getAttribute('target') ?? '').toLowerCase()
  const escapes = target === '_blank' || target === '_top' || target === '_parent' || a.hasAttribute('download')
  let url: URL
  try {
    url = new URL(a.href)
  } catch {
    return
  }
  if (url.origin !== window.location.origin) {
    // Enlace externo: sin Internet no lleva a ningún sitio y fuera de la app no hay vuelta atrás.
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (!escapes && !isDocumentLink(url.pathname)) return // navegación normal dentro del lector
  const v = viewerUrl(a.href, linkTitle(a), window.location.origin)
  e.preventDefault()
  e.stopPropagation()
  if (v) void router.push(v)
}

/** Ruta del artículo abierto ahora (el visor la refleja en su #hash); para Favorito y para volver a él. */
const current = ref<string | null>(null)
watch(src, (s) => (current.value = s), { immediate: true })
/** Lo primero que se abrió: si se sigue en él, «Biblioteca» puede ser «Atrás» (no hay historial del iframe). */
const opened = src.value
watch(current, (c) => {
  if (c && c !== route.query.u) void router.replace({ query: { ...route.query, u: c } })
})

/**
 * Posición de lectura de cada artículo. Al volver al lector (desde un PDF enlazado, una ficha o «Atrás») se abre
 * el artículo donde se dejó: el que figura en la URL se lleva a su última posición en cuanto carga.
 */
let restorePending = src.value
function trackArticle(path: string | null, win: Window | null | undefined): void {
  if (!path || !win) return
  let raf = 0
  win.addEventListener(
    'scroll',
    () => {
      if (raf) return
      raf = win.requestAnimationFrame(() => {
        raf = 0
        rememberReaderPosition(path, win.scrollY)
      })
    },
    { passive: true },
  )
  if (restorePending === path) {
    restorePending = null
    restoreWindowScroll(win, readerPosition(path))
  }
}

function toLibrary(): void {
  // Tras seguir enlaces dentro del artículo, «Atrás» recorrería el historial del iframe: se abre la biblioteca
  // (viva: sigue como estaba). Si no, es «Atrás» de verdad (búsqueda o pestaña de donde se vino).
  if (current.value === opened) backTo('/biblioteca')
  else void router.push('/biblioteca')
}

/** Título y ruta del artículo mostrado en el iframe interno del visor de Kiwix. */
function syncArticle(inner: Document | null | undefined): void {
  try {
    if (inner?.title) title.value = inner.title
    const hash = frame.value?.contentWindow?.location.hash ?? ''
    const href = `/kiwix/viewer${hash}`
    if (hash.length > 1 && isSafeReaderPath(href)) current.value = href
  } catch {
    // Mismo origen siempre; si falla, se conserva lo anterior.
  }
}

function onLoad(): void {
  try {
    const doc = frame.value?.contentDocument
    injectTouch(doc)
    if (doc?.title) title.value = doc.title
    // Documento suelto (sin el visor de Kiwix): su propia dirección es el artículo.
    const loc = frame.value?.contentWindow?.location
    if (doc && loc && !doc.getElementById('content_iframe')) {
      const href = `${loc.pathname}${loc.search}${loc.hash}`
      if (isSafeReaderPath(href)) current.value = href
      trackArticle(current.value, frame.value?.contentWindow)
    }
  } catch {
    // Mismo origen siempre; si falla, se conserva el título genérico.
  }
}

onMounted(() => {
  if (!publicView) void loadFavorites()
})
</script>

<template>
  <div class="reader">
    <header class="bar">
      <button type="button" class="btn" @click="toLibrary">
        <ArrowLeft :size="20" aria-hidden="true" />
        {{ t('module.library') }}
      </button>
      <span class="title">{{ title }}</span>
      <FavoriteButton v-if="current && !publicView" :fav-id="`zim:${current}`" :title="title" :href="current" />
      <button type="button" class="btn" :aria-pressed="night" @click="night = !night">
        <component :is="night ? Sun : Moon" :size="20" aria-hidden="true" />
        {{ night ? t('lib.reader.day') : t('lib.reader.night') }}
      </button>
    </header>
    <!-- Red de seguridad: sin allow-top-navigation ni allow-popups, nada del ZIM puede sacar al usuario de la app. -->
    <iframe
      v-if="src" ref="frame" :src="src" :class="{ night }" :title="t('lib.reader')"
      sandbox="allow-scripts allow-same-origin allow-forms" @load="onLoad"
    />
    <div v-else class="notice tone-danger">{{ t('lib.reader.invalid') }}</div>
  </div>
</template>

<style scoped>
.reader {
  height: 100%;
  display: grid;
  /* Columna con mínimo 0: un título largo sin espacios nunca ensancha la cabecera ni el iframe del artículo. */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.bar {
  min-height: 60px;
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.bar .btn {
  flex: none;
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

iframe {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  background: #fff;
}

/* Modo noche: lo aplica cada documento del lector (ver TOUCH_CSS); aquí solo el fondo mientras carga. */
iframe.night {
  background: #1a1a1a;
}
</style>
