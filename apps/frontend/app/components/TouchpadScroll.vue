<script setup lang="ts">
import { ArrowDown, ArrowUp, Touchpad } from '@lucide/vue'
import type { TouchpadSettings } from '@survival-os/shared-types'

/**
 * Dirección del desplazamiento del trackpad (quiosco de la Pi: labwc + libinput). Lo aplica el agente del quiosco
 * (scripts/kiosk-input.py) y el estado mostrado es el que publica tras leer rc.xml: nunca el pedido sin confirmar.
 */
type Mode = 'natural' | 'traditional'
const t = useT()
const state = ref<Mode | null>(null)
const pending = ref<Mode | null>(null)
const error = ref<string | null>(null)

const read = async (): Promise<Mode | null> =>
  (await $fetch<TouchpadSettings>('/api/system/touchpad', { timeout: 5000, retry: 0 }).catch(() => null))?.touchpadScroll ?? null
onMounted(async () => (state.value = await read()))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function choose(mode: Mode): Promise<void> {
  if (pending.value || mode === state.value) return
  error.value = null
  pending.value = mode
  try {
    await postAction('/api/system/touchpad', { touchpadScroll: mode })
    // El agente lo aplica en menos de un segundo: se confirma con el estado que publica.
    for (let i = 0; i < 12 && state.value !== mode; i++) {
      await sleep(500)
      state.value = await read()
    }
    if (state.value !== mode) error.value = t('ui.touchpad.failed')
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    pending.value = null
  }
}

const shown = computed(() => pending.value ?? state.value)
</script>

<template>
  <div class="tp">
    <div class="head">
      <span class="ic" aria-hidden="true"><Touchpad :size="18" /></span>
      <strong>{{ t('ui.touchpad.title') }}</strong>
    </div>
    <div class="opts" role="radiogroup" :aria-label="t('ui.touchpad.title')">
      <button
        v-for="m in (['natural', 'traditional'] as const)" :key="m" type="button" role="radio" class="opt"
        :aria-checked="shown === m" :disabled="pending !== null" @click="choose(m)"
      >
        <!-- Mini demostración: dedos hacia arriba → el contenido sube (natural) o baja (tradicional). -->
        <span class="demo" :class="m" aria-hidden="true">
          <span class="page"><i /><i /><i /></span>
          <span class="finger"><ArrowUp :size="14" /></span>
          <span class="content"><component :is="m === 'natural' ? ArrowUp : ArrowDown" :size="14" /></span>
        </span>
        <span class="txt">
          <b>{{ t(`ui.touchpad.${m}`) }}</b>
          <small>{{ t(`ui.touchpad.${m}.hint`) }}</small>
        </span>
      </button>
    </div>
    <p v-if="pending" class="note">{{ t('ui.touchpad.applying') }}</p>
    <p v-else-if="error" class="note bad" role="alert">{{ error }}</p>
    <p v-else-if="state === null" class="note">{{ t('ui.touchpad.unknown') }}</p>
  </div>
</template>

<style scoped>
.tp {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--hairline);
}

.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.92rem;
}

.ic {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.opts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.opt {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 3.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
  transition: border-color 0.12s, transform 0.08s ease-out;
}

.opt:active:not(:disabled) {
  transform: scale(0.98);
}

.opt[aria-checked='true'] {
  border-color: var(--accent);
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    linear-gradient(180deg, var(--surface-3), var(--surface-2));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.opt:disabled {
  cursor: var(--cursor);
}

.txt {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.txt b {
  font-size: 0.92rem;
}

.txt small {
  font-size: 0.74rem;
  line-height: 1.3;
  color: var(--text-faint);
}

/* ------------------------------------------------ Mini demostración */
.demo {
  position: relative;
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  overflow: hidden;
}

.page {
  position: absolute;
  inset: 0.35rem 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.page i {
  height: 0.18rem;
  border-radius: 1px;
  background: var(--text-faint);
  opacity: 0.45;
}

.finger,
.content {
  position: absolute;
  bottom: 0.15rem;
  display: grid;
  place-items: center;
  color: var(--text-faint);
}

.finger {
  left: 0.2rem;
}

.content {
  right: 0.2rem;
  color: var(--accent);
}

.opt[aria-checked='true'] .page {
  animation: nat 1.8s ease-in-out infinite;
}

.opt[aria-checked='true'] .demo.traditional .page {
  animation-name: trad;
}

@keyframes nat {
  50% {
    transform: translateY(-0.3rem);
  }
}

@keyframes trad {
  50% {
    transform: translateY(0.3rem);
  }
}

.note {
  font-size: 0.8rem;
  color: var(--text-faint) !important;
}

.note.bad {
  color: var(--danger) !important;
}

@container (max-width: 22rem) {
  .opts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
