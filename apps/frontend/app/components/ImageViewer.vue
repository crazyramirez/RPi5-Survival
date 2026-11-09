<script setup lang="ts">
import { Maximize, Minus, Plus, X } from '@lucide/vue'

/**
 * Visor de imagen a pantalla completa con zoom táctil (bóveda). Sin dependencias:
 *  - pellizco con dos dedos (zoom centrado en el gesto), arrastre con un dedo si hay zoom;
 *  - doble toque: 1× ↔ 2,5× en el punto tocado; rueda del ratón (VNC); botones − + ajustar; Esc cierra.
 * Solo transform (translate + scale) en un elemento: barato para la GPU de la Pi.
 */
const props = defineProps<{ src: string; name: string }>()
const emit = defineEmits<{ close: [] }>()
const t = useT()

const MIN = 1
const MAX = 8
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const stage = ref<HTMLDivElement | null>(null)
const img = ref<HTMLImageElement | null>(null)

const pointers = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; scale: number; cx: number; cy: number; tx: number; ty: number } | null = null
let pan: { x: number; y: number; tx: number; ty: number } | null = null
let lastTap = { time: 0, x: 0, y: 0 }

/** Centro del escenario: el origen del transform está en el centro de la imagen. */
function stageCenter(): { x: number; y: number } {
  const r = stage.value?.getBoundingClientRect()
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 }
}

/** Limita el desplazamiento para que la imagen nunca se pierda fuera de la pantalla. */
function clampPan(): void {
  const s = stage.value?.getBoundingClientRect()
  const i = img.value
  if (!s || !i) return
  const w = i.clientWidth * scale.value
  const h = i.clientHeight * scale.value
  const maxX = Math.max(0, (w - s.width) / 2)
  const maxY = Math.max(0, (h - s.height) / 2)
  tx.value = Math.min(maxX, Math.max(-maxX, tx.value))
  ty.value = Math.min(maxY, Math.max(-maxY, ty.value))
}

/** Zoom manteniendo fijo el punto de pantalla (px, py). */
function zoomAt(next: number, px: number, py: number): void {
  const s = Math.min(MAX, Math.max(MIN, next))
  const c = stageCenter()
  const k = s / scale.value
  tx.value = (px - c.x) - k * (px - c.x - tx.value)
  ty.value = (py - c.y) - k * (py - c.y - ty.value)
  scale.value = s
  if (s === MIN) {
    tx.value = 0
    ty.value = 0
  }
  clampPan()
}

function zoomBy(f: number): void {
  const c = stageCenter()
  zoomAt(scale.value * f, c.x, c.y)
}

function reset(): void {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function onDown(e: PointerEvent): void {
  stage.value?.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: scale.value, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2, tx: tx.value, ty: ty.value }
    pan = null
  } else if (pointers.size === 1) {
    pan = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
  }
}

function onMove(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
    // Escala desde el estado inicial del gesto, anclada al punto medio de los dedos.
    scale.value = pinch.scale
    tx.value = pinch.tx
    ty.value = pinch.ty
    zoomAt(pinch.scale * (dist / pinch.dist), pinch.cx, pinch.cy)
    // Arrastre simultáneo del punto medio.
    tx.value += (a!.x + b!.x) / 2 - pinch.cx
    ty.value += (a!.y + b!.y) / 2 - pinch.cy
    clampPan()
  } else if (pan && scale.value > 1) {
    tx.value = pan.tx + (e.clientX - pan.x)
    ty.value = pan.ty + (e.clientY - pan.y)
    clampPan()
  }
}

function onUp(e: PointerEvent): void {
  const start = pan
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 1) {
    const [p] = [...pointers.values()]
    pan = { x: p!.x, y: p!.y, tx: tx.value, ty: ty.value }
    return
  }
  pan = null
  // Doble toque (dos toques cortos y cercanos): alterna ajustado ↔ 2,5× en ese punto.
  const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 0
  if (moved > 12) return
  const now = performance.now()
  if (now - lastTap.time < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
    if (scale.value > 1) reset()
    else zoomAt(2.5, e.clientX, e.clientY)
    lastTap = { time: 0, x: 0, y: 0 }
  } else {
    lastTap = { time: now, x: e.clientX, y: e.clientY }
  }
}

function onWheel(e: WheelEvent): void {
  zoomAt(scale.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
  else if (e.key === '+' || e.key === '=') zoomBy(1.4)
  else if (e.key === '-') zoomBy(1 / 1.4)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
watch(() => props.src, reset)
</script>

<template>
  <div class="viewer" role="dialog" aria-modal="true" :aria-label="name">
    <header class="bar">
      <strong class="name">{{ name }}</strong>
      <span class="zoom mono">{{ Math.round(scale * 100) }} %</span>
      <button type="button" class="vbtn" :aria-label="t('ui.viewer.zoomOut')" :disabled="scale <= 1" @click="zoomBy(1 / 1.4)"><Minus :size="22" /></button>
      <button type="button" class="vbtn" :aria-label="t('ui.viewer.zoomIn')" :disabled="scale >= 8" @click="zoomBy(1.4)"><Plus :size="22" /></button>
      <button type="button" class="vbtn" :aria-label="t('ui.viewer.fit')" :disabled="scale === 1" @click="reset"><Maximize :size="20" /></button>
      <button type="button" class="vbtn close" :aria-label="t('display.close')" @click="emit('close')"><X :size="24" /></button>
    </header>
    <div
      ref="stage"
      class="stage"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel.prevent="onWheel"
    >
      <img
        ref="img"
        :src="src"
        :alt="name"
        draggable="false"
        :style="{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }"
      />
    </div>
    <p v-if="scale === 1" class="hint">{{ t('ui.viewer.hint') }}</p>
  </div>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  flex-direction: column;
  background: #000;
  animation: fade-in 0.14s ease-out;
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.9rem;
  background: rgb(20 24 22 / 92%);
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #eee;
}

.zoom {
  min-width: 3.6rem;
  text-align: right;
  color: #aaa;
  font-size: 0.85rem;
}

.vbtn {
  display: grid;
  place-items: center;
  width: var(--touch);
  height: var(--touch);
  border-radius: var(--radius);
  border: 1px solid rgb(255 255 255 / 15%);
  background: rgb(255 255 255 / 6%);
  color: #eee;
  cursor: pointer;
}

.vbtn:disabled {
  opacity: 0.35;
}

.vbtn.close {
  margin-left: 0.3rem;
  background: rgb(255 255 255 / 12%);
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  /* Los gestos los gestiona el visor (pellizco/arrastre), no el navegador. */
  touch-action: none;
  user-select: none;
}

.stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  -webkit-user-drag: none;
}

.hint {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  background: rgb(20 24 22 / 85%);
  color: #ccc;
  font-size: 0.82rem;
  pointer-events: none;
}
</style>
