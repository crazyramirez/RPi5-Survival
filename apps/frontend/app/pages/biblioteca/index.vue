<script setup lang="ts">
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronRight,
  Clock,
  Download,
  FileText,
  FolderOpen,
  Library,
  LibraryBig,
  RefreshCw,
  Search,
  SearchX,
  Settings2,
  Star,
  X,
} from '@lucide/vue'
import type { DocKind, DocSummary, LibraryStatus, Probe, SearchHit, SearchResults, ZimBook } from '@survival-os/shared-types'
import type { MessageKey } from '~/locales/es'
import { formatBytes } from '~/utils/format'

/**
 * Biblioteca: estantería de ZIM + documentos propios en dos columnas (1024×600),
 * buscador en la cabecera y resultados filtrables por fuente que sustituyen a la estantería.
 */
const t = useT()
const { favorites, loadFavorites } = useLibrary()

const status = ref<LibraryStatus | null>(null)
const books = ref<Probe<ZimBook[]> | null>(null)
const docs = ref<DocSummary[]>([])
const serviceDown = ref(false)

const query = ref('')
const results = ref<SearchResults | null>(null)
const searching = ref(false)
const reindexing = ref(false)
type Filter = 'all' | SearchHit['source']
const filter = ref<Filter>('all')

/** Vista pública (punto de acceso, ADR 0009): solo la estantería Kiwix; sin búsqueda, documentos propios ni favoritos. */
const publicView = isPublicView()

async function load(): Promise<void> {
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
const FILTERS: readonly Filter[] = ['all', 'protocol', 'doc', 'zim', 'history']

function syncUrl(): void {
  const q = results.value?.query
  const next: Record<string, string> = {}
  if (q) next.q = q
  if (q && filter.value !== 'all') next.f = filter.value
  void router.replace({ query: next })
}
watch(filter, syncUrl)

onMounted(async () => {
  loadRecent()
  void load()
  // Enlace directo o vuelta desde el lector: /biblioteca?q=deshidratación&f=zim
  const q = typeof route.query.q === 'string' ? route.query.q.trim() : ''
  if (!q) return
  query.value = q
  if (lastResults.value?.query === q) results.value = lastResults.value
  else await runSearch()
  const f = route.query.f
  if (results.value && typeof f === 'string' && (FILTERS as readonly string[]).includes(f)) filter.value = f as Filter
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
}))
const SOURCE_TONE: Record<SearchHit['source'], string> = {
  protocol: 'tone-warn',
  doc: 'tone-info',
  zim: 'tone-ok',
  history: 'tone-muted',
}
const SOURCE_KEY: Record<keyof SearchResults['sources'], SearchHit['source']> = {
  protocols: 'protocol',
  docs: 'doc',
  zim: 'zim',
  history: 'history',
}

const filters = computed(() => {
  const hits = results.value?.hits ?? []
  const count = (s: SearchHit['source']): number => hits.filter((h) => h.source === s).length
  return (['protocol', 'doc', 'zim', 'history'] as const)
    .map((s) => ({ key: s, label: SOURCE_LABEL.value[s], n: count(s) }))
    .filter((f) => f.n > 0)
})
const visibleHits = computed(() => (results.value?.hits ?? []).filter((h) => filter.value === 'all' || h.source === filter.value))
const failedSources = computed(() =>
  Object.entries(results.value?.sources ?? {})
    // Historial desactivado por el usuario: es una elección, no un fallo que avisar.
    .filter(([k, p]) => p.state !== 'ok' && k !== 'history')
    .map(([k, p]) => `${SOURCE_LABEL.value[SOURCE_KEY[k as keyof SearchResults['sources']]]}: ${p.state === 'ok' ? '' : p.reason}`),
)

function hitTarget(href: string): string {
  return href.startsWith('/kiwix/') ? `/biblioteca/leer?u=${encodeURIComponent(href)}` : href
}

const bookList = computed(() => (books.value?.state === 'ok' ? books.value.value : []))
const sizeByFile = computed(() => new Map((status.value?.zim?.installed ?? []).map((z) => [z.file, z.sizeBytes])))
const downloads = computed(() => status.value?.zim?.downloads ?? [])

function flavourLabel(f: string): string | null {
  const key = `lib.flavour.${f}` as MessageKey
  return f && ['maxi', 'nopic', 'mini'].includes(f) ? t(key) : null
}

/** 4858 → "4,9 mil"; 4232639 → "4,2 M": cabe en la tarjeta a 1024 px. */
const COMPACT = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })

function bookMeta(b: ZimBook): string {
  const parts: string[] = []
  if (b.articleCount) parts.push(`${COMPACT.format(b.articleCount)} ${t('lib.articles')}`)
  const size = sizeByFile.value.get(`${b.id}.zim`)
  if (size) parts.push(formatBytes(size))
  return parts.join(' · ')
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

      <div class="cols">
        <!-- Estantería ZIM -->
        <section class="panel tone-ok" :aria-label="t('lib.shelf')">
          <header class="panel-head">
            <span class="panel-icon"><LibraryBig :size="22" aria-hidden="true" /></span>
            <h2>{{ t('lib.shelf') }}</h2>
            <StatePill
              :tone="bookList.length ? 'ok' : 'muted'"
              :label="books?.state === 'ok' ? t('lib.books.count', { n: bookList.length }) : t('state.unavailable')"
            />
            <NuxtLink v-if="!publicView" to="/sistema/mantenimiento" class="btn btn-ghost" :title="t('lib.manage')">
              <Settings2 :size="18" aria-hidden="true" />
              {{ t('lib.shelf.manage') }}
            </NuxtLink>
          </header>

          <ProbeNote :probe="books" />
          <p v-if="books?.state === 'ok' && !bookList.length && !downloads.length" class="muted small">{{ t('lib.books.none') }}</p>

          <div class="shelf">
            <NuxtLink
              v-for="b in bookList"
              :key="b.id"
              :to="`/biblioteca/leer?u=${encodeURIComponent(b.readerPath)}`"
              class="book"
            >
              <span class="cover">
                <img
                  v-if="b.icon && !brokenIcons.has(b.id)"
                  :src="b.icon"
                  alt=""
                  width="60"
                  height="60"
                  loading="lazy"
                  @error="brokenIcons.add(b.id)"
                />
                <span v-else class="initial" aria-hidden="true">{{ b.title.charAt(0) }}</span>
              </span>
              <span class="book-body">
                <strong class="clamp-1">{{ b.title }}</strong>
                <span class="book-desc clamp-2">{{ b.description }}</span>
                <span class="book-meta">
                  <span v-if="flavourLabel(b.flavour)" class="tag" :class="b.flavour === 'maxi' ? 'tone-info' : 'tone-muted'">
                    {{ flavourLabel(b.flavour) }}
                  </span>
                  <span class="nums">{{ bookMeta(b) }}</span>
                </span>
              </span>
              <ChevronRight :size="22" class="chev" aria-hidden="true" />
            </NuxtLink>

            <div v-for="d in downloads" :key="d.file" class="book pending" aria-busy="true">
              <span class="cover"><Download :size="28" aria-hidden="true" /></span>
              <span class="book-body">
                <strong class="clamp-1 mono">{{ d.file.replace(/\.zim(\.part)?$/, '') }}</strong>
                <span class="book-meta">{{ t('lib.shelf.downloading', { size: formatBytes(d.bytes) }) }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Documentos propios -->
        <section v-if="!publicView" class="panel tone-info" :aria-label="t('lib.docs')">
          <header class="panel-head">
            <span class="panel-icon"><FileText :size="22" aria-hidden="true" /></span>
            <h2>{{ t('lib.docs') }}</h2>
            <StatePill :tone="docs.length ? 'info' : 'muted'" :label="String(docs.length)" />
          </header>

          <div v-if="!docs.length" class="empty">
            <FolderOpen :size="40" aria-hidden="true" />
            <strong>{{ t('lib.docs.empty') }}</strong>
            <p v-if="status" class="small">{{ t('lib.docs.where', { dir: status.docsDir }) }}</p>
          </div>
          <div v-else class="doc-list">
            <NuxtLink v-for="d in docs" :key="d.id" :to="`/biblioteca/doc/${d.id}`" class="doc">
              <span class="kind mono" :class="KIND_TONE[d.kind]">{{ d.kind.toUpperCase() }}</span>
              <span class="doc-body">
                <span class="clamp-1">{{ d.title }}</span>
                <span class="faint small mono">
                  {{ formatBytes(d.sizeBytes) }}<template v-if="!d.searchable"> · {{ t('lib.docs.notSearchable') }}</template>
                </span>
              </span>
              <ChevronRight :size="18" class="chev" aria-hidden="true" />
            </NuxtLink>
          </div>
          <footer class="panel-foot">
            <p v-if="docs.length && status" class="faint small">{{ t('lib.docs.where', { dir: status.docsDir }) }}</p>
            <button type="button" class="btn btn-ghost" :disabled="reindexing || serviceDown" @click="reindex">
              <RefreshCw :size="18" :class="{ spin: reindexing }" aria-hidden="true" />
              {{ reindexing ? t('state.loading') : t('lib.reindex') }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ---------- Cabecera: buscador y asistente en la misma fila ---------- */
.search {
  flex: 1;
  min-width: 0;
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

.search input::-webkit-search-cancel-button {
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

/* ---------- Favoritos ---------- */
.favs {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.7rem;
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

/* ---------- Columnas ---------- */
/* Enciclopedias a todo el ancho; documentos propios debajo. */
.cols {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

/* Panel al estilo de AppCard (docs/ui-design.md): degradado, filo superior del tono e icono tintado. */
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
  padding: 0.8rem 0.9rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  overflow: hidden;
}

.panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, var(--tone), transparent 80%);
  opacity: 0.85;
}

.panel-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-sm);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
}

.panel-head h2 {
  flex: 1;
  min-width: 0;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-ghost {
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

/* ---------- Estantería ---------- */
.shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
  gap: var(--gap);
}

/* Libro: portada grande, título, descripción en dos líneas y datos; halo del acento en la esquina. */
.book {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 6.4rem;
  padding: 0.75rem 0.6rem 0.75rem 0.75rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background:
    radial-gradient(70% 90% at 100% 100%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%),
    var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  min-width: 0;
  transition:
    background 0.12s,
    border-color 0.12s,
    transform 0.08s ease-out;
}

.book:active {
  background: var(--surface-3);
  border-color: var(--accent);
  transform: scale(0.97);
}

/* Portada tipo lomo de libro: papel claro (los iconos de Kiwix son a color), anillo y sombra fina. */
.cover {
  flex: none;
  display: grid;
  place-items: center;
  width: 4.75rem;
  height: 4.75rem;
  border-radius: 0.9rem;
  background: linear-gradient(160deg, #fbf9f3, #ebe6d8);
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.08),
    0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.cover img {
  width: 3.75rem;
  height: 3.75rem;
  object-fit: contain;
}

.initial {
  color: #1d2a24;
  font-size: 2.1rem;
  font-weight: 700;
}

.book-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.book-body strong {
  font-size: 1.08rem;
  line-height: 1.2;
}

.book-desc {
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.3;
}

/* Los datos (artículos · tamaño) nunca se cortan: si no caben junto a la etiqueta, bajan de línea. */
.book-meta {
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

.book.pending {
  border-style: dashed;
  background: transparent;
}

.book.pending .cover {
  background: var(--surface-3);
  color: var(--info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 14%, transparent);
}

/* ---------- Documentos ---------- */
.doc-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
  column-gap: 1.2rem;
}

.doc {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: var(--touch);
  padding: 0.4rem 0.3rem;
  border-bottom: 1px solid var(--hairline);
  transition: transform 0.08s ease-out;
  color: var(--text);
  text-decoration: none;
  border-radius: var(--radius-sm);
}

.doc:last-child {
  border-bottom: 1px solid var(--hairline);
}

.doc:active {
  background: var(--surface-3);
  transform: scale(0.97);
}

.kind {
  flex: none;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 2.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: 0.68rem;
  font-weight: 700;
}

.doc-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.panel-foot {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.panel-foot p {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.panel-foot .btn-ghost {
  border: 1px dashed var(--border);
}

/* ---------- Estados vacíos ---------- */
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

.empty strong {
  color: var(--text);
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
  grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
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
</style>
