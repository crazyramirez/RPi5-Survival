<script setup lang="ts">
/**
 * Señales: texto → Morse y alfabeto fonético, y la pantalla como luz (linterna fija o Morse repetido).
 * La luz ocupa toda la pantalla y se apaga con un toque; mientras tanto se pide que la pantalla no se apague.
 */
import { Flashlight, Radio, Siren } from '@lucide/vue'
import { morseTimeline, spell, toMorse } from '~/utils/fieldtools'

const t = useT()
const text = ref('SOS')
const morse = computed(() => toMorse(text.value))
const nato = computed(() => spell(text.value).slice(0, 40))

/** Unidad Morse para señales luminosas: 300 ms (≈ 4 palabras/min), legible a distancia. */
const UNIT_MS = 300
const light = ref<null | 'torch' | 'morse'>(null)
const on = ref(true)
const sending = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let wake: { release: () => Promise<void> } | null = null

async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    wake = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    wake = null // sin Wake Lock: la pantalla puede apagarse según los ajustes del equipo
  }
}

function play(code: string): void {
  const steps = morseTimeline(code, UNIT_MS)
  if (!steps.length) return
  let i = 0
  const tick = (): void => {
    const [onMs, offMs] = steps[i % steps.length]!
    on.value = true
    timer = setTimeout(() => {
      on.value = false
      timer = setTimeout(() => {
        i++
        tick()
      }, offMs)
    }, onMs)
  }
  tick()
}

function start(mode: 'torch' | 'sos' | 'message'): void {
  stop()
  void keepAwake()
  if (mode === 'torch') {
    light.value = 'torch'
    on.value = true
    return
  }
  const code = mode === 'sos' ? toMorse('SOS') : morse.value
  if (!code) return
  sending.value = mode === 'sos' ? 'SOS' : text.value.trim().toUpperCase()
  light.value = 'morse'
  play(code)
}

function stop(): void {
  clearTimeout(timer)
  light.value = null
  void wake?.release().catch(() => {})
  wake = null
}

function onKey(e: KeyboardEvent): void {
  if (light.value && e.key === 'Escape') stop()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stop()
})
</script>

<template>
  <AppCard :title="t('field.signals.title')" :icon="Radio" tone="warn">
    <input v-model="text" class="ui-field selectable msg" maxlength="60" :aria-label="t('field.signals.text')" :placeholder="t('field.signals.text')" />
    <p class="morse mono selectable" :aria-label="t('field.signals.morse')">{{ morse || '—' }}</p>
    <p v-if="nato.length" class="nato">
      <span v-for="(w, i) in nato" :key="i" class="ui-chip">{{ w }}</span>
    </p>
    <div class="actions">
      <button type="button" class="btn btn-danger" @click="start('sos')"><Siren :size="18" aria-hidden="true" />{{ t('field.signals.sos') }}</button>
      <button type="button" class="btn" :disabled="!morse" @click="start('message')"><Radio :size="18" aria-hidden="true" />{{ t('field.signals.send') }}</button>
      <button type="button" class="btn" @click="start('torch')"><Flashlight :size="18" aria-hidden="true" />{{ t('field.signals.torch') }}</button>
    </div>
    <p class="note">{{ t('field.signals.note') }}</p>

    <Teleport to="body">
      <button v-if="light" type="button" class="light" :class="{ on: light === 'torch' || on }" :aria-label="t('field.signals.stop')" @click="stop">
        <span class="light-cap">{{ light === 'torch' ? t('field.signals.torchOn') : t('field.signals.sending', { msg: sending }) }} · {{ t('field.signals.tapToStop') }}</span>
      </button>
    </Teleport>
  </AppCard>
</template>

<style scoped>
.msg {
  width: 100%;
  min-height: 3rem;
  font-size: 1.1rem;
}

.morse {
  min-height: 2.6rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-sm);
  background: var(--bg);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  word-break: break-word;
}

.nato {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.actions .btn {
  flex: 1 1 8rem;
}

.note {
  font-size: 0.78rem;
  color: var(--text-faint);
}

/* Luz a pantalla completa: por encima de todo (barra de estado y de acciones incluidas). */
.light {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 1.2rem;
  border: none;
  background: #000;
  cursor: var(--cursor-point);
}

.light.on {
  background: #fff;
}

.light-cap {
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  background: rgb(0 0 0 / 70%);
  color: #fff;
  font: 700 0.9rem/1.2 var(--font-ui);
}
</style>
