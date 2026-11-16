<script setup lang="ts">
import { BookOpen, Bot, Check, CheckCheck, CircleAlert, Download, Info, FileText, Gamepad2, HeartPulse, LifeBuoy, LoaderCircle, Map as MapIcon, Sparkles, Star, Trash2, Wrench } from '@lucide/vue'
import type { Component } from 'vue'
import type { ContentCatalogItem, ContentDetailsResponse, ContentItemStatus, ContentOverview } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'
import { autoFit, contentLangs, countryItems, downloadPlan, inLanguage, orderPlan, topicOf, type CountryChoice } from '~/utils/content'
import { INTEREST_IDS, recommend, type Interest } from '~/utils/interests'

/**
 * Catálogo de descargas (ADR 0015/0018). Modo «wizard» (bienvenida): empieza sin nada marcado; «Seleccionar
 * todo» marca todo lo del idioma de la interfaz (si no existe, en inglés) y el mapa del país, ajustado al espacio
 * libre, y las recomendaciones marcan lo más destacado de lo que interesa. Modo «manage»: Mantenimiento, con los
 * contenidos en los idiomas del usuario (los demás, con un interruptor).
 */
const props = defineProps<{ mode: 'wizard' | 'manage'; online: boolean; country?: CountryChoice | null }>()
const emit = defineEmits<{ started: [items: string[]] }>()
const t = useT()

const ov = ref<ContentOverview | null>(null)
const loadError = ref(false)
const selected = ref(new Set<string>())
const variants = reactive<Record<string, string>>({})
const autofitCount = ref(0)
const pendingRemove = ref<ContentCatalogItem | null>(null)

// Ficha «Más información»: las fichas se piden una sola vez, al abrir la primera.
const infoItem = ref<ContentCatalogItem | null>(null)
const details = ref<ContentDetailsResponse | null>(null)
const detailsLoading = ref(false)
async function openInfo(i: ContentCatalogItem): Promise<void> {
  infoItem.value = i
  if (details.value || detailsLoading.value) return
  detailsLoading.value = true
  details.value = await $fetch<ContentDetailsResponse>('/api/content/details', { timeout: 10_000, retry: 0 }).catch(() => null)
  detailsLoading.value = false
}
/** El mapa y las rutas de un país usan la ficha genérica del país. */
const detailsOf = (i: ContentCatalogItem) =>
  details.value?.items[i.id.startsWith('mapa-pais:') ? '@country-map' : i.id.startsWith('rutas-pais:') ? '@country-routing' : i.id] ?? null
const showOther = ref(false)
const interests = ref(new Set<Interest>())

/** Catálogo + mapa y rutas del país elegido (fuera de España, que tiene los suyos en el catálogo). */
const allItems = computed<ContentCatalogItem[]>(() => [
  ...(ov.value?.catalog ?? []),
  ...(props.country && props.country.id !== 'esp' ? countryItems(props.country) : []),
])
const langs = computed(() => contentLangs(locale.value))
const rank = (i: ContentCatalogItem): number => (langs.value.includes(i.lang) ? langs.value.indexOf(i.lang) : i.lang === 'mul' ? 0 : 99)
/** Hay otra opción del mismo tema en un idioma mejor para este usuario. */
const coveredBetter = (i: ContentCatalogItem): boolean =>
  allItems.value.some((o) => o.id !== i.id && topicOf(o) === topicOf(i) && rank(o) < rank(i))
const hiddenCount = computed(() => allItems.value.filter((i) => !inLanguage(i, locale.value)).length)

const job = useAdminJob('content', () => void load())

async function load(): Promise<void> {
  try {
    ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 })
    loadError.value = false
  } catch {
    loadError.value = true
    return
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), 4000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const statusOf = (id: string): ContentItemStatus | undefined => ov.value?.items.find((s) => s.id === id)
/** Instalado o en curso: no se puede marcar. */
const blocked = computed(() => new Set((ov.value?.items ?? []).filter((s) => s.state !== 'missing' && s.state !== 'failed').map((s) => s.id)))

/** Marca `items` (sin lo bloqueado) ajustado al espacio libre y avisa de lo que no cabe. */
function selectFitted(items: ContentCatalogItem[]): void {
  const fit = autoFit(items.filter((i) => !blocked.value.has(i.id)), ov.value?.freeBytes ?? null)
  selected.value = new Set(fit.keep.map((i) => i.id))
  autofitCount.value = fit.dropped.length
}
function clearSelection(): void {
  selected.value = new Set()
  autofitCount.value = 0
}

/** «Seleccionar todo»: lo mismo que «Descargarlo todo» (cada tema en el mejor idioma, mapas del país). */
const everything = computed(() =>
  ov.value ? downloadPlan(ov.value.catalog, blocked.value, locale.value, props.country ?? null, 'all', ov.value.ramBytes) : [],
)
/** Lo que «Seleccionar todo» puede marcar de verdad (lo que cabe): si ya está todo, el botón pasa a «Quitar todo». */
const everythingFitted = computed(() => autoFit(everything.value, ov.value?.freeBytes ?? null).keep)
const allSelected = computed(() => everythingFitted.value.length > 0 && everythingFitted.value.every((i) => selected.value.has(i.id)))
function toggleEverything(): void {
  if (allSelected.value) clearSelection()
  else selectFitted(everything.value)
}

// Recomendaciones: lo más destacado (por contenido) de cada interés.
const recommendedPlan = computed(() =>
  ov.value ? downloadPlan(ov.value.catalog, blocked.value, locale.value, props.country ?? null, 'recommended', ov.value.ramBytes) : [],
)
const highlights = computed(() => recommend(interests.value, allItems.value, recommendedPlan.value, locale.value, blocked.value))
const highlightIds = computed(() => new Set(highlights.value.map((i) => i.id)))
/**
 * Tocar un tema marca al momento lo destacado de ese tema (sin quitar lo que ya estaba marcado) y quitarlo
 * desmarca lo suyo que no sea también destacado de otro tema elegido.
 */
/** Temas en los que un contenido sale como destacado (para la ficha). */
function highlightFor(i: ContentCatalogItem): string[] {
  return INTEREST_IDS.filter((id) => recommend([id], allItems.value, recommendedPlan.value, locale.value).some((r) => r.id === i.id)).map((id) => t(`content.interest.${id}`))
}
function toggleInterest(id: Interest): void {
  const before = highlightIds.value
  const s = new Set(interests.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  interests.value = s
  const now = highlightIds.value
  const keep = allItems.value.filter((i) => (selected.value.has(i.id) && !(before.has(i.id) && !now.has(i.id))) || now.has(i.id))
  selectFitted(keep)
}
const sizeOf = (i: ContentCatalogItem): number => i.variants?.find((v) => v.flavour === variants[i.id])?.approxBytes ?? i.approxBytes

const GROUP_ICONS: Record<string, Component> = { salud: HeartPulse, preparacion: LifeBuoy, saber: BookOpen, oficios: Wrench, libros: BookOpen, manuales: FileText, mapas: MapIcon, asistente: Bot, juegos: Gamepad2 }
const groups = computed(() =>
  (ov.value?.groups ?? [])
    .map((g) => ({
      ...g,
      icon: GROUP_ICONS[g.id] ?? BookOpen,
      items: allItems.value.filter((i) => i.group === g.id && (showOther.value || inLanguage(i, locale.value) || selected.value.has(i.id))),
    }))
    .filter((g) => g.items.length),
)

const selectedItems = computed(() => allItems.value.filter((i) => selected.value.has(i.id)))
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
  return orderPlan(selectedItems.value).map((i) => {
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
    <template v-if="mode === 'wizard' && ov">
      <button type="button" class="btn select-everything" :class="allSelected ? 'glass' : 'btn-primary'" :aria-pressed="allSelected" @click="toggleEverything">
        <CheckCheck :size="24" aria-hidden="true" />
        <span>{{ allSelected ? t('content.everythingOff') : t('content.everything') }}</span>
      </button>

      <section class="recos" :aria-label="t('content.recos.title')">
        <header class="r-head">
          <Sparkles :size="18" aria-hidden="true" />
          <h3>{{ t('content.recos.title') }}</h3>
        </header>
        <p class="r-lead">{{ t('content.recos.lead') }}</p>
        <div class="chips" role="group" :aria-label="t('content.recos.title')">
          <button
            v-for="id in INTEREST_IDS" :key="id" type="button" class="chip-btn"
            :aria-pressed="interests.has(id)" @click="toggleInterest(id)"
          >
            <Check v-if="interests.has(id)" :size="14" aria-hidden="true" />{{ t(`content.interest.${id}`) }}
          </button>
        </div>
      </section>
    </template>
    <p v-if="autofitCount" class="notice tone-info">{{ t('content.autofit', { n: autofitCount }) }}</p>
    <label v-if="mode === 'manage' && hiddenCount" class="ui-row check other">
      <input v-model="showOther" type="checkbox" />
      {{ t('content.showOther', { n: hiddenCount }) }}
    </label>

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
              <span v-if="i.lang !== locale && ['es', 'en', 'fr', 'it'].includes(i.lang)" class="ui-chip lang" :title="t('content.lang.enHint')">{{ t(`content.lang.${i.lang}` as 'content.lang.en') }}</span>
              <span v-if="coveredBetter(i)" class="ui-chip faint">{{ t('content.equivalent') }}</span>
              <span v-if="highlightIds.has(i.id)" class="ui-chip star"><Star :size="11" aria-hidden="true" />{{ t('content.recos.badge') }}</span>
            </strong>
            <small>{{ i.description }}</small>
          </span>
        </label>
        <select v-if="i.variants && statusOf(i.id)?.state !== 'installed'" v-model="variants[i.id]" class="ui-field variant" :aria-label="t('content.variant')">
          <option v-for="v in i.variants" :key="v.flavour" :value="v.flavour">{{ v.label }} · {{ formatBytes(v.approxBytes) }}</option>
        </select>
        <button type="button" class="btn info-btn" :aria-label="t('content.info.open', { name: i.title })" @click="openInfo(i)">
          <Info :size="18" aria-hidden="true" /><span>{{ t('content.info.short') }}</span>
        </button>
        <span class="size mono">{{ formatBytes(statusOf(i.id)?.bytes ?? sizeOf(i)) }}</span>
        <span v-if="stateLabel(statusOf(i.id))" class="ui-chip state" :class="`tone-${stateLabel(statusOf(i.id))!.tone}`" :title="translateServer(statusOf(i.id)?.error ?? '')">
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

    <!-- El pie solo se queda fijo abajo cuando hay algo que hacer (selección o descarga en curso). -->
    <footer v-if="ov" class="foot" :class="{ sticky: mode === 'manage' && (selected.size > 0 || job.running.value) }">
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

    <ContentInfoSheet
      v-if="infoItem"
      :item="infoItem"
      :details="detailsOf(infoItem)"
      :loading="detailsLoading"
      :bytes="statusOf(infoItem.id)?.bytes ?? sizeOf(infoItem)"
      :selected="selected.has(infoItem.id)"
      :locked="blocked.has(infoItem.id)"
      :state-text="blocked.has(infoItem.id) ? (stateLabel(statusOf(infoItem.id))?.text ?? null) : null"
      :highlight-for="highlightFor(infoItem)"
      @toggle="toggle(infoItem)"
      @close="infoItem = null"
    />

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

.select-everything {
  width: 100%;
  min-height: 4rem;
  justify-content: center;
  gap: 0.7rem;
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.recos {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--surface-grad);
}

.r-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent);
}

.r-head h3 {
  font-size: 1rem;
  color: var(--text);
}

.r-lead {
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.35;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 2.6rem;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

.chip-btn[aria-pressed='true'] {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  font-weight: 700;
}

.star {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: 0.3rem;
  font-size: 0.7rem;
  vertical-align: middle;
  color: var(--accent);
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

.info-btn {
  gap: 0.35rem;
  min-height: 2.6rem;
  padding: 0 0.75rem;
  font-size: 0.85rem;
  color: var(--accent);
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

.foot.sticky {
  position: sticky;
  bottom: 0;
  z-index: 2;
  box-shadow: 0 -10px 24px rgb(0 0 0 / 35%);
}

.foot {
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
