<script setup lang="ts">
import { Bluetooth, BluetoothSearching, Check, ChevronRight, CircleAlert, CornerDownLeft, Gamepad2, Keyboard, LoaderCircle, MousePointer2, RefreshCw, Settings, Usb, X } from '@lucide/vue'
import type { BluetoothDevice, BluetoothState } from '@survival-os/shared-types'

/**
 * Hoja guiada para emparejar un teclado (o ratón, o mando) Bluetooth: busca sola al abrirse, lista primero lo que
 * es de entrada, y al elegir enseña en grande la clave que hay que escribir en el teclado, iluminando las cifras a
 * medida que se escriben. Solo presenta: la tarea `bluetooth` la orquesta BluetoothInput.vue.
 */
const props = defineProps<{
  /** list: búsqueda y elección · pair: emparejando el elegido. */
  view: 'list' | 'pair'
  state: BluetoothState | null
  running: boolean
  /** Dispositivo elegido (para nombrarlo mientras empareja). */
  chosen: BluetoothDevice | null
  /** Error de la petición (HTTP), no de BlueZ. */
  requestError: string | null
}>()
const emit = defineEmits<{ pick: [dev: BluetoothDevice]; rescan: []; close: []; cancel: []; retry: [] }>()
const t = useT()
/** Reloj propio de medio segundo (useNow late por minuto) para la cuenta atrás de la búsqueda. */
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 500)
onBeforeUnmount(() => clearInterval(clock))
/** = SCAN_SECONDS de scripts/bt-input.py. */
const SCAN_SECONDS = 40

const KIND_ICON = { keyboard: Keyboard, pointer: MousePointer2, gamepad: Gamepad2, 'other-input': Keyboard, other: Usb } as const
const kindLabel = (d: BluetoothDevice) => t(`ui.bt.kind.${d.kind}`)
const label = (d: BluetoothDevice | null) => d?.name ?? (d ? d.mac : '')

const scanning = computed(() => props.view === 'list' && props.running)
const inputs = computed(() => (props.state?.devices ?? []).filter((d) => d.kind !== 'other'))
const others = computed(() => (props.state?.devices ?? []).filter((d) => d.kind === 'other'))
const showOthers = ref(false)
const secondsLeft = computed(() => {
  const end = props.state?.scanEndsAt
  return end && scanning.value ? Math.max(0, Math.ceil((end - now.value) / 1000)) : null
})
const scanProgress = computed(() => (secondsLeft.value === null ? 1 : 1 - secondsLeft.value / SCAN_SECONDS))

/** Barras de señal 1–4 a partir del RSSI. */
function bars(rssi: number | null): number {
  if (rssi === null) return 0
  return rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : 1
}

const phase = computed(() => props.state?.phase ?? 'starting')
const code = computed(() => props.state?.passkey ?? null)
const entered = computed(() => props.state?.entered ?? 0)
const errorCode = computed(() => (props.state?.phase === 'error' ? (props.state.error ?? 'failed') : null))
const errorText = computed(() => {
  if (props.requestError) return props.requestError
  const c = errorCode.value
  if (!c) return null
  const key = `ui.bt.err.${c}` as Parameters<typeof t>[0]
  const txt = t(key)
  return txt === key ? t('ui.bt.err.failed') : txt
})
const pairDone = computed(() => props.view === 'pair' && phase.value === 'done')
/** La tarea de emparejar terminó sin resultado legible (p. ej. la detuvo el sistema). */
const pairStuck = computed(() => props.view === 'pair' && !props.running && !pairDone.value && !errorText.value && props.state !== null)

/** Portable en Linux sin acceso a BlueZ: queda el camino del sistema (sus ajustes de Bluetooth). */
const portable = usePortable()
const systemFallback = computed(() => portable && (errorCode.value === 'no-dbus' || errorCode.value === 'no-service'))
async function openSystem(): Promise<void> {
  try {
    await postAction('/api/portable/bluetooth-settings')
    emit('close')
  } catch {
    // sin ajustes conocidos: el mensaje de error ya lo explica
  }
}

function onKey(e: KeyboardEvent): void {
  // Con un teclado ya conectado, Escape cierra (salvo mientras se escribe la clave, que va al teclado nuevo).
  if (e.key === 'Escape' && phase.value !== 'passkey' && phase.value !== 'pin') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section class="sheet" role="dialog" aria-modal="true" :aria-label="t('ui.bt.sheetTitle')">
        <header class="top">
          <span class="radar" :class="{ live: scanning || (view === 'pair' && running && !pairDone) }" aria-hidden="true">
            <span class="ring" /><span class="ring r2" />
            <span class="core"><component :is="scanning ? BluetoothSearching : Bluetooth" :size="22" /></span>
          </span>
          <div class="titles">
            <h2>{{ t('ui.bt.sheetTitle') }}</h2>
            <p v-if="view === 'list'" class="sub" aria-live="polite">
              {{ scanning ? (secondsLeft !== null ? t('ui.bt.searchingFor', { s: secondsLeft }) : t('ui.bt.searching')) : `${inputs.length} · ${t('ui.bt.found')}` }}
            </p>
            <p v-else class="sub">{{ label(chosen) }}</p>
          </div>
          <button type="button" class="btn icon close" :aria-label="t('ui.bt.close')" @click="emit('close')"><X :size="20" /></button>
        </header>
        <div v-if="view === 'list'" class="progress" aria-hidden="true">
          <span :style="{ transform: `scaleX(${scanProgress})` }" :class="{ idle: !scanning }" />
        </div>

        <!-- ------------------------------------------------ Búsqueda -->
        <div v-if="view === 'list'" class="body">
          <ol class="steps">
            <li><span class="n">1</span>{{ t('ui.bt.step1') }}</li>
            <li><span class="n">2</span>{{ t('ui.bt.step2') }}</li>
            <li><span class="n">3</span>{{ t('ui.bt.step3') }}</li>
          </ol>

          <p v-if="errorText" class="alert" role="alert"><CircleAlert :size="18" aria-hidden="true" />{{ errorText }}</p>
          <button v-if="systemFallback" type="button" class="btn btn-primary" @click="openSystem">
            <Settings :size="18" /> {{ t('ui.bt.openSystem') }}
          </button>

          <TransitionGroup v-if="inputs.length" tag="ul" name="row" class="devs">
            <li v-for="d in inputs" :key="d.mac">
              <button type="button" class="dev" :class="{ kb: d.kind === 'keyboard' }" @click="emit('pick', d)">
                <span class="dev-icon"><component :is="KIND_ICON[d.kind]" :size="22" /></span>
                <span class="dev-text">
                  <strong>{{ d.name ?? t('ui.bt.unnamed') }}</strong>
                  <small>{{ kindLabel(d) }} · <span class="mono">{{ d.mac }}</span></small>
                </span>
                <span class="sig" :aria-label="`${t('ui.bt.signal')} ${bars(d.rssi)}/4`">
                  <i v-for="b in 4" :key="b" :class="{ on: b <= bars(d.rssi) }" />
                </span>
                <ChevronRight :size="20" class="chev" aria-hidden="true" />
              </button>
            </li>
          </TransitionGroup>
          <div v-else-if="scanning || !state" class="skeletons" aria-hidden="true">
            <span v-for="i in 2" :key="i" class="skel" />
          </div>
          <div v-else-if="!errorText" class="empty">
            <Keyboard :size="28" aria-hidden="true" />
            <strong>{{ t('ui.bt.nothing') }}</strong>
            <p>{{ t('ui.bt.nothingHint') }}</p>
          </div>

          <template v-if="others.length">
            <button type="button" class="more" :aria-expanded="showOthers" @click="showOthers = !showOthers">
              {{ t('ui.bt.others', { n: others.length }) }}
              <ChevronRight :size="16" :class="{ open: showOthers }" aria-hidden="true" />
            </button>
            <ul v-if="showOthers" class="devs dim">
              <li v-for="d in others" :key="d.mac">
                <button type="button" class="dev" @click="emit('pick', d)">
                  <span class="dev-icon"><Bluetooth :size="20" /></span>
                  <span class="dev-text">
                    <strong>{{ d.name ?? t('ui.bt.unnamed') }}</strong>
                    <small class="mono">{{ d.mac }}</small>
                  </span>
                  <span class="sig"><i v-for="b in 4" :key="b" :class="{ on: b <= bars(d.rssi) }" /></span>
                </button>
              </li>
            </ul>
          </template>
        </div>

        <!-- ------------------------------------------------ Emparejar -->
        <div v-else class="body pair" aria-live="polite">
          <div class="target">
            <span class="dev-icon big"><component :is="chosen ? KIND_ICON[chosen.kind] : Keyboard" :size="30" /></span>
          </div>

          <template v-if="pairDone">
            <span class="check" aria-hidden="true"><Check :size="40" :stroke-width="3" /></span>
            <h3>{{ t('ui.bt.done') }}</h3>
            <p class="lead">{{ t('ui.bt.doneBody', { name: label(chosen) }) }}</p>
          </template>

          <template v-else-if="errorText || pairStuck">
            <span class="bad" aria-hidden="true"><CircleAlert :size="36" /></span>
            <p class="lead" role="alert">{{ errorText ?? t('ui.bt.err.failed') }}</p>
          </template>

          <template v-else-if="(phase === 'passkey' || phase === 'pin') && code">
            <h3>{{ t('ui.bt.typeCode') }}</h3>
            <div class="code" :aria-label="code.split('').join(' ')">
              <span v-for="(c, i) in code.split('')" :key="i" class="digit" :class="{ typed: i < entered, next: i === entered }">{{ c }}</span>
              <span class="enter" :class="{ next: entered >= code.length }"><CornerDownLeft :size="22" /></span>
            </div>
            <p class="lead">{{ t('ui.bt.thenEnter') }}</p>
            <p class="hint">{{ t('ui.bt.pinHint') }}</p>
          </template>

          <template v-else>
            <LoaderCircle :size="34" class="spin" aria-hidden="true" />
            <h3>{{ phase === 'connecting' ? t('ui.bt.connecting') : t('ui.bt.pairing') }}</h3>
            <p class="lead">{{ t('ui.bt.pairingHint') }}</p>
          </template>
        </div>

        <footer class="foot">
          <template v-if="view === 'list'">
            <button type="button" class="btn" :disabled="scanning" @click="emit('rescan')">
              <RefreshCw :size="18" :class="{ spin: scanning }" /> {{ t('ui.bt.rescan') }}
            </button>
          </template>
          <template v-else-if="pairDone">
            <button type="button" class="btn btn-primary wide" @click="emit('close')"><Check :size="18" /> {{ t('ui.bt.finish') }}</button>
          </template>
          <template v-else-if="errorText || pairStuck">
            <button type="button" class="btn" @click="emit('rescan')">{{ t('ui.bt.backToList') }}</button>
            <button type="button" class="btn btn-primary" @click="emit('retry')"><RefreshCw :size="18" /> {{ t('ui.bt.retry') }}</button>
          </template>
          <template v-else>
            <button type="button" class="btn wide" @click="emit('cancel')">{{ t('ui.bt.cancel') }}</button>
          </template>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgb(0 0 0 / 70%);
  animation: fade-in 0.14s ease-out;
}

.sheet {
  --tone: var(--info);
  width: min(36rem, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
  background:
    radial-gradient(80% 40% at 50% 0%, color-mix(in srgb, var(--tone) 13%, transparent), transparent 70%),
    var(--surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 45%);
  overflow: hidden;
  animation: pop-in 0.18s ease-out;
}

/* ------------------------------------------------ Cabecera con radar */
.top {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 0.9rem 0.75rem 1.1rem;
}

.titles {
  flex: 1;
  min-width: 0;
}

.titles h2 {
  font-size: 1.2rem;
  letter-spacing: -0.01em;
}

.sub {
  color: var(--text-muted);
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn.icon {
  flex: none;
  padding: 0;
}

.close {
  align-self: flex-start;
  background: transparent;
  border-color: transparent;
}

.radar {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.2rem;
}

.core {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 70%, transparent);
}

.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--tone);
  opacity: 0;
}

.radar.live .ring {
  animation: ping 1.8s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
}

.radar.live .r2 {
  animation-delay: 0.9s;
}

@keyframes ping {
  0% {
    transform: scale(1);
    opacity: 0.55;
  }

  100% {
    transform: scale(1.55);
    opacity: 0;
  }
}

.progress {
  height: 3px;
  margin: 0 1.1rem;
  border-radius: 2px;
  background: var(--hairline);
  overflow: hidden;
}

.progress span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 60%, transparent), var(--tone));
  transform-origin: left;
  transition: transform 0.5s linear;
}

.progress span.idle {
  opacity: 0.35;
}

/* ------------------------------------------------ Cuerpo */
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.85rem 1.1rem 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.35;
}

.steps li {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
}

.n {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--tone);
  border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent);
}

.alert {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius);
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border));
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.alert svg {
  flex: none;
  color: var(--danger);
  margin-top: 0.1rem;
}

.devs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.dev {
  width: 100%;
  min-height: 3.6rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.7rem 0.45rem 0.5rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
  transition: transform 0.08s ease-out, border-color 0.12s;
}

.dev:active {
  transform: scale(0.985);
}

.dev.kb {
  border-color: color-mix(in srgb, var(--tone) 55%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 14%, transparent), transparent 60%),
    linear-gradient(180deg, var(--surface-3), var(--surface-2));
}

.dev-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: var(--radius);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.dev-icon.big {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
}

.dev-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dev-text strong {
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dev-text small {
  color: var(--text-faint);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sig {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 1rem;
}

.sig i {
  width: 4px;
  border-radius: 1px;
  background: var(--border);
}

.sig i:nth-child(1) { height: 25%; }
.sig i:nth-child(2) { height: 50%; }
.sig i:nth-child(3) { height: 75%; }
.sig i:nth-child(4) { height: 100%; }

.sig i.on {
  background: var(--tone);
}

.chev {
  flex: none;
  color: var(--text-faint);
}

.devs.dim .dev {
  min-height: 3rem;
  opacity: 0.85;
}

.devs.dim .dev-icon {
  color: var(--text-faint);
  background: var(--hairline);
}

.more {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 2.5rem;
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.88rem;
  cursor: var(--cursor-point);
}

.more svg {
  transition: transform 0.15s;
}

.more svg.open {
  transform: rotate(90deg);
}

.skeletons {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.skel {
  height: 3.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}

.skel:nth-child(2) {
  opacity: 0.55;
}

@keyframes shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.8rem 0.5rem;
  text-align: center;
  color: var(--text-faint);
}

.empty strong {
  color: var(--text);
}

.empty p {
  font-size: 0.88rem;
}

.row-enter-active {
  transition: opacity 0.25s ease-out, transform 0.25s ease-out;
}

.row-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.row-move {
  transition: transform 0.25s ease-out;
}

/* ------------------------------------------------ Emparejar */
.pair {
  align-items: center;
  text-align: center;
  gap: 0.55rem;
  padding-top: 0.4rem;
  padding-bottom: 0.8rem;
}

.pair h3 {
  font-size: 1.15rem;
}

.lead {
  color: var(--text-muted);
  max-width: 28rem;
  line-height: 1.4;
}

.hint {
  color: var(--text-faint);
  font-size: 0.8rem;
}

.code {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.3rem 0 0.1rem;
}

.digit,
.enter {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3.7rem;
  border-radius: var(--radius);
  border: 1.5px solid var(--border);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 2rem;
  font-weight: 700;
  color: var(--text);
  transition: border-color 0.15s, background-color 0.15s, transform 0.15s;
}

.enter {
  width: 3.6rem;
  margin-left: 0.3rem;
  color: var(--text-muted);
}

.digit.typed {
  border-color: var(--tone);
  background: color-mix(in srgb, var(--tone) 18%, var(--bg));
  color: var(--tone);
}

.digit.next,
.enter.next {
  border-color: color-mix(in srgb, var(--tone) 70%, var(--border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone) 14%, transparent);
  animation: breathe 1.4s ease-in-out infinite;
}

@keyframes breathe {
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--tone) 6%, transparent);
  }
}

.check,
.bad {
  display: grid;
  place-items: center;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 50%;
  animation: pop-in 0.22s ease-out;
}

.check {
  color: var(--accent-ink);
  background: var(--ok);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--ok) 16%, transparent);
}

.bad {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.target {
  margin-bottom: 0.2rem;
}

.spin {
  color: var(--tone);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------ Pie */
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.7rem 1.1rem 1rem;
  border-top: 1px solid var(--hairline);
}

.foot .btn {
  min-height: 3.2rem;
}

.foot .wide {
  flex: 1;
}

/* Panel 1024×600 y móviles apaisados: más compacto en alto. */
@media (max-height: 620px) {
  .top {
    padding-top: 0.7rem;
    padding-bottom: 0.55rem;
  }

  .steps {
    font-size: 0.82rem;
  }

  .digit,
  .enter {
    height: 3.2rem;
    font-size: 1.7rem;
  }
}

@media (max-width: 420px) {
  .digit {
    width: 2.4rem;
    font-size: 1.6rem;
  }

  .enter {
    width: 2.8rem;
  }
}
</style>
