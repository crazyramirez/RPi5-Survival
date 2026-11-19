<script setup lang="ts">
import { Lock, LockOpen } from '@lucide/vue'
import { formatClock, formatDate } from '~/utils/format'

const HOLD_MS = 1500

/**
 * Fondos de la pantalla de bloqueo (public/backgrounds, generados para Survivelia OS y servidos desde el propio
 * equipo: nada externo). Uno distinto cada día; en alto contraste, fondo negro liso.
 */
const BACKGROUNDS = ['/backgrounds/lock-mountains.webp', '/backgrounds/lock-forest.webp', '/backgrounds/lock-coast.webp']

const t = useT()
const now = useNow()
const { unlock } = useScreenLock()

const background = computed(() => {
  const d = now.value
  const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000)
  return BACKGROUNDS[day % BACKGROUNDS.length]!
})

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
    <img class="bg" :src="background" alt="" aria-hidden="true" decoding="async" draggable="false" />
    <div class="shade" aria-hidden="true" />

    <header class="brand">
      <img src="/icon-192.png" alt="" class="logo" width="36" height="36" />
      <span>{{ t('app.name') }}</span>
    </header>

    <main class="center">
      <p class="time">{{ formatClock(now) }}</p>
      <p class="date">{{ formatDate(now) }}</p>
    </main>

    <footer class="bottom">
      <button
        type="button"
        class="hold"
        :class="{ active: progress > 0 }"
        :style="{ '--p': progress }"
        @pointerdown.prevent="start"
        @pointerup="cancel"
        @pointercancel="cancel"
        @pointerleave="cancel"
        @keydown.enter.prevent="unlock"
      >
        <span class="fill" aria-hidden="true" />
        <span class="knob" aria-hidden="true">
          <LockOpen v-if="progress > 0.6" :size="24" />
          <Lock v-else :size="24" />
        </span>
        <span class="label">{{ t('lock.hold') }}</span>
      </button>
      <p class="note">{{ t('lock.note') }}</p>
    </footer>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  grid-template-rows: auto 1fr auto;
  justify-items: center;
  padding: clamp(1rem, 3vh, 2rem) clamp(1rem, 4vw, 3rem) clamp(1.25rem, 5vh, 3rem);
  overflow: hidden;
  background: #070a09;
  color: #f3efe4;
  touch-action: none;
  animation: fade-in 0.35s ease-out;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  animation: settle 1.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Legibilidad: oscurece arriba (marca) y abajo (botón); el centro deja ver la foto. */
.shade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(70% 55% at 50% 42%, rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.45) 100%),
    linear-gradient(180deg, rgb(5 8 7 / 0.55) 0%, transparent 22%, transparent 58%, rgb(5 8 7 / 0.82) 100%);
}

.brand,
.center,
.bottom {
  position: relative;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  justify-self: start;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(243 239 228 / 0.85);
}

.logo {
  border-radius: 10px;
  box-shadow: 0 4px 18px rgb(0 0 0 / 0.5);
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}

.time {
  margin: 0;
  font-family: var(--font-ui);
  font-size: clamp(4.5rem, 17vh, 9.5rem);
  font-weight: 400;
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 6px 40px rgb(0 0 0 / 0.55);
}

.date {
  margin: 0.6rem 0 0;
  font-size: clamp(1rem, 3.2vh, 1.4rem);
  font-weight: 500;
  letter-spacing: 0.02em;
  color: rgb(243 239 228 / 0.82);
  text-shadow: 0 2px 16px rgb(0 0 0 / 0.6);
}

.bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  width: min(26rem, 100%);
}

/* Botón de cristal: se rellena mientras se mantiene pulsado. */
.hold {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  min-height: 4.5rem;
  padding: 0.45rem 1.4rem 0.45rem 0.45rem;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / 0.18);
  background: rgb(14 20 17 / 0.45);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  backdrop-filter: blur(18px) saturate(1.3);
  box-shadow:
    0 10px 40px rgb(0 0 0 / 0.45),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  color: inherit;
  font-size: 1.05rem;
  font-weight: 700;
  cursor: var(--cursor-point);
  overflow: hidden;
  transition: border-color 0.2s;
}

.hold.active {
  border-color: color-mix(in srgb, var(--accent) 70%, transparent);
}

.fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transform: scaleX(var(--p));
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 55%, transparent));
}

.knob {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 4px 20px color-mix(in srgb, var(--accent) 45%, transparent);
}

.label {
  position: relative;
  flex: 1;
  text-align: center;
}

.note {
  margin: 0;
  font-size: 0.85rem;
  color: rgb(243 239 228 / 0.6);
  text-align: center;
}

.date::first-letter {
  text-transform: uppercase;
}

@keyframes settle {
  from {
    opacity: 0;
    transform: scale(1.06);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .overlay,
  .bg,
  .center {
    animation: none;
  }
}

/* Alto contraste: sin foto, fondo negro y texto blanco puro. */
:root[data-contrast='high'] .bg,
:root[data-contrast='high'] .shade {
  display: none;
}
</style>
