<script setup lang="ts">
import { Bluetooth, BluetoothConnected, Gamepad2, Keyboard, Link, MousePointer2, Unlink, Usb } from '@lucide/vue'
import type { BluetoothDevice, BluetoothState } from '@survival-os/shared-types'

/**
 * Teclados, ratones y mandos Bluetooth dentro de «Dispositivos de entrada»: los emparejados (con desvincular y
 * reconectar) y el botón que abre la hoja guiada de emparejamiento. Todo pasa por la tarea `bluetooth`
 * (scripts/bt-input.py), una sola a la vez: buscar, emparejar, conectar o desvincular.
 */
const t = useT()
const emit = defineEmits<{ changed: [] }>()

const lastAction = ref<BluetoothState['action']>('status')
const job = useAdminJob('bluetooth', () => emit('changed'), 1000)

/** Estado de la tarea solo si es de la acción que pedimos (nunca el de la anterior). */
const live = computed<BluetoothState | null>(() => {
  const d = job.status.value?.data as BluetoothState | null | undefined
  return d && d.action === lastAction.value ? d : null
})

// Lo último conocido (cualquier acción trae la lista de emparejados y el estado del adaptador).
const paired = ref<BluetoothDevice[]>([])
const adapter = ref<BluetoothState['adapter'] | null>(null)
watch(
  () => job.status.value?.data as BluetoothState | null | undefined,
  (d) => {
    if (!d || d.phase === 'starting') return
    if (d.adapter.present || d.error === 'no-adapter') adapter.value = d.adapter
    if (d.phase === 'done' || d.action === 'status' || d.action === 'scan') paired.value = d.paired
  },
  { immediate: true },
)
const noAdapter = computed(() => adapter.value !== null && !adapter.value.present)

const sheet = ref<null | 'list' | 'pair'>(null)
const chosen = ref<BluetoothDevice | null>(null)
const busy = ref<string | null>(null)
const toUnpair = ref<BluetoothDevice | null>(null)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Para la tarea en curso (si la hay) y espera a que termine: el emparejado necesita la radio libre. */
async function settle(): Promise<void> {
  await job.refresh()
  if (!job.running.value) return
  await job.stop()
  for (let i = 0; i < 40 && job.running.value; i++) {
    await sleep(250)
    await job.refresh()
  }
}

async function run(action: BluetoothState['action'], mac?: string): Promise<void> {
  await settle()
  lastAction.value = action
  await job.start(mac ? { action, mac } : { action })
}

function openSheet(): void {
  chosen.value = null
  sheet.value = 'list'
  void run('scan')
}

function pick(dev: BluetoothDevice): void {
  chosen.value = dev
  sheet.value = 'pair'
  void run('pair', dev.mac)
}

function rescan(): void {
  sheet.value = 'list'
  void run('scan')
}

async function closeSheet(): Promise<void> {
  const wasPairing = sheet.value === 'pair' && live.value?.phase !== 'done'
  sheet.value = null
  if (job.running.value) await settle()
  // Al cerrar a medias, refrescar la lista de emparejados.
  if (wasPairing || lastAction.value === 'scan') void run('status')
}

// Emparejado: la hoja se cierra sola tras celebrarlo.
let autoClose: ReturnType<typeof setTimeout> | undefined
watch(
  () => sheet.value === 'pair' && live.value?.phase === 'done',
  (done) => {
    if (autoClose) clearTimeout(autoClose)
    if (done) autoClose = setTimeout(() => void closeSheet(), 3500)
  },
)
onBeforeUnmount(() => {
  if (autoClose) clearTimeout(autoClose)
  // Salir de la pantalla con una búsqueda o un emparejado en marcha: se detiene (la radio queda libre).
  if (job.running.value && lastAction.value !== 'status') void job.stop()
})

async function act(action: 'connect' | 'remove', dev: BluetoothDevice): Promise<void> {
  busy.value = dev.mac
  await run(action, dev.mac)
  for (let i = 0; i < 120 && job.running.value; i++) await sleep(250)
  busy.value = null
}

function confirmUnpair(): void {
  const dev = toUnpair.value
  toUnpair.value = null
  if (dev) void act('remove', dev)
}

onMounted(() => {
  // Estado real al entrar (ligero: solo consulta BlueZ).
  setTimeout(() => {
    if (!job.running.value) void run('status')
  }, 300)
})

const ICON = { keyboard: Keyboard, pointer: MousePointer2, gamepad: Gamepad2, 'other-input': Keyboard, other: Usb } as const
const rowError = computed(() => {
  const d = job.status.value?.data as BluetoothState | null | undefined
  if (sheet.value || !d || d.phase !== 'error' || (d.action !== 'connect' && d.action !== 'remove')) return null
  const key = `ui.bt.err.${d.error ?? 'failed'}` as Parameters<typeof t>[0]
  const txt = t(key)
  return txt === key ? t('ui.bt.err.failed') : txt
})
</script>

<template>
  <div class="bt">
    <p v-if="noAdapter" class="none"><Bluetooth :size="16" aria-hidden="true" />{{ t('ui.bt.noAdapter') }}</p>
    <template v-else>
      <ul v-if="paired.length" class="paired" :aria-label="t('ui.bt.section')">
        <li v-for="d in paired" :key="d.mac" class="ui-row prow" :class="d.connected ? 'tone-ok' : 'tone-muted'">
          <span class="picon" aria-hidden="true">
            <component :is="ICON[d.kind]" :size="18" />
            <span class="badge"><BluetoothConnected v-if="d.connected" :size="11" /><Bluetooth v-else :size="11" /></span>
          </span>
          <span class="grow">
            <span class="name">{{ d.name ?? d.mac }}</span>
            <span class="meta"><span class="dot" aria-hidden="true" />{{ d.connected ? t('ui.bt.connected') : t('ui.bt.standby') }}</span>
          </span>
          <button
            v-if="!d.connected" type="button" class="btn sm" :disabled="busy !== null || job.running.value"
            :aria-label="`${t('ui.bt.reconnect')} ${d.name ?? d.mac}`" @click="act('connect', d)"
          >
            <Link :size="16" /><span class="lbl">{{ t('ui.bt.reconnect') }}</span>
          </button>
          <button
            type="button" class="btn sm btn-danger" :disabled="busy !== null || job.running.value"
            :aria-label="`${t('ui.bt.unpair')} ${d.name ?? d.mac}`" @click="toUnpair = d"
          >
            <Unlink :size="16" /><span class="lbl">{{ busy === d.mac ? t('ui.bt.checking') : t('ui.bt.unpair') }}</span>
          </button>
        </li>
      </ul>
      <p v-if="rowError" class="err" role="alert">{{ rowError }}</p>
      <button type="button" class="btn cta" :disabled="busy !== null" @click="openSheet">
        <span class="cta-orb" aria-hidden="true"><Bluetooth :size="18" /></span>
        {{ t('ui.bt.connect') }}
      </button>
    </template>

    <BluetoothPairSheet
      v-if="sheet"
      :view="sheet"
      :state="live"
      :running="job.running.value"
      :chosen="chosen"
      :request-error="job.error.value"
      @pick="pick"
      @rescan="rescan"
      @retry="chosen && pick(chosen)"
      @cancel="rescan"
      @close="closeSheet"
    />
    <ConfirmDialog
      v-if="toUnpair"
      :title="t('ui.bt.unpairTitle', { name: toUnpair.name ?? toUnpair.mac })"
      :message="t('ui.bt.unpairBody')"
      :confirm-label="t('ui.bt.unpair')"
      danger
      @confirm="confirmUnpair"
      @cancel="toUnpair = null"
    />
  </div>
</template>

<style scoped>
.bt {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.2rem;
}

.paired {
  list-style: none;
  margin: 0;
  padding: 0.1rem 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--info) 4%, var(--bg));
}

.prow {
  gap: 0.6rem;
}

.picon {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--info);
  background: color-mix(in srgb, var(--info) 14%, transparent);
}

.badge {
  position: absolute;
  right: -0.3rem;
  bottom: -0.3rem;
  display: grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  color: var(--bg);
  background: var(--tone);
  border: 2px solid var(--surface);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 700;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.76rem;
  color: var(--text-faint);
}

.dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--tone);
}

.tone-ok .dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
}

.btn.sm {
  min-height: 2.6rem;
  padding: 0 0.7rem;
  font-size: 0.85rem;
  gap: 0.35rem;
}

.cta {
  justify-content: flex-start;
  min-height: 3.2rem;
  padding-left: 0.45rem;
  border-color: color-mix(in srgb, var(--info) 50%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--info) 16%, transparent), transparent 70%),
    linear-gradient(180deg, var(--surface-3), var(--surface-2));
}

.cta-orb {
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  border-radius: 50%;
  color: var(--info);
  background: color-mix(in srgb, var(--info) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--info) 65%, transparent);
}

.none,
.err {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.85rem;
  color: var(--text-faint);
}

.err {
  color: var(--danger);
}

/* Columnas estrechas (móvil, 4 tarjetas por fila): solo iconos en las acciones. */
@container (max-width: 22rem) {
  .btn.sm .lbl {
    display: none;
  }
}
</style>
