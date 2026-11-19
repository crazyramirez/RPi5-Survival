<script setup lang="ts">
import { Minimize2 } from '@lucide/vue'

/**
 * Salida del modo lectura: botón flotante arriba a la derecha que se atenúa a los 3 s sin actividad (no tapa la
 * lectura) y vuelve al tocar o mover el ratón. Escape también sale.
 */
const t = useT()
const { exit } = useReadingMode()
const awake = ref(true)
let timer: ReturnType<typeof setTimeout> | undefined

function wake(): void {
  awake.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (awake.value = false), 3000)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') void exit()
  else wake()
}
const EVENTS = ['pointerdown', 'pointermove', 'wheel', 'touchstart'] as const
onMounted(() => {
  wake()
  for (const ev of EVENTS) window.addEventListener(ev, wake, { passive: true, capture: true })
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  for (const ev of EVENTS) window.removeEventListener(ev, wake, { capture: true })
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <button type="button" class="exit" :class="{ awake }" :aria-label="t('reading.exit')" :title="t('reading.exit')" @click="exit">
    <Minimize2 :size="20" aria-hidden="true" />
    <span class="lbl">{{ t('reading.exit') }}</span>
  </button>
</template>

<style scoped>
.exit {
  position: fixed;
  top: max(0.6rem, env(safe-area-inset-top));
  right: max(0.6rem, env(safe-area-inset-right));
  z-index: 70;
  display: inline-flex;
  align-items: center;
  gap: 0;
  min-width: var(--touch);
  min-height: var(--touch);
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
  color: var(--text);
  font: inherit;
  font-weight: 700;
  font-size: 0.88rem;
  cursor: var(--cursor-point);
  opacity: 0.28;
  transition: opacity 0.3s ease, gap 0.2s ease;
  animation: pop-in 0.18s ease-out;
}

.exit svg {
  flex: none;
  color: var(--accent);
}

/* Etiqueta solo mientras está «despierto»: después queda un círculo pequeño y translúcido. */
.lbl {
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width 0.25s ease;
}

.exit.awake {
  opacity: 1;
  gap: 0.45rem;
}

.exit.awake .lbl {
  max-width: 16rem;
}

.exit:active {
  transform: scale(0.96);
}
</style>
