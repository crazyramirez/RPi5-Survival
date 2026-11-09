<script setup lang="ts">
import { Battery, BatteryCharging, Crosshair, MapPin, RadioTower, RefreshCw, Send, Settings, Trash2, Usb } from '@lucide/vue'
import type { MeshChannel, MeshMessage, MeshNode, MeshPortScan, MeshStatus } from '@survival-os/shared-types'
import { formatClock, formatDate } from '~/utils/format'
import { formatDistance } from '~/utils/waypoints'

/**
 * Malla LoRa Meshtastic (nodo por USB → servicio survival-mesh). Solo muestra lo que el nodo informa:
 * sin batería/posición/hora → se dice. Los textos de la malla se pintan como texto, nunca como HTML.
 */
const t = useT()
const status = ref<MeshStatus | null>(null)
const reachable = ref(true)
const nodes = ref<MeshNode[]>([])
const channels = ref<MeshChannel[]>([])
const messages = ref<MeshMessage[]>([])

async function get<T>(path: string): Promise<T | null> {
  return await ($fetch as (u: string, o: Record<string, unknown>) => Promise<T>)(`/api/mesh/${path}`, { timeout: 8000, retry: 0 }).catch(() => null)
}

async function loadStatus(): Promise<void> {
  const s = await get<MeshStatus>('status')
  reachable.value = s !== null
  status.value = s
}
async function loadAll(): Promise<void> {
  await loadStatus()
  if (!status.value?.connected) return
  const [n, c, m] = await Promise.all([get<MeshNode[]>('nodes'), get<MeshChannel[]>('channels'), get<MeshMessage[]>('messages?limit=200')])
  if (n) nodes.value = n
  if (c) channels.value = c
  if (m) messages.value = m
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadAll()
  timer = setInterval(() => void loadAll(), 5000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

// ------------------------------------------------------------------ Presentación
const byId = computed(() => new Map(nodes.value.map((n) => [n.id, n])))
function nodeName(id: string | null): string {
  if (!id) return t('mesh.unknownNode')
  const n = byId.value.get(id)
  if (n?.isMe) return t('mesh.you')
  return n?.longName ?? n?.shortName ?? id
}
function when(iso: string | null): string {
  if (!iso) return t('mesh.heardUnknown')
  const d = new Date(iso)
  return `${formatDate(d)} ${formatClock(d)}`
}
function channelName(i: number): string {
  const c = channels.value.find((x) => x.index === i)
  return c?.name ?? (c?.role === 'PRIMARY' || i === 0 ? t('mesh.channelPrimary') : `#${i}`)
}
const me = computed(() => nodes.value.find((n) => n.isMe) ?? null)
const others = computed(() => nodes.value.filter((n) => !n.isMe))
/** Cronológico (el más reciente abajo, como un chat). */
const thread = computed(() => [...messages.value].reverse())

// ------------------------------------------------------------------ Envío
const text = ref('')
const channel = ref(0)
const to = ref<string>('')
const sending = ref(false)
const sendError = ref<string | null>(null)
const sendOk = ref(false)
const bytes = computed(() => new TextEncoder().encode(text.value.trim()).length)
const maxBytes = computed(() => status.value?.maxTextBytes ?? 200)

async function send(): Promise<void> {
  if (!text.value.trim() || bytes.value > maxBytes.value || sending.value) return
  sending.value = true
  sendError.value = null
  sendOk.value = false
  try {
    await postAction('/api/mesh/send', { text: text.value, channel: channel.value, ...(to.value ? { to: to.value } : {}) })
    text.value = ''
    sendOk.value = true
    await loadAll()
  } catch (err) {
    const e = err as { data?: { error?: string } }
    sendError.value = e?.data?.error ?? actionErrorMessage(err)
  } finally {
    sending.value = false
  }
}

// ------------------------------------------------------------------ Nodo seguido en el mapa
/** Id del nodo cuya posición usa el mapa como respaldo del GNSS (null = el propio). */
const trackedId = computed(() => status.value?.trackId ?? null)
const trackedLabel = computed(() => {
  const tr = status.value?.tracked
  if (!status.value?.trackId) return t('mesh.trackOwn')
  return tr?.longName ?? tr?.shortName ?? status.value.trackId
})
const tracking = ref(false)
const trackError = ref<string | null>(null)
async function setTrack(id: string | null): Promise<void> {
  if (tracking.value) return
  tracking.value = true
  trackError.value = null
  try {
    await postAction('/api/mesh/track', { id })
    await loadStatus()
  } catch (err) {
    const e = err as { data?: { error?: string } }
    trackError.value = e?.data?.error ?? actionErrorMessage(err)
  } finally {
    tracking.value = false
  }
}
// Pedir su posición al nodo seguido (canal privado; el servicio limita a 1 por minuto).
const refreshing = ref(false)
const refreshMsg = ref<string | null>(null)
const trackedRemote = computed(() => !!status.value?.trackId && status.value.trackId !== status.value.me?.id)
async function requestPosition(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  refreshMsg.value = null
  try {
    await postAction('/api/mesh/refresh', {})
    refreshMsg.value = t('mesh.refreshSent', { name: trackedLabel.value })
    // La respuesta llega por radio en segundos: se refresca la vista un par de veces.
    setTimeout(() => void loadAll(), 8000)
    setTimeout(() => void loadAll(), 20000)
  } catch (err) {
    const e = err as { data?: { error?: string } }
    refreshMsg.value = e?.data?.error ?? actionErrorMessage(err)
  } finally {
    refreshing.value = false
  }
}

function isTracked(n: MeshNode): boolean {
  return n.isMe ? trackedId.value === null : !!n.id && n.id === trackedId.value
}

// ------------------------------------------------------------------ Configuración (tarea root `mesh`)
const scanJob = useAdminJob('mesh')
const scan = computed(() => (scanJob.status.value?.data as MeshPortScan | null) ?? null)
const showSetup = ref(false)
const pending = ref<{ title: string; body: string; label: string; run: () => Promise<void> } | null>(null)
async function confirm(): Promise<void> {
  const p = pending.value
  pending.value = null
  await p?.run()
}
watch(
  () => scanJob.running.value,
  (r, was) => {
    if (was && !r) setTimeout(() => void loadAll(), 3000)
  },
)
const needsSetup = computed(() => !reachable.value || (status.value && !status.value.port))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('mesh.title')" :icon="RadioTower" />

    <!-- Estado -->
    <AppCard :title="status?.connected ? t('mesh.connected') : t('mesh.disconnected')" :icon="Usb" :tone="status?.connected ? 'ok' : 'warn'">
      <p v-if="!reachable" class="note">{{ t('mesh.unavailable') }}</p>
      <p v-else-if="status && !status.connected" class="note">{{ status.error }}</p>
      <template v-if="status?.connected">
        <KvRow :label="t('mesh.me')" :value="me ? `${me.longName ?? me.id} (${me.shortName ?? '—'})` : (status.me?.id ?? '—')" />
        <KvRow :label="t('mesh.firmware')" :value="status.me?.firmware ?? '—'" mono />
        <KvRow :label="t('mesh.nodes')" :value="t('mesh.nodesSeen', { n: status.nodeCount })" />
        <KvRow :label="t('mesh.lastPacket')" :value="status.lastPacketAt ? when(status.lastPacketAt) : t('mesh.never')" />
        <KvRow :label="t('mesh.trackLabel')" :value="trackedLabel" />
        <KvRow
          v-if="status.tracked?.position"
          :label="t('mesh.trackPosition')"
          :value="status.tracked.position.at ? `${when(status.tracked.position.at)}${status.tracked.position.cached ? ` · ${t('mesh.lastKnown')}` : ''}` : t('mesh.heardUnknown')"
        />
        <div v-if="trackedRemote" class="refresh-row">
          <button type="button" class="btn" :disabled="refreshing" @click="requestPosition">
            <Crosshair :size="18" aria-hidden="true" /> {{ t('mesh.refresh') }}
          </button>
          <p v-if="refreshMsg" class="faint" role="status">{{ refreshMsg }}</p>
        </div>
        <p v-else class="faint">{{ t('mesh.refreshOwn') }}</p>
      </template>
      <div class="row-actions">
        <button type="button" class="btn" @click="loadAll"><RefreshCw :size="18" /></button>
        <button type="button" class="btn" @click="showSetup = !showSetup"><Settings :size="18" /> {{ t('mesh.setup') }}</button>
      </div>
    </AppCard>

    <!-- Configuración -->
    <AppCard v-if="showSetup || needsSetup" :title="t('mesh.setup')" :icon="Settings">
      <p class="note">{{ t('mesh.setupHint') }}</p>
      <KvRow v-if="status?.port" :label="t('mesh.portConfigured')" :value="status.port" mono />
      <button type="button" class="btn" :disabled="scanJob.running.value" @click="scanJob.start({ action: 'scan' })">
        <Usb :size="18" /> {{ t('mesh.scan') }}
      </button>
      <template v-if="scan">
        <p v-if="!scan.ports.length" class="note">{{ t('mesh.noPorts') }}</p>
        <div v-for="p in scan.ports" :key="p.path" class="port">
          <span class="mono grow">{{ p.path.replace('/dev/serial/by-id/', '') }} → {{ p.device }}</span>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="scanJob.running.value || scan.configured === p.path"
            @click="pending = { title: t('mesh.installConfirm'), body: t('mesh.installBody', { port: p.path }), label: t('mesh.install'), run: () => scanJob.start({ action: scan!.installed ? 'port' : 'install', port: p.path }) }"
          >
            {{ t('mesh.install') }}
          </button>
        </div>
        <button
          v-if="scan.installed"
          type="button"
          class="btn btn-danger"
          :disabled="scanJob.running.value"
          @click="pending = { title: t('mesh.removeConfirm'), body: t('mesh.removeBody'), label: t('mesh.remove'), run: () => scanJob.start({ action: 'remove' }) }"
        >
          <Trash2 :size="18" /> {{ t('mesh.remove') }}
        </button>
      </template>
      <JobLog v-if="scanJob.status.value?.log.length" :status="scanJob.status.value" />
    </AppCard>

    <template v-if="status?.connected">
      <!-- Mensajes -->
      <h2 class="ui-sec">{{ t('mesh.messages') }}</h2>
      <p class="privacy">{{ t('mesh.privacy') }}</p>
      <section class="thread" aria-live="polite">
        <p v-if="!thread.length" class="note">{{ t('mesh.noMessages') }}</p>
        <article v-for="m in thread" :key="m.id" class="msg" :class="m.direction">
          <header>
            <strong>{{ m.direction === 'out' ? t('mesh.you') : nodeName(m.from) }}</strong>
            <span class="faint">
              {{ m.to && m.to !== '^all' ? `→ ${nodeName(m.to)}` : channelName(m.channel) }} · {{ when(m.at) }}
              <template v-if="m.snr !== null"> · {{ t('mesh.snr', { v: m.snr }) }}</template>
              <template v-if="m.hops !== null"> · {{ m.hops === 0 ? t('mesh.direct') : t('mesh.hops', { n: m.hops }) }}</template>
            </span>
          </header>
          <p class="text">{{ m.text }}</p>
        </article>
      </section>

      <form class="compose" @submit.prevent="send">
        <div class="selects">
          <label>
            <span>{{ t('mesh.channel') }}</span>
            <select v-model.number="channel">
              <option v-for="c in channels.length ? channels : [{ index: 0, name: null, role: 'PRIMARY' }]" :key="c.index" :value="c.index">{{ channelName(c.index) }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('mesh.to') }}</span>
            <select v-model="to">
              <option value="">{{ t('mesh.toAll') }}</option>
              <option v-for="n in others" :key="n.id ?? n.num ?? 0" :value="n.id">{{ n.longName ?? n.shortName ?? n.id }}</option>
            </select>
          </label>
        </div>
        <div class="line">
          <input v-model="text" type="text" :placeholder="t('mesh.placeholder')" enterkeyhint="send" />
          <button type="submit" class="btn btn-primary" :disabled="sending || !text.trim() || bytes > maxBytes"><Send :size="18" /> {{ t('mesh.send') }}</button>
        </div>
        <p class="faint" :class="{ err: bytes > maxBytes }">{{ t('mesh.bytes', { n: bytes, max: maxBytes }) }}</p>
        <p v-if="sendError" class="err">{{ sendError }}</p>
        <p v-else-if="sendOk" class="faint">{{ t('mesh.sent') }}</p>
      </form>

      <!-- Nodos -->
      <h2 class="ui-sec">{{ t('mesh.nodes') }}</h2>
      <p v-if="!nodes.length" class="note">{{ t('mesh.noNodes') }}</p>
      <ul class="nodes">
        <li v-for="n in nodes" :key="n.id ?? n.num ?? 0" class="ui-row node" :class="{ me: n.isMe }">
          <span class="short mono">{{ n.shortName ?? '?' }}</span>
          <span class="grow">
            <strong>{{ n.longName ?? n.id }}</strong>
            <span class="meta">
              {{ n.hwModel ?? '—' }} · {{ n.lastHeard ? t('mesh.heard', { when: when(n.lastHeard) }) : t('mesh.heardUnknown') }}
              <template v-if="n.hopsAway !== null"> · {{ n.hopsAway === 0 ? t('mesh.direct') : t('mesh.hops', { n: n.hopsAway }) }}</template>
              <template v-if="n.snr !== null"> · {{ t('mesh.snr', { v: n.snr }) }}</template>
            </span>
            <span class="meta">
              <template v-if="n.battery">
                <BatteryCharging v-if="n.battery.powered" :size="14" aria-hidden="true" />
                <Battery v-else :size="14" aria-hidden="true" />
                {{ n.battery.powered ? t('mesh.powered') : t('mesh.battery', { v: n.battery.level ?? '—' }) }}
              </template>
              <template v-if="n.position">
                · <MapPin :size="14" aria-hidden="true" /> <span class="mono">{{ n.position.lat.toFixed(5) }}, {{ n.position.lon.toFixed(5) }}</span>
                <template v-if="n.position.at"> ({{ when(n.position.at) }})</template>
                <template v-if="n.position.precisionM"> · {{ t('mesh.precision', { d: formatDistance(n.position.precisionM) }) }}</template>
              </template>
              <template v-else> · {{ t('mesh.noPosition') }}</template>
            </span>
          </span>
          <button
            v-if="n.id"
            type="button"
            class="btn track"
            :class="{ on: isTracked(n) }"
            :aria-pressed="isTracked(n)"
            :disabled="tracking || isTracked(n)"
            @click="setTrack(n.isMe ? null : n.id)"
          >
            <Crosshair :size="18" aria-hidden="true" />
            {{ isTracked(n) ? t('mesh.tracking') : t('mesh.track') }}
          </button>
        </li>
      </ul>
      <p class="faint">{{ t('mesh.trackHint') }}</p>
      <p v-if="trackError" class="err">{{ trackError }}</p>
    </template>

    <ConfirmDialog v-if="pending" :title="pending.title" :message="pending.body" :confirm-label="pending.label" @confirm="confirm" @cancel="pending = null" />
  </div>
</template>

<style scoped>
.refresh-row {
  margin-top: 0.5rem;
}

.refresh-row .btn {
  width: 100%;
}

.track {
  flex: none;
  align-self: center;
  white-space: nowrap;
}

.track.on {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}

@media (max-width: 600px) {
  .node {
    flex-wrap: wrap;
  }

  .track {
    margin-left: auto;
  }
}

.note,
.privacy {
  color: var(--text-muted, inherit);
}

.privacy {
  font-size: 0.9rem;
  margin: 0 0 0.5rem;
}

.row-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.port {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.4rem 0;
}

.grow {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.thread {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 22rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.2rem;
}

.msg {
  max-width: 85%;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
}

.msg.out {
  align-self: flex-end;
  border-color: var(--accent);
}

.msg header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: baseline;
  font-size: 0.9rem;
}

.msg .text {
  margin: 0.2rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 1.05rem;
}

.compose {
  margin: 0.7rem 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.selects {
  display: flex;
  gap: 0.6rem;
}

.selects label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
}

.selects select,
.line input {
  min-height: var(--touch);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  padding: 0 0.6rem;
}

.selects select {
  flex: 1;
}

.line {
  display: flex;
  gap: 0.5rem;
}

.line input {
  flex: 1;
  font-size: 1.05rem;
}

.err {
  color: var(--danger);
  font-weight: 700;
}

.nodes {
  list-style: none;
  margin: 0;
  padding: 0;
}

.node {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.5rem 0.2rem;
}

.node.me .short {
  border-color: var(--accent);
}

.short {
  min-width: 3.2rem;
  text-align: center;
  padding: 0.3rem 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-weight: 700;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.88rem;
  color: var(--text-muted, inherit);
}
</style>
