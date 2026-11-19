<script setup lang="ts">
import { ChevronDown, ChevronUp, FileWarning, LoaderCircle, Lock, Minus, Moon, MoveHorizontal, Plus, Sun } from '@lucide/vue'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

/**
 * Visor de PDF propio (pdf.js servido por el equipo, sin CDN). Sustituye al del navegador, que es una
 * extensión interna sin los estilos de la app: aquí las páginas se pintan en un contenedor de la app (barra de
 * desplazamiento del tema, modo noche, controles táctiles grandes). Solo se dibujan las páginas cercanas a la
 * vista y se liberan las lejanas: los manuales tienen cientos de páginas y la Pi no debe llenar la memoria.
 */
const props = defineProps<{ src: string }>()
const t = useT()
const night = useState<boolean>('pdf:night', () => false)

const PAD = 16
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4]
/** Tope de píxeles por lienzo (con zoom alto una página llegaría a cientos de MB). */
const MAX_CANVAS_PX = 16e6

const scroller = ref<HTMLElement | null>(null)
const sheet = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'error' | 'locked'>('loading')
const progress = ref<number | null>(null)
const current = ref(1)
const zoom = ref(1)
const avail = ref(800)
const sizes = shallowRef<{ w: number; h: number }[]>([])

const numPages = computed(() => sizes.value.length)
/** «Ajustar» = todo el ancho de la vista, sin tope (el lienzo ya se limita con MAX_CANVAS_PX). */
const fitScale = computed(() => Math.max(1, avail.value - PAD * 2) / (sizes.value[0]?.w ?? 612))
const scale = computed(() => Math.max(0.1, fitScale.value * zoom.value))
/** Porcentaje como en cualquier visor: 100 % = tamaño real (1 pt = 96/72 px). */
const zoomPct = computed(() => Math.round(scale.value * 75))

let pdf: PDFDocumentProxy | null = null
let loading: PDFDocumentLoadingTask | null = null
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
const pages = new Map<number, Promise<PDFPageProxy>>()
const drawn = new Map<number, { scale: number; task: RenderTask | null }>()
const visible = new Set<number>()

function holder(n: number): HTMLElement | null {
  return sheet.value?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null
}

function getPage(n: number): Promise<PDFPageProxy> {
  let p = pages.get(n)
  if (!p && pdf) {
    p = pdf.getPage(n)
    pages.set(n, p)
  }
  return p ?? Promise.reject(new Error('sin documento'))
}

async function draw(n: number): Promise<void> {
  const s = scale.value
  const prev = drawn.get(n)
  if (!pdf || (prev && prev.scale === s)) return
  prev?.task?.cancel()
  const entry: { scale: number; task: RenderTask | null } = { scale: s, task: null }
  drawn.set(n, entry)
  try {
    const page = await getPage(n)
    if (drawn.get(n) !== entry) return
    const base = page.getViewport({ scale: 1 })
    const known = sizes.value[n - 1]
    if (known && (Math.abs(known.w - base.width) > 0.5 || Math.abs(known.h - base.height) > 0.5)) {
      const next = sizes.value.slice()
      next[n - 1] = { w: base.width, h: base.height }
      sizes.value = next
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssArea = base.width * s * base.height * s
    const out = Math.min(dpr, Math.sqrt(MAX_CANVAS_PX / Math.max(cssArea, 1)))
    const viewport = page.getViewport({ scale: s * out })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    entry.task = page.render({ canvas, viewport })
    await entry.task.promise
    const el = holder(n)
    if (drawn.get(n) !== entry || !el) return
    // Se cambia el lienzo al terminar: mientras, el anterior (estirado) evita parpadeos al hacer zoom.
    el.querySelector('canvas')?.remove()
    el.appendChild(canvas)
    entry.task = null
  } catch {
    // Cancelado (otra escala, página fuera de vista) o página dañada: se reintentará al volver a verse.
    if (drawn.get(n) === entry) drawn.delete(n)
  }
}

function release(n: number): void {
  drawn.get(n)?.task?.cancel()
  drawn.delete(n)
  holder(n)?.querySelector('canvas')?.remove()
}

function observe(): void {
  observer?.disconnect()
  const root = scroller.value
  if (!root || !sheet.value) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = Number((e.target as HTMLElement).dataset.page)
        if (e.isIntersecting) visible.add(n)
        else {
          visible.delete(n)
          release(n)
        }
      }
      for (const n of visible) void draw(n)
    },
    // Una pantalla por arriba y por abajo: al desplazarse, la página siguiente ya está dibujada.
    { root, rootMargin: '100% 0px' },
  )
  for (const el of Array.from(sheet.value.children)) observer.observe(el)
}

watch(scale, () => {
  for (const n of visible) void draw(n)
})

function cleanup(): void {
  observer?.disconnect()
  observer = null
  for (const n of drawn.keys()) drawn.get(n)?.task?.cancel()
  drawn.clear()
  visible.clear()
  pages.clear()
  void loading?.destroy()
  loading = null
  pdf = null
}

async function load(): Promise<void> {
  cleanup()
  status.value = 'loading'
  progress.value = null
  sizes.value = []
  current.value = 1
  zoom.value = 1
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
    const task = pdfjs.getDocument({
      url: props.src,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
      enableXfa: false,
    })
    loading = task
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      progress.value = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : null
    }
    const doc = await task.promise
    if (loading !== task) return
    pdf = doc
    const first = (await getPage(1)).getViewport({ scale: 1 })
    sizes.value = Array.from({ length: doc.numPages }, () => ({ w: first.width, h: first.height }))
    status.value = 'ready'
    await nextTick()
    observe()
  } catch (e) {
    status.value = (e as { name?: string })?.name === 'PasswordException' ? 'locked' : 'error'
  }
}

/** Página en la parte alta de la vista (la que se está leyendo). */
function onScroll(): void {
  const root = scroller.value
  const kids = sheet.value?.children
  if (!root || !kids?.length) return
  const line = root.scrollTop + root.clientHeight * 0.3
  let lo = 0
  let hi = kids.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((kids[mid] as HTMLElement).offsetTop <= line) lo = mid
    else hi = mid - 1
  }
  current.value = lo + 1
}

function goTo(n: number): void {
  const el = holder(Math.min(Math.max(1, n), numPages.value))
  scroller.value?.scrollTo({ top: (el?.offsetTop ?? 0) - PAD, behavior: 'smooth' })
}

/** Cambia el zoom manteniendo fijo el punto `anchor` (coordenadas de la vista). */
function setZoom(z: number, anchor?: { x: number; y: number }): void {
  const root = scroller.value
  const next = Math.min(Math.max(z, ZOOMS[0]!), ZOOMS[ZOOMS.length - 1]!)
  if (!root || Math.abs(next - zoom.value) < 0.001) return
  const ax = anchor?.x ?? root.clientWidth / 2
  const ay = anchor?.y ?? root.clientHeight / 3
  const cx = root.scrollLeft + ax
  const cy = root.scrollTop + ay
  const ratio = next / zoom.value
  zoom.value = next
  void nextTick(() => {
    root.scrollLeft = cx * ratio - ax
    root.scrollTop = cy * ratio - ay
    onScroll()
  })
}

function step(dir: 1 | -1): void {
  const z = zoom.value
  const target = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01)
  if (target) setZoom(target)
}

// Ctrl + rueda (portátil) y pellizco con dos dedos (pantalla táctil).
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey || !scroller.value) return
  e.preventDefault()
  const r = scroller.value.getBoundingClientRect()
  setZoom(zoom.value * Math.exp(-e.deltaY / 400), { x: e.clientX - r.left, y: e.clientY - r.top })
}

let pinch: { d0: number; x: number; y: number; ratio: number } | null = null
const dist = (ts: TouchList): number => Math.hypot(ts[0]!.clientX - ts[1]!.clientX, ts[0]!.clientY - ts[1]!.clientY)

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length !== 2 || !scroller.value) return
  const r = scroller.value.getBoundingClientRect()
  pinch = {
    d0: dist(e.touches),
    x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - r.left,
    y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - r.top,
    ratio: 1,
  }
}

function onTouchMove(e: TouchEvent): void {
  if (!pinch || e.touches.length !== 2 || !sheet.value || !scroller.value) return
  e.preventDefault()
  pinch.ratio = Math.min(Math.max(dist(e.touches) / pinch.d0, ZOOMS[0]! / zoom.value), ZOOMS[ZOOMS.length - 1]! / zoom.value)
  // Vista previa inmediata con transform; al soltar se vuelve a dibujar nítido a la nueva escala.
  sheet.value.style.transformOrigin = `${scroller.value.scrollLeft + pinch.x}px ${scroller.value.scrollTop + pinch.y}px`
  sheet.value.style.transform = `scale(${pinch.ratio})`
}

function onTouchEnd(): void {
  if (!pinch || !sheet.value) return
  const p = pinch
  pinch = null
  sheet.value.style.transform = ''
  sheet.value.style.transformOrigin = ''
  setZoom(zoom.value * p.ratio, { x: p.x, y: p.y })
}

onMounted(() => {
  const root = scroller.value
  if (root) {
    avail.value = root.clientWidth
    resizeObserver = new ResizeObserver(() => {
      avail.value = root.clientWidth
    })
    resizeObserver.observe(root)
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
  }
  void load()
})
watch(() => props.src, () => void load())
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  scroller.value?.removeEventListener('wheel', onWheel)
  scroller.value?.removeEventListener('touchmove', onTouchMove)
  cleanup()
})
</script>

<template>
  <div class="pdf" :class="{ night }">
    <div ref="scroller" class="scroller" @scroll.passive="onScroll" @touchstart.passive="onTouchStart" @touchend="onTouchEnd" @touchcancel="onTouchEnd">
      <div v-if="status === 'ready'" ref="sheet" class="sheet">
        <div
          v-for="(s, i) in sizes" :key="i" class="pg" :data-page="i + 1"
          :style="{ width: `${Math.round(s.w * scale)}px`, height: `${Math.round(s.h * scale)}px` }"
        />
      </div>
    </div>

    <div v-if="status === 'loading'" class="center" role="status">
      <LoaderCircle :size="34" class="spin" aria-hidden="true" />
      <span>{{ progress === null ? t('viewer.pdf.loading') : t('viewer.pdf.loadingPct', { pct: progress }) }}</span>
    </div>
    <EmptyState v-else-if="status === 'locked'" :icon="Lock" :title="t('viewer.pdf.locked')" class="center" />
    <EmptyState v-else-if="status === 'error'" :icon="FileWarning" :title="t('viewer.pdf.error')" :text="t('viewer.pdf.errorText')" class="center" />

    <div v-if="status === 'ready'" class="tools" role="toolbar" :aria-label="t('viewer.pdf.toolbar')">
      <button type="button" class="tool" :disabled="current <= 1" :aria-label="t('viewer.pdf.prev')" @click="goTo(current - 1)">
        <ChevronUp :size="20" aria-hidden="true" />
      </button>
      <span class="pages" :aria-label="t('viewer.pdf.page', { n: current, total: numPages })">{{ current }}<small>/ {{ numPages }}</small></span>
      <button type="button" class="tool" :disabled="current >= numPages" :aria-label="t('viewer.pdf.next')" @click="goTo(current + 1)">
        <ChevronDown :size="20" aria-hidden="true" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool" :disabled="zoom <= ZOOMS[0]!" :aria-label="t('viewer.pdf.zoomOut')" @click="step(-1)">
        <Minus :size="20" aria-hidden="true" />
      </button>
      <span class="pct" :aria-label="t('viewer.pdf.zoom', { pct: zoomPct })">{{ zoomPct }} %</span>
      <button type="button" class="tool" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!" :aria-label="t('viewer.pdf.zoomIn')" @click="step(1)">
        <Plus :size="20" aria-hidden="true" />
      </button>
      <button type="button" class="tool" :aria-pressed="zoom === 1" :aria-label="t('viewer.pdf.fit')" @click="setZoom(1)">
        <MoveHorizontal :size="20" aria-hidden="true" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool" :aria-pressed="night" :aria-label="night ? t('viewer.pdf.day') : t('viewer.pdf.night')" @click="night = !night">
        <component :is="night ? Sun : Moon" :size="20" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.pdf {
  position: relative;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.scroller {
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  /* El pellizco lo gestiona el visor (zoom nítido de la página, no de toda la app). */
  touch-action: pan-x pan-y;
}

.sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: fit-content;
  min-width: 100%;
  /* Abajo, hueco para que la barra flotante no tape el final del documento. */
  padding: 16px 16px 6rem;
  will-change: transform;
}

.pg {
  position: relative;
  flex: none;
  background: #fff;
  border-radius: 3px;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.35),
    0 6px 22px rgb(0 0 0 / 0.28);
  overflow: hidden;
}

.pg :deep(canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.night .pg {
  background: #1a1a1a;
}

/* Modo noche: papel oscuro y tinta clara (como el lector de la biblioteca). */
.night .pg :deep(canvas) {
  filter: invert(0.9) hue-rotate(180deg);
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.spin {
  color: var(--accent);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tools {
  position: absolute;
  left: 50%;
  bottom: 0.9rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.15rem;
  max-width: calc(100% - 1.5rem);
  padding: 0.3rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.45);
  animation: fade-in 0.2s ease-out;
}

.tool {
  display: inline-grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  cursor: var(--cursor-point);
  transition:
    background-color 0.15s,
    transform 0.1s;
}

.tool:active:not(:disabled) {
  background: var(--surface-3);
  transform: scale(0.94);
}

.tool:disabled {
  opacity: 0.35;
  cursor: var(--cursor);
}

.tool[aria-pressed='true'] {
  color: var(--accent);
}

@media (hover: hover) {
  .tool:hover:not(:disabled) {
    background: var(--surface-3);
  }
}

.pages,
.pct {
  min-width: 3.6rem;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.9rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pages small {
  margin-left: 0.2rem;
  color: var(--text-faint);
  font-size: 0.8rem;
}

.sep {
  width: 1px;
  height: 1.6rem;
  margin: 0 0.25rem;
  background: var(--border);
}

/* Pantallas estrechas (móvil del punto de acceso): controles más juntos para que quepan en una línea. */
@media (max-width: 30rem) {
  .tools {
    gap: 0;
  }

  .pages,
  .pct {
    min-width: 2.8rem;
    font-size: 0.8rem;
  }

  .sep {
    margin: 0 0.1rem;
  }
}
</style>
