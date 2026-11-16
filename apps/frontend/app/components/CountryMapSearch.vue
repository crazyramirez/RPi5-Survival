<script setup lang="ts">
import { Check, Download, Globe2, LoaderCircle, LocateFixed, Route, Search, Trash2 } from '@lucide/vue'
import type { ContentItemStatus, ContentOverview } from '@survival-os/shared-types'
import { searchCountries, type CountryOption } from '~/composables/useRegion'
import { formatBytes } from '~/utils/format'

/**
 * Mapas offline de CUALQUIER país (ADR 0018): se busca por nombre en cualquier idioma, se ve el tamaño
 * aproximado y se descarga con un toque (con Internet). Las rutas sin conexión del país, opcionales.
 * España usa sus mapas ya preparados (península y Baleares + Canarias).
 */
const props = defineProps<{ online: boolean }>()
const t = useT()
const { load, countries, country: suggested, detection } = useRegion()
const job = useAdminJob('content', () => void refresh())

const q = ref('')
const withRoutes = ref(true)
const status = ref<ContentItemStatus[]>([])
const pendingRemove = ref<CountryOption | null>(null)

const SPAIN = { map: ['mapa-espana', 'mapa-canarias'], routes: ['rutas-espana', 'rutas-canarias'] }
const mapIds = (c: CountryOption): string[] => (c.id === 'esp' ? SPAIN.map : [`mapa-pais:${c.id}`])
const routeIds = (c: CountryOption): string[] => (c.id === 'esp' ? SPAIN.routes : [`rutas-pais:${c.id}`])

async function refresh(): Promise<void> {
  const ov = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => null)
  if (ov) status.value = ov.items
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  void refresh()
  timer = setInterval(() => {
    if (job.running.value || status.value.some((s) => s.state === 'downloading' || s.state === 'verifying')) void refresh()
  }, 4000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const stateOf = (ids: string[]): 'installed' | 'busy' | 'failed' | 'missing' => {
  const st = ids.map((id) => status.value.find((s) => s.id === id))
  if (st.some((s) => s?.state === 'downloading' || s?.state === 'verifying')) return 'busy'
  if (st.length && st.every((s) => s?.state === 'installed')) return 'installed'
  if (st.some((s) => s?.state === 'failed')) return 'failed'
  return 'missing'
}
const progressOf = (ids: string[]): number | null => {
  const s = status.value.find((x) => ids.includes(x.id) && x.state === 'downloading')
  return s?.total && s.done != null ? Math.min(100, Math.floor((s.done / s.total) * 100)) : null
}

/** Países con mapa ya pedido o instalado (además de lo que se busca). */
const mine = computed(() =>
  (countries.value ?? []).filter((c) => c.id !== 'esp' && status.value.some((s) => s.id === `mapa-pais:${c.id}` && s.state !== 'missing')),
)
const results = computed(() => searchCountries(countries.value ?? [], q.value))

async function download(c: CountryOption): Promise<void> {
  const items = [...mapIds(c), ...(withRoutes.value ? routeIds(c) : [])].filter((id) => status.value.find((s) => s.id === id)?.state !== 'installed')
  if (!items.length) return
  await job.start({ action: 'install', items })
  q.value = ''
  setTimeout(() => void refresh(), 1500)
}

async function confirmRemove(): Promise<void> {
  const c = pendingRemove.value
  pendingRemove.value = null
  if (c) await job.start({ action: 'remove', items: [...mapIds(c), ...routeIds(c)] })
}

const DETECTED_BY = { position: 'maps.country.byPosition', lora: 'maps.country.byLora', timezone: 'maps.country.byTimezone', language: 'maps.country.byLanguage' } as const
</script>

<template>
  <div class="country">
    <p v-if="!props.online" class="notice tone-warn">{{ t('maps.country.offline') }}</p>

    <!-- País propuesto (detectado sin Internet), lo primero. -->
    <div v-if="suggested && !q" class="row suggested">
      <LocateFixed :size="20" class="accent" aria-hidden="true" />
      <span class="grow">
        <strong>{{ suggested.name }}</strong>
        <small v-if="detection?.country.id === suggested.id">{{ t(DETECTED_BY[detection.by]) }}</small>
        <small class="mono">{{ t('maps.country.size', { map: formatBytes(suggested.mapBytes), routes: formatBytes(suggested.routingBytes) }) }}</small>
      </span>
      <span v-if="stateOf(mapIds(suggested)) === 'installed'" class="ui-chip tone-ok"><Check :size="14" aria-hidden="true" />{{ t('content.state.installed') }}</span>
      <span v-else-if="stateOf(mapIds(suggested)) === 'busy'" class="ui-chip tone-info"><LoaderCircle :size="14" class="spin" aria-hidden="true" />{{ progressOf(mapIds(suggested)) ?? '' }}{{ progressOf(mapIds(suggested)) != null ? ' %' : '' }}</span>
      <button v-else type="button" class="btn btn-primary" :disabled="!props.online || job.running.value" @click="download(suggested)">
        <Download :size="18" aria-hidden="true" />{{ t('maps.country.download') }}
      </button>
    </div>

    <label class="search">
      <Search :size="20" aria-hidden="true" />
      <input v-model="q" type="search" class="ui-field" :placeholder="t('maps.country.search')" :aria-label="t('maps.country.search')" autocomplete="off" />
    </label>
    <label class="ui-row check">
      <input v-model="withRoutes" type="checkbox" />
      <Route :size="16" aria-hidden="true" />{{ t('maps.country.withRoutes') }}
    </label>

    <div v-if="q && !results.length" class="faint">{{ t('maps.country.none') }}</div>
    <div v-for="c in [...results, ...(q ? [] : mine)]" :key="c.id" class="row">
      <Globe2 :size="18" class="faint" aria-hidden="true" />
      <span class="grow">
        <strong>{{ c.name }}</strong>
        <small class="mono">{{ t('maps.country.size', { map: formatBytes(c.mapBytes), routes: formatBytes(c.routingBytes) }) }}<template v-if="c.zones > 1"> · {{ t('maps.country.zones', { n: c.zones }) }}</template> · z{{ c.maxzoom }}</small>
      </span>
      <template v-if="stateOf(mapIds(c)) === 'installed'">
        <span class="ui-chip tone-ok"><Check :size="14" aria-hidden="true" />{{ t('content.state.installed') }}</span>
        <button type="button" class="btn icon-btn" :aria-label="t('content.remove')" :disabled="job.running.value" @click="pendingRemove = c"><Trash2 :size="16" /></button>
      </template>
      <span v-else-if="stateOf(mapIds(c)) === 'busy'" class="ui-chip tone-info"><LoaderCircle :size="14" class="spin" aria-hidden="true" />{{ progressOf(mapIds(c)) ?? '' }}{{ progressOf(mapIds(c)) != null ? ' %' : '' }}</span>
      <button v-else type="button" class="btn" :disabled="!props.online || job.running.value" @click="download(c)">
        <Download :size="18" aria-hidden="true" />{{ stateOf(mapIds(c)) === 'failed' ? t('maps.country.retry') : t('maps.country.download') }}
      </button>
    </div>

    <JobLog :status="job.status.value" :error="job.error.value" :lines="2" />
    <ConfirmDialog
      v-if="pendingRemove" :title="t('content.removeTitle', { name: pendingRemove.name })" :message="t('content.removeBody')"
      :confirm-label="t('content.remove')" danger @confirm="confirmRemove" @cancel="pendingRemove = null"
    />
  </div>
</template>

<style scoped>
.country {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
}

.row.suggested {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%), var(--surface);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.grow small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.accent {
  color: var(--accent);
  flex: none;
}

.search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-left: 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
}

.search input {
  flex: 1;
  border: 0;
  background: transparent;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
