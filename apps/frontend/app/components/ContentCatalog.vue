<script setup lang="ts">
import { BookOpen, Bot, Check, CircleAlert, Download, HeartPulse, LifeBuoy, LoaderCircle, Map as MapIcon, Trash2, Wrench } from '@lucide/vue'
import type { Component } from 'vue'
import type { ContentCatalogItem, ContentItemStatus, ContentOverview } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'
import { autoFit, orderForInstall } from '~/utils/content'

/**
 * Catálogo de descargas (ADR 0015). Modo «wizard»: todo lo recomendado marcado (español por
 * defecto; inglés solo sin equivalente) y ajustado al espacio libre. Modo «manage»: Mantenimiento.
 */
const props = defineProps<{ mode: 'wizard' | 'manage'; online: boolean }>()
const emit = defineEmits<{ started: [items: string[]] }>()
const t = useT()

const ov = ref<ContentOverview | null>(null)
const loadError = ref(false)
const selected = ref(new Set<string>())
const variants = reactive<Record<string, string>>({})
const autofitCount = ref(0)
const pendingRemove = ref<ContentCatalogItem | null>(null)
let initialised = false

const job = useAdminJob('content', () => void load())

async function load(): Promise<void> {
  try {
    ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 })
    loadError.value = false
  } catch {
    loadError.value = true
    return
  }
  if (!initialised) {
    initialised = true
    if (props.mode === 'wizard') {
      const missing = ov.value.catalog.filter((i) => i.default && statusOf(i.id)?.state !== 'installed')
      const fit = autoFit(missing, ov.value.freeBytes)
      selected.value = new Set(fit.keep.map((i) => i.id))
      autofitCount.value = fit.dropped.length
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), 4000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const statusOf = (id: string): ContentItemStatus | undefined => ov.value?.items.find((s) => s.id === id)
const sizeOf = (i: ContentCatalogItem): number => i.variants?.find((v) => v.flavour === variants[i.id])?.approxBytes ?? i.approxBytes

const GROUP_ICONS: Record<string, Component> = { salud: HeartPulse, preparacion: LifeBuoy, saber: BookOpen, oficios: Wrench, libros: BookOpen, mapas: MapIcon, asistente: Bot }
const groups = computed(() =>
  (ov.value?.groups ?? []).map((g) => ({ ...g, icon: GROUP_ICONS[g.id] ?? BookOpen, items: (ov.value?.catalog ?? []).filter((i) => i.group === g.id) })).filter((g) => g.items.length),
)

const selectedItems = computed(() => (ov.value?.catalog ?? []).filter((i) => selected.value.has(i.id)))
const selectedBytes = computed(() => selectedItems.value.reduce((n, i) => n + sizeOf(i), 0))
const MARGIN = 2 * 1024 ** 3
const shortfall = computed(() => (ov.value?.freeBytes == null ? 0 : Math.max(0, selectedBytes.value + MARGIN - ov.value.freeBytes)))

function toggle(i: ContentCatalogItem): void {
  const s = new Set(selected.value)
  if (s.has(i.id)) s.delete(i.id)
  else s.add(i.id)
  selected.value = s
}
function selectGroup(items: ContentCatalogItem[], on: boolean): void {
  const s = new Set(selected.value)
  for (const i of items) {
    if (statusOf(i.id)?.state === 'installed') continue
    if (on) s.add(i.id)
    else s.delete(i.id)
  }
  selected.value = s
}

function specs(): string[] {
  return orderForInstall(selectedItems.value).map((i) => {
    const def = i.variants?.[0]?.flavour
    const v = variants[i.id]
    return v && v !== def ? `${i.id}:${v}` : i.id
  })
}

async function start(): Promise<void> {
  const items = specs()
  if (!items.length) return
  await job.start({ action: 'install', items })
  if (!job.error.value) {
    emit('started', items)
    selected.value = new Set()
  }
}

async function confirmRemove(): Promise<void> {
  const i = pendingRemove.value
  pendingRemove.value = null
  if (i) await job.start({ action: 'remove', items: [i.id] })
}

function stateLabel(s: ContentItemStatus | undefined): { tone: string; text: string; icon: Component } | null {
  if (!s) return null
  if (s.state === 'installed') return { tone: 'ok', text: t('content.state.installed'), icon: Check }
  if (s.state === 'downloading') {
    const pct = s.total && s.done != null ? `${Math.min(100, Math.floor((s.done / s.total) * 100))} %` : ''
    return { tone: 'info', text: t('content.state.downloading', { pct }), icon: LoaderCircle }
  }
  if (s.state === 'verifying') return { tone: 'info', text: t('content.state.verifying'), icon: LoaderCircle }
  if (s.state === 'failed') return { tone: 'danger', text: t('content.state.failed'), icon: CircleAlert }
  return null
}

defineExpose({ start, selectedCount: computed(() => selected.value.size), selectedBytes, shortfall, overview: ov, running: job.running })
</script>

<template>
  <div class="catalog">
    <p v-if="loadError" class="notice tone-danger">{{ t('content.error') }}</p>
    <p v-if="!online" class="notice tone-warn">{{ t('content.offline') }}</p>
    <p v-if="autofitCount" class="notice tone-info">{{ t('content.autofit', { n: autofitCount }) }}</p>

    <section v-for="g in groups" :key="g.id" class="group">
      <header class="g-head">
        <component :is="g.icon" :size="18" aria-hidden="true" />
        <h3>{{ g.title }}</h3>
        <span class="g-actions">
          <button type="button" class="btn small" @click="selectGroup(g.items, true)">{{ t('content.selectAll') }}</button>
          <button type="button" class="btn small" @click="selectGroup(g.items, false)">{{ t('content.selectNone') }}</button>
        </span>
      </header>
      <div v-for="i in g.items" :key="i.id" class="ui-row item" :class="{ on: selected.has(i.id) }">
        <label class="pick">
          <input
            type="checkbox"
            :checked="selected.has(i.id)"
            :disabled="statusOf(i.id)?.state === 'installed' || statusOf(i.id)?.state === 'downloading' || statusOf(i.id)?.state === 'verifying'"
            @change="toggle(i)"
          />
          <span class="meta">
            <strong>
              {{ i.title }}
              <span v-if="i.lang === 'en'" class="ui-chip lang" :title="t('content.lang.enHint')">{{ t('content.lang.en') }}</span>
              <span v-if="i.equivalentOf" class="ui-chip faint">{{ t('content.equivalent') }}</span>
            </strong>
            <small>{{ i.description }}</small>
          </span>
        </label>
        <select v-if="i.variants && statusOf(i.id)?.state !== 'installed'" v-model="variants[i.id]" class="ui-field variant" :aria-label="t('content.variant')">
          <option v-for="v in i.variants" :key="v.flavour" :value="v.flavour">{{ v.label }} · {{ formatBytes(v.approxBytes) }}</option>
        </select>
        <span class="size mono">{{ formatBytes(statusOf(i.id)?.bytes ?? sizeOf(i)) }}</span>
        <span v-if="stateLabel(statusOf(i.id))" class="ui-chip state" :class="`tone-${stateLabel(statusOf(i.id))!.tone}`" :title="statusOf(i.id)?.error ?? ''">
          <component :is="stateLabel(statusOf(i.id))!.icon" :size="14" aria-hidden="true" />{{ stateLabel(statusOf(i.id))!.text }}
        </span>
        <button
          v-if="mode === 'manage' && statusOf(i.id)?.state === 'installed'"
          type="button" class="btn icon-btn" :aria-label="t('content.remove')" :disabled="job.running.value" @click="pendingRemove = i"
        >
          <Trash2 :size="16" />
        </button>
      </div>
    </section>

    <footer v-if="ov" class="foot">
      <span class="tot">
        <strong>{{ t('content.selected', { n: selected.size, size: formatBytes(selectedBytes) }) }}</strong>
        <small>{{ ov.freeBytes != null ? t('content.free', { size: formatBytes(ov.freeBytes) }) : '' }}</small>
      </span>
      <p v-if="shortfall > 0" class="warn">{{ t('content.needed', { size: formatBytes(shortfall) }) }}</p>
      <div class="row">
        <button v-if="job.running.value" type="button" class="btn btn-danger" @click="job.stop()">{{ t('content.stop') }}</button>
        <button
          v-if="mode === 'manage'"
          type="button" class="btn btn-primary" :disabled="!selected.size || !online || job.running.value || shortfall > 0" @click="start"
        >
          <Download :size="18" aria-hidden="true" />{{ t('content.download', { n: selected.size, size: formatBytes(selectedBytes) }) }}
        </button>
      </div>
      <p v-if="mode === 'wizard' && job.error.value" class="warn">{{ job.error.value }}</p>
    </footer>
    <JobLog v-if="mode === 'manage'" :status="job.status.value" :error="job.error.value" :lines="4" />

    <ConfirmDialog
      v-if="pendingRemove"
      :title="t('content.removeTitle', { name: pendingRemove.title })"
      :message="t('content.removeBody')"
      :confirm-label="t('content.remove')"
      danger
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </div>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.group {
  padding: 0.3rem 0.8rem 0.5rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.g-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  color: var(--accent);
}

.g-head h3 {
  flex: 1;
  font-size: 1rem;
  color: var(--text);
}

.g-actions {
  display: flex;
  gap: 0.3rem;
}

.btn.small {
  min-height: 2.2rem;
  padding: 0 0.6rem;
  font-size: 0.8rem;
}

.item {
  gap: 0.6rem;
  flex-wrap: wrap;
}

.item.on {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.pick {
  flex: 1;
  min-width: 14rem;
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.45rem 0;
  cursor: pointer;
}

.pick input {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  margin-top: 0.1rem;
  accent-color: var(--accent);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.meta strong {
  font-size: 0.95rem;
}

.meta small {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.3;
}

.lang {
  margin-left: 0.3rem;
  font-size: 0.7rem;
  vertical-align: middle;
}

.variant {
  min-height: 2.4rem;
  font-size: 0.85rem;
}

.size {
  min-width: 5.5rem;
  text-align: right;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 700;
}

.foot {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
}

.tot {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.tot small {
  color: var(--text-muted);
}

.row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.warn {
  color: var(--warn);
  font-size: 0.88rem;
}
</style>
