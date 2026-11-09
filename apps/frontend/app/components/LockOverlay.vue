<script setup lang="ts">
import { Lock } from '@lucide/vue'
import { formatClock, formatDate } from '~/utils/format'

const HOLD_MS = 1500

const t = useT()
const now = useNow()
const { unlock } = useScreenLock()

const progress = ref(0)
let startedAt = 0
let frame = 0

function tick(): void {
  progress.value = Math.min(1, (performance.now() - startedAt) / HOLD_MS)
  if (progress.value >= 1) {
    cancel()
    unlock()
    return
  }
  frame = requestAnimationFrame(tick)
}

function start(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  startedAt = performance.now()
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(tick)
}

function cancel(): void {
  cancelAnimationFrame(frame)
  progress.value = 0
}

onBeforeUnmount(cancel)

// Bloquear la pantalla también cierra la bóveda si estaba abierta (defensa ante descuidos).
onMounted(() => {
  void postAction('/api/vault/lock').catch(() => undefined)
})
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" :aria-label="t('lock.title')" @pointerdown.self.prevent>
    <p class="time mono">{{ formatClock(now) }}</p>
    <p class="date">{{ formatDate(now) }}</p>

    <button
      type="button"
      class="hold"
      :style="{ '--p': progress }"
      @pointerdown.prevent="start"
      @pointerup="cancel"
      @pointercancel="cancel"
      @pointerleave="cancel"
      @keydown.enter.prevent="unlock"
    >
      <Lock :size="30" aria-hidden="true" />
      <span>{{ t('lock.hold') }}</span>
    </button>
    <p class="note">{{ t('lock.note') }}</p>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  /* Halo estático del acento tras el reloj. */
  background:
    radial-gradient(60% 55% at 50% 38%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%),
    var(--bg);
  touch-action: none;
  animation: fade-in 0.2s ease-out;
}

.time {
  font-size: 5.5rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.04em;
}

.date {
  color: var(--text-muted);
  font-size: 1.25rem;
  margin-bottom: 1.5rem;
}

.hold {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 5rem;
  padding: 0 2rem;
  border-radius: 999px;
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text);
  font-size: 1.15rem;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 45%, transparent) calc(var(--p) * 100%),
    var(--surface-2) calc(var(--p) * 100%)
  );
}

.note {
  margin-top: 0.5rem;
  color: var(--text-faint);
  font-size: 0.875rem;
}
</style>
