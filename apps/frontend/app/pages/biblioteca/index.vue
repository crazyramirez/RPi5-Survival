<script setup lang="ts">
import {
  ArrowLeft,
  Baby,
  BookOpen,
  Bot,
  Brain,
  ChevronRight,
  Clock,
  Compass,
  Download,
  Droplet,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  HeartPulse,
  Layers,
  Library,
  LibraryBig,
  NotebookPen,
  Radio,
  RefreshCw,
  Search,
  SearchX,
  Settings2,
  Siren,
  Sprout,
  Star,
  Stethoscope,
  Tent,
  Wrench,
  X,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { DocKind, DocSummary, LibraryShelfMap, LibraryStatus, Probe, SearchHit, SearchResults, ZimBook } from '@survival-os/shared-types'
import type { MessageKey } from '~/locales/es'
import { formatBytes } from '~/utils/format'
import {
  classifyBooks, groupBooks, groupManuals, groupOwnDocs, matches, OTHER, splitDocs,
  type DocSort, type ManualEntry, type ShelfBook,
} from '~/utils/library-shelf'

/**
 * Biblioteca: buscador en la cabecera y tres secciones en pestañas —enciclopedias (ZIM), manuales en PDF del
 * catálogo y documentos propios—, cada una ordenada por categorías con barra lateral, filtro rápido por título
 * y, en los documentos propios, orden y tipo. Los resultados de búsqueda sustituyen a las pestañas.
 *
 * Se mantiene viva (keepalive): al volver de un libro, un PDF o una ficha sigue tal cual estaba —pestaña,
 * categoría, búsqueda y desplazamiento (plugins/scroll-memory)— y solo refresca los datos en silencio.
 */
defineOptions({ name: 'LibraryPage' })
definePageMeta({ keepalive: true })

const t = useT()
const { favorites, loadFavorites } = useLibrary()

const status = ref<LibraryStatus | null>(null)
const books = ref<Probe<ZimBook[]> | null>(null)
const docs = ref<DocSummary[]>([])
const shelfMap = ref<LibraryShelfMap | null>(null)
const serviceDown = ref(false)
const loaded = ref(false)

const query = ref('')
const results = ref<SearchResults | null>(null)
const searching = ref(false)
const reindexing = ref(false)
type Filter = 'all' | SearchHit['source']
const filter = ref<Filter>('all')

/** Vista pública (punto de acceso, ADR 0009): solo la estantería Kiwix; sin búsqueda, documentos propios ni favoritos. */
const publicView = isPublicView()

async function load(): Promise<void> {
  // El mapa de categorías no es imprescindible: sin él todo va a «Otros».
  void $fetch<LibraryShelfMap>('/api/content/shelf', { timeout: 8000, retry: 0 }).then((m) => (shelfMap.value = m), () => {})
  try {
    const [st, bk, dc] = await Promise.all([
      $fetch<LibraryStatus>('/api/library/status', { timeout: 8000, retry: 0 }),
      $fetch<Probe<ZimBook[]>>('/api/library/books', { timeout: 8000, retry: 0 }),
      publicView ? Promise.resolve([] as DocSummary[]) : $fetch<DocSummary[]>('/api/library/docs', { timeout: 8000, retry: 0 }),
    ])
    status.value = st
    books.value = bk
    docs.value = dc
    serviceDown.value = false
  } catch {
    serviceDown.value = true
  } finally {
    loaded.value = true
  }
  if (!publicView) await loadFavorites()
}
const route = useRoute()
const router = useRouter()

/**
 * La búsqueda vive en la URL (/biblioteca?q=…&f=zim): al abrir un resultado y volver con «Atrás»
 * se recuperan los mismos resultados y filtro. Los últimos resultados quedan en memoria de la
 * sesión para no repetir la consulta al volver del lector.
 */
const lastResults = useState<SearchResults | null>('lib:lastResults', () => null)
const FILTERS: readonly Filter[] = ['all', 'protocol', 'doc', 'note', 'zim', 'history']

function syncUrl(): void {
  const q = results.value?.query
  const next: Record<string, string> = {}
  if (q) next.q = q
  if (q && filter.value !== 'all') next.f = filter.value
  void router.replace({ query: next })
}
watch(filter, syncUrl)

/** Búsqueda pedida en la URL: enlace directo (/biblioteca?q=deshidratación&f=zim) o vuelta desde el lector. */
async function applyQuery(): Promise<void> {
  const q = typeof route.query.q === 'string' ? route.query.q.trim() : ''
  if (!q) {
    // Se vuelve sin búsqueda en la URL (p. ej. desde Inicio) con una búsqueda en pantalla: se conserva y se anota.
    if (results.value) syncUrl()
    return
  }
  if (results.value?.query === q) return
  query.value = q
  if (lastResults.value?.query === q) results.value = lastResults.value
  else await runSearch()
  const f = route.query.f
  if (results.value && typeof f === 'string' && (FILTERS as readonly string[]).includes(f)) filter.value = f as Filter
}

onMounted(() => {
  loadRecent()
  void load()
  void applyQuery()
})

// Vuelta a la pantalla viva: datos al día (contenidos descargados entretanto) sin «Cargando…» ni perder el sitio.
let mounted = false
onActivated(() => {
  if (!mounted) {
    mounted = true
    return
  }
  void load()
  void applyQuery()
})

async function runSearch(): Promise<void> {
  const q = query.value.trim()
  if (!q) {
    clearSearch()
    return
  }
  searching.value = true
  try {
    results.value = await $fetch<SearchResults>('/api/library/search', { query: { q }, timeout: 15000, retry: 0 })
    lastResults.value = results.value
    rememberRecent(q)
    filter.value = 'all'
    syncUrl()
  } catch {
    serviceDown.value = true
  } finally {
    searching.value = false
  }
}

function clearSearch(): void {
  query.value = ''
  results.value = null
  filter.value = 'all'
  syncUrl()
}

/* ---------- Búsquedas recientes (solo en este navegador; se pueden quitar una a una o todas) ---------- */
const RECENT_KEY = 'survival:lib:recent'
const RECENT_MAX = 8
const recent = ref<string[]>([])

function loadRecent(): void {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    recent.value = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    recent.value = []
  }
}

function saveRecent(list: string[]): void {
  recent.value = list
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    else localStorage.removeItem(RECENT_KEY)
  } catch {
    // Sin almacenamiento: la lista vive solo en esta visita.
  }
}

function rememberRecent(q: string): void {
  const n = q.toLowerCase()
  saveRecent([q, ...recent.value.filter((x) => x.toLowerCase() !== n)].slice(0, RECENT_MAX))
}

function searchRecent(q: string): void {
  query.value = q
  void runSearch()
}

async function reindex(): Promise<void> {
  reindexing.value = true
  try {
    await postAction('/api/library/reindex')
    await load()
  } finally {
    reindexing.value = false
  }
}

const SOURCE_LABEL = computed<Record<SearchHit['source'], string>>(() => ({
  protocol: t('lib.source.protocol'),
  doc: t('lib.source.doc'),
  zim: t('lib.source.zim'),
  history: t('lib.source.history'),
  note: t('lib.source.note'),
}))
const SOURCE_TONE: Record<SearchHit['source'], string> = {
  protocol: 'tone-warn',
  doc: 'tone-info',
  zim: 'tone-ok',
  history: 'tone-muted',
  note: 'tone-info',
}
const SOURCE_KEY: Record<keyof SearchResults['sources'], SearchHit['source']> = {
  protocols: 'protocol',
  docs: 'doc',
  zim: 'zim',
  history: 'history',
  notes: 'note',
}

const filters = computed(() => {
  const hits = results.value?.hits ?? []
  const count = (s: SearchHit['source']): number => hits.filter((h) => h.source === s).length
  return (['protocol', 'doc', 'note', 'zim', 'history'] as const)
    .map((s) => ({ key: s, label: SOURCE_LABEL.value[s], n: count(s) }))
    .filter((f) => f.n > 0)
})
const visibleHits = computed(() => (results.value?.hits ?? []).filter((h) => filter.value === 'all' || h.source === filter.value))
const failedSources = computed(() =>
  Object.entries(results.value?.sources ?? {})
    // Historial desactivado por el usuario: es una elección, no un fallo que avisar.
    .filter(([k, p]) => p.state !== 'ok' && k !== 'history')
    .map(([k, p]) => `${SOURCE_LABEL.value[SOURCE_KEY[k as keyof SearchResults['sources']]]}: ${p.state === 'ok' ? '' : translateServer(p.reason)}`),
)

function hitTarget(href: string): string {
  return href.startsWith('/kiwix/') ? `/biblioteca/leer?u=${encodeURIComponent(href)}` : href
}

/* ---------- Estantería por categorías ---------- */
type View = 'books' | 'manuals' | 'own'
/** Pestaña, categoría, filtro y manual abierto sobreviven a abrir un documento y volver. */
const view = useState<View>('lib:view', () => 'books')
const categoryBy = useState<Record<View, string | null>>('lib:category', () => ({ books: null, manuals: null, own: null }))
const filterText = useState<string>('lib:filterText', () => '')
const sort = useState<DocSort>('lib:sort', () => 'name')
const kind = useState<DocKind | null>('lib:kind', () => null)
const openManualId = useState<string | null>('lib:manual', () => null)
const category = computed<string | null>({
  get: () => categoryBy.value[view.value],
  set: (v) => (categoryBy.value = { ...categoryBy.value, [view.value]: v }),
})

const lang = bcp47()
const bookList = computed(() => (books.value?.state === 'ok' ? books.value.value : []))
const sizeByFile = computed(() => new Map((status.value?.zim?.installed ?? []).map((z) => [z.file, z.sizeBytes])))
const downloads = computed(() => status.value?.zim?.downloads ?? [])
const shelf = computed(() => classifyBooks(bookList.value, shelfMap.value))
const split = computed(() => splitDocs(docs.value, shelfMap.value))

interface Look { icon: Component; color: string }
const BOOK_LOOKS: Record<string, Look> = {
  salud: { icon: HeartPulse, color: 'var(--danger)' },
  preparacion: { icon: Tent, color: 'var(--warn)' },
  saber: { icon: Globe, color: 'var(--info)' },
  oficios: { icon: Wrench, color: 'var(--maint)' },
  libros: { icon: BookOpen, color: 'var(--lib-violet)' },
}
const TOPIC_LOOKS: Record<string, Look> = {
  medicina: { icon: Stethoscope, color: 'var(--danger)' },
  familia: { icon: Baby, color: 'var(--lib-rose)' },
  mente: { icon: Brain, color: 'var(--lib-violet)' },
  agua: { icon: Droplet, color: 'var(--info)' },
  alimentos: { icon: Sprout, color: 'var(--ok)' },
  riesgos: { icon: Siren, color: 'var(--warn)' },
  campo: { icon: Compass, color: 'var(--accent)' },
  radio: { icon: Radio, color: 'var(--maint)' },
}
const OTHER_LOOK: Look = { icon: Library, color: 'var(--text-muted)' }

interface Section<T> { id: string; label: string; look: Look; items: T[] }

function bookGroupLabel(id: string): string {
  if (id === OTHER) return t('lib.group.otros')
  return shelfMap.value?.groups.find((g) => g.id === id)?.title ?? id
}
function folderLabel(id: string): string {
  return id === '' ? t('lib.own.root') : id
}

const bookSections = computed<Section<ShelfBook>[]>(() =>
  groupBooks(shelf.value, lang).map((g) => ({ id: g.id, label: bookGroupLabel(g.id), look: BOOK_LOOKS[g.id] ?? OTHER_LOOK, items: g.items })),
)
const manualSections = computed<Section<ManualEntry>[]>(() =>
  groupManuals(split.value.manuals, lang).map((g) => ({
    id: g.id, label: t(`lib.topic.${g.id}` as MessageKey), look: TOPIC_LOOKS[g.id] ?? { ...OTHER_LOOK, icon: FileText }, items: g.items,
  })),
)
const ownKinds = computed(() => [...new Set(split.value.own.map((d) => d.kind))].sort())
const ownSections = computed<Section<DocSummary>[]>(() =>
  groupOwnDocs(split.value.own.filter((d) => !kind.value || d.kind === kind.value), sort.value, lang).map((f) => ({
    id: f.id || '/', label: folderLabel(f.id), look: { icon: f.id ? Folder : FileText, color: 'var(--info)' }, items: f.docs,
  })),
)

const counts = computed<Record<View, number>>(() => ({
  books: bookList.value.length + downloads.value.length,
  manuals: split.value.manuals.length,
  own: split.value.own.length,
}))
const tabs = computed(() => [
  { id: 'books' as const, label: t('lib.view.books'), icon: LibraryBig },
  { id: 'manuals' as const, label: t('lib.view.manuals'), icon: FileText },
  { id: 'own' as const, label: t('lib.view.own'), icon: FolderOpen },
])

/** Secciones de la pestaña activa antes de filtrar (para la barra lateral y sus números). */
const sections = computed<Section<ShelfBook | ManualEntry | DocSummary>[]>(() =>
  view.value === 'books' ? bookSections.value : view.value === 'manuals' ? manualSections.value : ownSections.value,
)
function matchItem(item: ShelfBook | ManualEntry | DocSummary, q: string): boolean {
  if ('book' in item) return matches(q, item.book.title, item.book.description)
  if ('docs' in item) return matches(q, item.title, item.publisher, item.description, item.chapterTitles.join(' '))
  return matches(q, item.title, item.path)
}
const shown = computed(() =>
  sections.value
    .filter((s) => category.value === null || s.id === category.value)
    .map((s) => ({ ...s, items: s.items.filter((i) => matchItem(i, filterText.value)) }))
    .filter((s) => s.items.length),
)
const shownCount = computed(() => shown.value.reduce((n, s) => n + s.items.length, 0))
const totalCount = computed(() => sections.value.reduce((n, s) => n + s.items.length, 0))
const filtering = computed(() => !!filterText.value.trim())

const openManual = computed(() => (openManualId.value ? split.value.manuals.find((m) => m.id === openManualId.value) ?? null : null))
const openManualLook = computed(() => (openManual.value ? TOPIC_LOOKS[openManual.value.topic] ?? OTHER_LOOK : OTHER_LOOK))

const filterLabel = computed(() => t(view.value === 'books' ? 'lib.filter.books' : view.value === 'manuals' ? 'lib.filter.manuals' : 'lib.filter.own'))

function setView(v: View): void {
  view.value = v
  openManualId.value = null
  filterText.value = ''
}
function setCategory(id: string | null): void {
  category.value = id
  openManualId.value = null
}
function resetFilters(): void {
  filterText.value = ''
  category.value = null
  kind.value = null
}
// Una categoría que ya no existe (se borró su último elemento) vuelve a «Todo».
watch(sections, (list) => {
  if (loaded.value && category.value !== null && !list.some((s) => s.id === category.value)) category.value = null
})
watch(openManual, (m) => {
  if (loaded.value && openManualId.value && !m) openManualId.value = null
})

function flavourLabel(f: string): string | null {
  const key = `lib.flavour.${f}` as MessageKey
  return f && ['maxi', 'nopic', 'mini'].includes(f) ? t(key) : null
}

/** 4858 → "4,9 mil"; 4232639 → "4,2 M": cabe en la tarjeta a 1024 px. */
const COMPACT = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 })
const DATE = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' })

function bookMeta(b: ZimBook): string {
  const parts: string[] = []
  if (b.articleCount) parts.push(`${COMPACT.format(b.articleCount)} ${t('lib.articles')}`)
  const size = sizeByFile.value.get(`${b.id}.zim`)
  if (size) parts.push(formatBytes(size))
  return parts.join(' · ')
}
function manualMeta(m: ManualEntry): string {
  const parts: string[] = []
  if (m.docs.length > 1) parts.push(t('lib.manual.chapters', { n: m.docs.length }))
  if (m.sizeBytes) parts.push(formatBytes(m.sizeBytes))
  return parts.join(' · ')
}
function docDate(d: DocSummary): string {
  const date = new Date(d.modifiedAt)
  return Number.isNaN(date.getTime()) ? '' : DATE.format(date)
}

/** Imágenes que no cargan (icono ausente en el ZIM) → inicial. */
const brokenIcons = ref(new Set<string>())

const KIND_TONE: Record<DocKind, string> = { pdf: 'tone-danger', md: 'tone-info', html: 'tone-warn', txt: 'tone-muted' }
</script>

<template>
  <div class="page lib">
    <PageHeader :title="t('module.library')" :icon="BookOpen" :phase="3">
      <form v-if="!publicView" class="search" role="search" @submit.prevent="runSearch">
        <Search :size="20" aria-hidden="true" class="search-icon" />
        <input
          v-model="query"
          type="search"
          :placeholder="t('lib.search')"
          :aria-label="t('lib.search')"
          enterkeyhint="search"
          class="selectable"
        />
        <button v-if="query" type="button" class="icon-btn" :aria-label="t('lib.search.clear')" @click="clearSearch">
          <X :size="20" aria-hidden="true" />
        </button>
        <button type="submit" class="btn btn-primary" :disabled="searching || !query.trim()">
          {{ searching ? t('state.loading') : t('lib.search.go') }}
        </button>
      </form>
      <NuxtLink v-if="!publicView" to="/biblioteca/notas" class="btn" :title="t('notes.hint')">
        <NotebookPen :size="20" aria-hidden="true" />
        {{ t('notes.title') }}
      </NuxtLink>
      <NuxtLink v-if="!publicView" to="/biblioteca/preguntar" class="btn ask" :title="t('lib.ask.hint')">
        <Bot :size="20" aria-hidden="true" />
        {{ t('lib.ask.short') }}
      </NuxtLink>
    </PageHeader>

    <div v-if="serviceDown" class="notice tone-danger">
      <Library :size="18" aria-hidden="true" />
      <span>{{ t('lib.serviceDown') }}</span>
    </div>

    <!-- Resultados: sustituyen a la estantería mientras hay búsqueda activa. -->
    <section v-if="results" class="results" :aria-label="t('lib.results')">
      <header class="results-head">
        <button type="button" class="btn" @click="clearSearch">
          <ArrowLeft :size="20" aria-hidden="true" />
          {{ t('lib.results.back') }}
        </button>
        <div class="chips" role="tablist">
          <button
            type="button"
            role="tab"
            class="chip"
            :aria-selected="filter === 'all'"
            @click="filter = 'all'"
          >
            {{ t('lib.filter.all') }} <span class="mono">{{ results.hits.length }}</span>
          </button>
          <button
            v-for="f in filters"
            :key="f.key"
            type="button"
            role="tab"
            class="chip"
            :class="SOURCE_TONE[f.key]"
            :aria-selected="filter === f.key"
            @click="filter = f.key"
          >
            {{ f.label }} <span class="mono">{{ f.n }}</span>
          </button>
        </div>
        <span class="results-q faint">«{{ results.query }}»</span>
      </header>
      <p v-if="failedSources.length" class="faint small">{{ failedSources.join(' · ') }}</p>

      <div v-if="!results.hits.length" class="empty">
        <SearchX :size="34" aria-hidden="true" />
        <p>{{ t('lib.results.none') }}</p>
      </div>
      <div v-else class="hits">
        <NuxtLink v-for="(h, i) in visibleHits" :key="i" :to="hitTarget(h.href)" class="hit" :class="SOURCE_TONE[h.source]">
          <span class="hit-head">
            <strong class="clamp-1">{{ h.title }}</strong>
            <span class="hit-src">{{ h.bookTitle || SOURCE_LABEL[h.source] }}</span>
          </span>
          <SnippetText v-if="h.snippet" :text="h.snippet" class="hit-snippet clamp-2" />
        </NuxtLink>
      </div>
    </section>

    <template v-else>
      <!-- Favoritos: tira horizontal, un toque para abrir. -->
      <nav v-if="favorites.length && !publicView" class="favs" :aria-label="t('lib.favorites')">
        <span class="favs-label"><Star :size="18" aria-hidden="true" /> {{ t('lib.favorites') }}</span>
        <div class="favs-track">
          <NuxtLink v-for="f in favorites" :key="f.id" :to="hitTarget(f.href)" class="fav-chip">{{ f.title }}</NuxtLink>
        </div>
      </nav>

      <!-- Búsquedas recientes: un toque repite la búsqueda; × la quita. -->
      <nav v-if="recent.length && !publicView" class="favs" :aria-label="t('lib.recent')">
        <span class="favs-label recent-label"><Clock :size="18" aria-hidden="true" /> {{ t('lib.recent') }}</span>
        <div class="favs-track">
          <span v-for="r in recent" :key="r" class="recent-chip">
            <button type="button" class="recent-go" @click="searchRecent(r)">{{ r }}</button>
            <button
              type="button"
              class="recent-x"
              :aria-label="t('lib.recent.remove', { q: r })"
              @click="saveRecent(recent.filter((x) => x !== r))"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </span>
        </div>
        <button type="button" class="btn btn-ghost" @click="saveRecent([])">{{ t('lib.recent.clear') }}</button>
      </nav>

      <!-- Secciones: pestañas grandes con su número. En la vista pública solo hay enciclopedias. -->
      <div v-if="!publicView" class="tabs" role="tablist" :aria-label="t('lib.view.label')">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab"
          :class="`tab-${tab.id}`"
          :aria-selected="view === tab.id"
          @click="setView(tab.id)"
        >
          <span class="tab-icon"><component :is="tab.icon" :size="22" aria-hidden="true" /></span>
          <span class="tab-label">{{ tab.label }}</span>
          <span class="tab-count mono">{{ counts[tab.id] }}</span>
        </button>
      </div>

      <div class="browser" :class="`view-${publicView ? 'books' : view}`">
        <!-- Categorías: columna fija en pantallas anchas; tira desplazable en estrechas. -->
        <aside v-if="sections.length > 1" class="cats" :aria-label="t('lib.cat.label')">
          <h2 class="cap">{{ t('lib.cat.label') }}</h2>
          <div class="cat-list" role="group">
            <button type="button" class="cat" :aria-pressed="category === null" @click="setCategory(null)">
              <Layers :size="22" aria-hidden="true" />
              <span class="cat-label">{{ t('lib.cat.all') }}</span>
              <span class="cat-n mono">{{ totalCount }}</span>
            </button>
            <button
              v-for="s in sections"
              :key="s.id"
              type="button"
              class="cat"
              :aria-pressed="category === s.id"
              :style="{ '--cat': s.look.color }"
              @click="setCategory(s.id)"
            >
              <component :is="s.look.icon" :size="22" aria-hidden="true" />
              <span class="cat-label">{{ s.label }}</span>
              <span class="cat-n mono">{{ s.items.length }}</span>
            </button>
          </div>
        </aside>

        <div class="main">
          <!-- Capítulos de un manual abierto -->
          <section v-if="view === 'manuals' && openManual && !publicView" class="manual-open" :style="{ '--cat': openManualLook.color }">
            <button type="button" class="btn back" @click="openManualId = null">
              <ArrowLeft :size="20" aria-hidden="true" />{{ t('lib.manual.back') }}
            </button>
            <header class="manual-hero">
              <span class="spine"><component :is="openManualLook.icon" :size="34" aria-hidden="true" /></span>
              <div>
                <h2>{{ openManual.title }}</h2>
                <p v-if="openManual.publisher || manualMeta(openManual)" class="faint">
                  {{ [openManual.publisher, manualMeta(openManual)].filter(Boolean).join(' · ') }}
                </p>
                <p v-if="openManual.description" class="manual-desc">{{ openManual.description }}</p>
              </div>
            </header>
            <ol class="chapters">
              <li v-for="(d, i) in openManual.docs" :key="d.id">
                <NuxtLink :to="`/biblioteca/doc/${d.id}`" class="chapter">
                  <span class="chapter-n mono">{{ i + 1 }}</span>
                  <span class="chapter-title">{{ openManual.chapterTitles[i] }}</span>
                  <span class="faint small mono">{{ formatBytes(d.sizeBytes) }}</span>
                  <ChevronRight :size="20" class="chev" aria-hidden="true" />
                </NuxtLink>
              </li>
            </ol>
          </section>

          <template v-else>
            <div v-if="totalCount" class="tools">
              <label class="filter">
                <Search :size="20" aria-hidden="true" />
                <input v-model="filterText" type="search" class="selectable" :placeholder="filterLabel" :aria-label="filterLabel" />
                <button v-if="filterText" type="button" class="icon-btn" :aria-label="t('lib.filter.clear')" @click="filterText = ''">
                  <X :size="18" aria-hidden="true" />
                </button>
              </label>
              <template v-if="view === 'own' && !publicView">
                <div v-if="ownKinds.length > 1" class="seg" role="group">
                  <button type="button" :aria-pressed="kind === null" @click="kind = null">{{ t('lib.kind.all') }}</button>
                  <button v-for="k in ownKinds" :key="k" type="button" class="mono" :aria-pressed="kind === k" @click="kind = k">{{ k.toUpperCase() }}</button>
                </div>
                <label class="sort">
                  <span class="sr-only">{{ t('lib.sort.label') }}</span>
                  <select v-model="sort" :aria-label="t('lib.sort.label')">
                    <option value="name">{{ t('lib.sort.name') }}</option>
                    <option value="recent">{{ t('lib.sort.recent') }}</option>
                    <option value="size">{{ t('lib.sort.size') }}</option>
                  </select>
                </label>
              </template>
              <NuxtLink v-if="!publicView && view !== 'own'" to="/sistema/mantenimiento#mnt-content" class="btn btn-ghost" :title="t('lib.manage')">
                <Settings2 :size="18" aria-hidden="true" />
                <span class="lbl">{{ t('lib.shelf.manage') }}</span>
              </NuxtLink>
            </div>

            <!-- Vacíos: qué hacer, no un mensaje técnico. -->
            <div v-if="loaded && view === 'books' && !bookList.length && !downloads.length" class="shelf-empty">
              <LibraryBig :size="34" aria-hidden="true" />
              <p>{{ t('lib.shelf.empty') }}</p>
              <NuxtLink v-if="!publicView" to="/sistema/mantenimiento#mnt-content" class="btn btn-primary">
                <Download :size="18" aria-hidden="true" />{{ t('lib.shelf.download') }}
              </NuxtLink>
              <small v-if="books && books.state !== 'ok'" class="faint">{{ translateServer(books.reason) }}</small>
            </div>
            <div v-else-if="loaded && view === 'manuals' && !totalCount && !publicView" class="shelf-empty">
              <FileText :size="34" aria-hidden="true" />
              <p>{{ t('lib.manuals.empty') }}</p>
              <NuxtLink to="/sistema/mantenimiento#mnt-content" class="btn btn-primary">
                <Download :size="18" aria-hidden="true" />{{ t('lib.manuals.download') }}
              </NuxtLink>
            </div>
            <div v-else-if="loaded && view === 'own' && !totalCount && !publicView" class="shelf-empty">
              <FolderOpen :size="34" aria-hidden="true" />
              <p><strong>{{ t('lib.docs.empty') }}</strong></p>
              <p v-if="status" class="small">{{ t('lib.docs.where', { dir: status.docsDir }) }}</p>
            </div>
            <div v-else-if="totalCount && !shown.length" class="empty" role="status">
              <SearchX :size="32" aria-hidden="true" />
              <p>{{ t('lib.filter.none', { q: filterText }) }}</p>
              <button type="button" class="btn" @click="resetFilters">{{ t('lib.filter.reset') }}</button>
            </div>

            <p v-if="filtering && shown.length" class="faint small" aria-live="polite">{{ t('lib.count', { n: shownCount }) }}</p>

            <section
              v-for="s in shown"
              :key="s.id"
              class="group"
              :style="{ '--cat': s.look.color }"
              :aria-label="s.label"
            >
              <h3 v-if="category === null && sections.length > 1" class="group-head">
                <span class="group-icon"><component :is="s.look.icon" :size="18" aria-hidden="true" /></span>
                {{ s.label }}
                <small class="mono">{{ s.items.length }}</small>
              </h3>

              <!-- Enciclopedias -->
              <div v-if="view === 'books' || publicView" class="grid grid-books">
                <NuxtLink
                  v-for="item in (s.items as ShelfBook[])"
                  :key="item.book.id"
                  :to="`/biblioteca/leer?u=${encodeURIComponent(item.book.readerPath)}`"
                  class="card book"
                >
                  <span class="cover">
                    <img
                      v-if="item.book.icon && !brokenIcons.has(item.book.id)"
                      :src="item.book.icon"
                      alt=""
                      width="60"
                      height="60"
                      loading="lazy"
                      @error="brokenIcons.add(item.book.id)"
                    />
                    <span v-else class="initial" aria-hidden="true">{{ item.book.title.charAt(0) }}</span>
                  </span>
                  <span class="card-body">
                    <strong class="clamp-2">{{ item.book.title }}</strong>
                    <span class="card-desc clamp-2">{{ item.book.description }}</span>
                    <span class="card-meta">
                      <span v-if="flavourLabel(item.book.flavour)" class="tag" :class="item.book.flavour === 'maxi' ? 'tone-info' : 'tone-muted'">
                        {{ flavourLabel(item.book.flavour) }}
                      </span>
                      <span class="nums">{{ bookMeta(item.book) }}</span>
                    </span>
                  </span>
                  <ChevronRight :size="22" class="chev" aria-hidden="true" />
                </NuxtLink>
              </div>

              <!-- Manuales: una tarjeta por libro; los de capítulos abren su índice. -->
              <div v-else-if="view === 'manuals'" class="grid grid-manuals">
                <component
                  :is="item.docs.length > 1 ? 'button' : resolveComponent('NuxtLink')"
                  v-for="item in (s.items as ManualEntry[])"
                  :key="item.id"
                  v-bind="item.docs.length > 1 ? { type: 'button', onClick: () => (openManualId = item.id) } : { to: `/biblioteca/doc/${item.docs[0]!.id}` }"
                  class="card manual"
                >
                  <span class="spine"><component :is="(TOPIC_LOOKS[item.topic] ?? OTHER_LOOK).icon" :size="24" aria-hidden="true" /></span>
                  <span class="card-body">
                    <strong class="clamp-2">{{ item.title }}</strong>
                    <span v-if="item.publisher" class="card-pub clamp-1">{{ item.publisher }}</span>
                    <span class="card-meta">
                      <span class="tag tone-danger mono">PDF</span>
                      <span class="nums">{{ manualMeta(item) }}</span>
                    </span>
                  </span>
                  <ChevronRight :size="20" class="chev" aria-hidden="true" />
                </component>
              </div>

              <!-- Documentos propios -->
              <div v-else class="grid grid-docs">
                <NuxtLink v-for="d in (s.items as DocSummary[])" :key="d.id" :to="`/biblioteca/doc/${d.id}`" class="card doc">
                  <span class="kind mono" :class="KIND_TONE[d.kind]">{{ d.kind.toUpperCase() }}</span>
                  <span class="card-body">
                    <strong class="clamp-2">{{ d.title }}</strong>
                    <span class="card-meta">
                      <span class="nums">{{ formatBytes(d.sizeBytes) }}</span>
                      <span v-if="docDate(d)">· {{ docDate(d) }}</span>
                      <span v-if="!d.searchable" class="tag tone-warn">{{ t('lib.docs.notSearchable') }}</span>
                    </span>
                  </span>
                  <ChevronRight :size="18" class="chev" aria-hidden="true" />
                </NuxtLink>
              </div>
            </section>

            <!-- Descargas de enciclopedias en curso -->
            <div v-if="view === 'books' && downloads.length && category === null && !filtering" class="grid grid-books pending-list">
              <div v-for="d in downloads" :key="d.file" class="card book pending" aria-busy="true">
                <span class="cover"><Download :size="28" aria-hidden="true" /></span>
                <span class="card-body">
                  <strong class="clamp-1 mono">{{ d.file.replace(/\.zim(\.part)?$/, '') }}</strong>
                  <span class="card-meta">{{ t('lib.shelf.downloading', { size: formatBytes(d.bytes) }) }}</span>
                </span>
              </div>
            </div>

            <footer v-if="view === 'own' && !publicView && totalCount" class="own-foot">
              <p v-if="status" class="faint small">{{ t('lib.docs.where', { dir: status.docsDir }) }}</p>
              <button type="button" class="btn btn-ghost" :disabled="reindexing || serviceDown" @click="reindex">
                <RefreshCw :size="18" :class="{ spin: reindexing }" aria-hidden="true" />
                {{ reindexing ? t('state.loading') : t('lib.reindex') }}
              </button>
            </footer>
            <footer v-else-if="view === 'own' && !publicView" class="own-foot">
              <button type="button" class="btn btn-ghost" :disabled="reindexing || serviceDown" @click="reindex">
                <RefreshCw :size="18" :class="{ spin: reindexing }" aria-hidden="true" />
                {{ reindexing ? t('state.loading') : t('lib.reindex') }}
              </button>
            </footer>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lib {
  --lib-violet: #b9a3e8;
  --lib-rose: #e8a3c4;
}

/* ---------- Cabecera: buscador y asistente en la misma fila ---------- */
.search {
  /* Comparte fila con el título si cabe (≥ 18 rem); si no, baja a su propia fila a ancho completo. */
  flex: 1 1 18rem;
  min-width: min(100%, 18rem);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--touch);
  padding: 0.2rem 0.25rem 0.2rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: border-color 0.15s;
}

.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.search-icon {
  flex: none;
  color: var(--text-faint);
}

.search input {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 1.05rem;
  outline: none;
}

.search input::-webkit-search-cancel-button,
.filter input::-webkit-search-cancel-button {
  display: none;
}

.search .btn-primary {
  border-radius: 999px;
  min-height: 2.75rem; /* ≥ 44 px táctil */
}

.icon-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.icon-btn:active {
  background: var(--surface-3);
}

.ask {
  flex: none;
  border-radius: 999px;
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  color: var(--text);
  text-decoration: none;
}

.ask svg {
  color: var(--accent);
}

.notice {
  margin-bottom: 0.7rem;
}

/* ---------- Favoritos y recientes ---------- */
.favs {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
  min-width: 0;
}

.favs-label {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--warn);
  font-weight: 700;
  font-size: 0.9rem;
}

.favs-label svg {
  fill: var(--warn);
}

.favs-track {
  display: flex;
  gap: 0.45rem;
  overflow-x: auto;
  touch-action: pan-x;
  scrollbar-width: none;
  min-width: 0;
  mask-image: linear-gradient(90deg, #000 92%, transparent);
}

.fav-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  max-width: 16rem;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  padding: 0 0.95rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border));
  background: color-mix(in srgb, var(--warn) 8%, var(--surface));
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-label {
  color: var(--info);
}

.recent-label svg {
  fill: none;
}

.recent-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--info) 35%, var(--border));
  background: color-mix(in srgb, var(--info) 7%, var(--surface));
  overflow: hidden;
}

.recent-go,
.recent-x {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.recent-go {
  max-width: 13rem;
  padding: 0 0.3rem 0 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-x {
  justify-content: center;
  width: 2.4rem;
  color: var(--text-faint);
}

.recent-go:active,
.recent-x:active {
  background: var(--surface-3);
}

.fav-chip:active,
.recent-chip:active,
.chip:active {
  transform: scale(0.97);
}

.btn-ghost {
  flex: none;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  padding: 0 0.75rem;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
  text-decoration: none;
}

.btn-ghost:active {
  background: var(--surface-3);
}

/* ---------- Pestañas de sección ---------- */
.tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.tab {
  --tab: var(--accent);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  min-height: 3.1rem;
  padding: 0.35rem 0.8rem 0.35rem 0.4rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  font-size: 1.05rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.tab-manuals {
  --tab: var(--danger);
}

.tab-own {
  --tab: var(--info);
}

.tab-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.35rem;
  height: 2.35rem;
  border-radius: var(--radius-sm);
  color: var(--tab);
  background: color-mix(in srgb, var(--tab) 12%, transparent);
}

.tab-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-count {
  flex: none;
  min-width: 2rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
}

.tab[aria-selected='true'] {
  border-color: color-mix(in srgb, var(--tab) 55%, var(--border));
  background: linear-gradient(115deg, color-mix(in srgb, var(--tab) 20%, var(--surface-2)), var(--surface-2));
  color: var(--text);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent);
}

.tab[aria-selected='true'] .tab-count {
  background: color-mix(in srgb, var(--tab) 28%, var(--surface-3));
  color: var(--text);
}

.tab:active {
  transform: scale(0.98);
}

/* ---------- Navegador: categorías + contenido ---------- */
.browser {
  display: grid;
  grid-template-columns: clamp(12rem, 20vw, 16.5rem) minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}

.browser:not(:has(.cats)) {
  grid-template-columns: minmax(0, 1fr);
}

.cats {
  position: sticky;
  top: 0;
  max-height: calc(100dvh - var(--bar-h) - var(--action-h) - 1.5rem);
  overflow-y: auto;
  padding: 0.7rem 0.55rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-grad);
}

.cap {
  margin: 0 0 0.5rem 0.35rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.cat-list {
  display: grid;
  gap: 0.3rem;
}

.cat {
  --cat: var(--accent);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: var(--touch);
  padding: 0.35rem 0.6rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.98rem;
  font-weight: 700;
  line-height: 1.15;
  text-align: left;
  cursor: pointer;
}

.cat > svg {
  flex: none;
  color: var(--cat);
}

.cat-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cat-n {
  flex: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.cat:active {
  background: var(--surface-3);
}

.cat[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--cat) 60%, var(--border));
  background: linear-gradient(115deg, color-mix(in srgb, var(--cat) 24%, var(--surface)), color-mix(in srgb, var(--cat) 9%, var(--surface)));
}

.cat[aria-pressed='true'] .cat-n {
  color: var(--text);
}

.main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.filter {
  flex: 1 1 15rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  min-height: var(--touch);
  padding: 0 0.3rem 0 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-faint);
}

.filter:focus-within {
  border-color: var(--accent);
}

.filter input {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
}

.seg {
  display: inline-flex;
  flex: none;
  padding: 0.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.seg button {
  min-width: 2.75rem;
  min-height: 2.5rem;
  padding: 0 0.65rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.seg button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--info) 22%, var(--surface-3));
  color: var(--text);
}

.sort select {
  min-height: var(--touch);
  padding: 0 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ---------- Grupos ---------- */
.group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.group + .group {
  margin-top: 0.35rem;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--hairline);
  font-size: 1.08rem;
  line-height: 1.2;
}

.group-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--radius-sm);
  color: var(--cat);
  background: color-mix(in srgb, var(--cat) 15%, transparent);
}

.group-head small {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.grid {
  display: grid;
  gap: 0.6rem;
}

.grid-books {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
}

.grid-manuals {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
}

.grid-docs {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
}

/* ---------- Tarjetas ---------- */
.card {
  --cat-tint: color-mix(in srgb, var(--cat, var(--accent)) 9%, transparent);
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-width: 0;
  padding: 0.65rem 0.55rem 0.65rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(70% 90% at 100% 100%, var(--cat-tint), transparent 70%),
    var(--surface-grad);
  color: var(--text);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, transform 0.08s ease-out;
}

.card:hover {
  border-color: color-mix(in srgb, var(--cat, var(--accent)) 45%, var(--border));
}

.card:active {
  background: var(--surface-3);
  border-color: var(--cat, var(--accent));
  transform: scale(0.98);
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.card-body strong {
  font-size: 1.02rem;
  line-height: 1.22;
}

.card-desc {
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.3;
}

.card-pub {
  color: var(--cat, var(--text-muted));
  font-size: 0.82rem;
  font-weight: 700;
}

/* Los datos nunca se cortan: si no caben junto a la etiqueta, bajan de línea. */
.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.15rem 0.4rem;
  min-width: 0;
  color: var(--text-faint);
  font-size: 0.78rem;
}

.tag {
  flex: none;
  padding: 0.02rem 0.4rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--tone) 50%, transparent);
  color: var(--tone);
  font-size: 0.7rem;
  font-weight: 700;
  white-space: nowrap;
}

.nums {
  font-variant-numeric: tabular-nums;
}

.chev {
  flex: none;
  color: var(--text-faint);
}

/* Enciclopedia: portada tipo lomo de libro, papel claro (los iconos de Kiwix son a color). */
.book {
  min-height: 6.2rem;
}

.cover {
  flex: none;
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 0.9rem;
  background: linear-gradient(160deg, #fbf9f3, #ebe6d8);
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.08),
    0 0 0 3px color-mix(in srgb, var(--cat, var(--accent)) 22%, transparent);
}

.cover img {
  width: 3.6rem;
  height: 3.6rem;
  object-fit: contain;
}

.initial {
  color: #1d2a24;
  font-size: 2rem;
  font-weight: 700;
}

.book.pending {
  border-style: dashed;
  background: transparent;
}

.book.pending .cover {
  background: var(--surface-3);
  color: var(--info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 14%, transparent);
}

/* Manual: lomo de color del tema con su icono. */
.manual {
  min-height: 5.4rem;
  align-items: stretch;
}

.spine {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.2rem;
  border-radius: 0.6rem 0.35rem 0.35rem 0.6rem;
  background: linear-gradient(180deg, color-mix(in srgb, var(--cat) 30%, var(--surface-2)), color-mix(in srgb, var(--cat) 14%, var(--surface)));
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--cat) 70%, transparent);
  color: var(--cat);
}

.manual .card-body {
  justify-content: center;
}

.manual .chev {
  align-self: center;
}

/* Documento propio */
.doc {
  min-height: 4.4rem;
}

.kind {
  flex: none;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: 0.7rem;
  font-weight: 700;
}

/* ---------- Manual abierto: índice de capítulos ---------- */
.manual-open {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.back {
  align-self: flex-start;
}

.manual-hero {
  display: flex;
  gap: 1rem;
  padding: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--cat) 40%, var(--border));
  border-radius: var(--radius-lg);
  background:
    radial-gradient(80% 120% at 100% 0%, color-mix(in srgb, var(--cat) 12%, transparent), transparent 70%),
    var(--surface-grad);
}

.manual-hero .spine {
  width: 4rem;
  min-height: 5rem;
}

.manual-hero h2 {
  font-size: 1.3rem;
  line-height: 1.2;
}

.manual-desc {
  margin-top: 0.35rem;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.35;
}

.chapters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: 0 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chapter {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 3.2rem;
  padding: 0.35rem 0.4rem;
  border-bottom: 1px solid var(--hairline);
  color: var(--text);
  text-decoration: none;
}

.chapter:active {
  background: var(--surface-3);
}

.chapter-n {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--cat) 70%, transparent);
  color: var(--cat);
  font-size: 0.8rem;
}

.chapter-title {
  flex: 1;
  min-width: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

/* ---------- Pie y vacíos ---------- */
.own-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--hairline);
}

.own-foot p {
  flex: 1 1 16rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.own-foot .btn-ghost {
  border: 1px dashed var(--border);
}

.shelf-empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 1rem;
  padding: 1rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border);
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

.shelf-empty > svg {
  flex: none;
  color: var(--text-faint);
}

.shelf-empty p {
  flex: 1 1 16rem;
  color: var(--text);
}

.shelf-empty small,
.shelf-empty .small {
  flex-basis: 100%;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.45rem;
  padding: 1.1rem 1rem;
  border-radius: var(--radius);
  border: 1px dashed var(--border);
  color: var(--text-muted);
}

.empty svg {
  color: var(--text-faint);
}

/* ---------- Resultados ---------- */
.results {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.results-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.chips {
  flex: 1;
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  touch-action: pan-x;
  scrollbar-width: none;
  min-width: 0;
}

.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.75rem; /* ≥ 44 px táctil */
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 700;
  cursor: pointer;
}

.chip .mono {
  font-size: 0.8rem;
  color: var(--tone, var(--text-faint));
}

.chip[aria-selected='true'] {
  border-color: var(--tone, var(--accent));
  background: color-mix(in srgb, var(--tone, var(--accent)) 16%, var(--surface));
  color: var(--text);
}

.results-q {
  flex: none;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hits {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: 0.5rem;
}

.hit {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: var(--touch);
  padding: 0.6rem 0.8rem 0.65rem 0.9rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  border-left: 4px solid var(--tone);
  background: var(--surface-grad);
  transition: transform 0.08s ease-out;
  color: var(--text);
  text-decoration: none;
  min-width: 0;
}

.hit:active {
  background: var(--surface-2);
  transform: scale(0.97);
}

.hit-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}

.hit-head strong {
  min-width: 0;
}

.hit-src {
  flex: none;
  max-width: 45%;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tone);
  font-size: 0.78rem;
  font-weight: 700;
}

.hit-snippet {
  color: var(--text-muted);
  font-size: 0.88rem;
}

/* ---------- Utilidades ---------- */
.small {
  font-size: 0.82rem;
}

.clamp-1 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- Pantallas estrechas: categorías en tira horizontal ---------- */
@media (max-width: 820px) {
  .browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .cats {
    position: static;
    max-height: none;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .cap {
    display: none;
  }

  .cat-list {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    touch-action: pan-x;
    scrollbar-width: none;
    mask-image: linear-gradient(90deg, #000 90%, transparent);
  }

  .cat {
    flex: none;
    width: auto;
    border-color: var(--border);
    border-radius: 999px;
    background: var(--surface);
    white-space: nowrap;
  }

  .cat-label {
    overflow-wrap: normal;
  }
}

@media (max-width: 640px) {
  .search {
    order: 3;
    flex-basis: 100%;
  }

  .tools .lbl {
    display: none;
  }

  .tab {
    flex-direction: column;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.4rem 0.3rem;
    font-size: 0.85rem;
    text-align: center;
  }

  .tab-icon {
    display: none;
  }

  .tab-label {
    flex: none;
    max-width: 100%;
  }

  .manual-hero .spine {
    display: none;
  }
}
</style>
