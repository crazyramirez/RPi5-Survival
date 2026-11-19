<script setup lang="ts">
import type { Component, Directive } from 'vue'
import {
  ArrowDownUp,
  CalendarClock,
  Check,
  ChevronDown,
  File as FileIcon,
  FileImage,
  FileText,
  FileType,
  FileUp,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  SearchX,
  Tag,
  Trash2,
  Vault,
  X,
} from '@lucide/vue'
import type { VaultFile } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'
import { bcp47 } from '~/utils/i18n'
import {
  addTags,
  extBadge,
  filterFiles,
  isoDay,
  kindCounts,
  MAX_NAME_LEN,
  MAX_TAGS,
  MAX_TAG_LEN,
  reviewState,
  sortFiles,
  splitName,
  tagsInUse,
  VAULT_KINDS,
  VAULT_SORTS,
  vaultKind,
} from '~/utils/vault-browser'
import type { ReviewState, VaultFilter, VaultKind, VaultSort, VaultView } from '~/utils/vault-browser'

/**
 * Explorador de documentos de la bóveda abierta: vista de lista o de iconos (con miniaturas de las imágenes),
 * búsqueda, filtros por tipo y etiqueta, orden, y en cada documento «Editar» (nombre, etiquetas, fecha de
 * revisión) y «Borrar» siempre a la vista. No guarda nada sensible fuera de la memoria: las miniaturas son URL
 * de objeto que se liberan al cerrarse (bloquear la bóveda desmonta este componente).
 */
const props = defineProps<{
  files: VaultFile[]
  busy: boolean
  /** Documento abierto en la vista previa (se resalta). */
  activeId: string | null
  /** Subida en curso: n.º del que se está guardando y total. */
  uploading: { i: number; n: number } | null
}>()
const emit = defineEmits<{
  open: [file: VaultFile]
  save: [file: VaultFile, patch: { name?: string; tags?: string[]; reviewDate?: string | null }]
  remove: [file: VaultFile]
  upload: [files: File[]]
  add: []
}>()
const t = useT()

// ------------------------------------------------------------------ Preferencias de vista (solo este navegador)

const PREFS_KEY = 'survival-os:vault:browser'
const view = ref<VaultView>('list')
const sort = ref<VaultSort>('recent')
onMounted(() => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { view?: string; sort?: string }
    if (p.view === 'list' || p.view === 'grid') view.value = p.view
    if ((VAULT_SORTS as readonly string[]).includes(p.sort ?? '')) sort.value = p.sort as VaultSort
  } catch {
    // sin almacenamiento: valores por defecto
  }
})
watch([view, sort], () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ view: view.value, sort: sort.value }))
  } catch {
    // sin almacenamiento: no se recuerda
  }
})

// ------------------------------------------------------------------ Filtrar y ordenar

const query = ref('')
const kind = ref<VaultFilter>('all')
const tag = ref<string | null>(null)
const counts = computed(() => kindCounts(props.files))
const kindChips = computed(() => (['all', ...VAULT_KINDS] as VaultFilter[]).filter((k) => k === 'all' || counts.value[k] > 0))
const shown = computed(() => sortFiles(filterFiles(props.files, { query: query.value, kind: kind.value, tag: tag.value }), sort.value))
const filtered = computed(() => !!query.value.trim() || kind.value !== 'all' || !!tag.value)
function clearFilters(): void {
  query.value = ''
  kind.value = 'all'
  tag.value = null
}
// Un tipo que deja de existir (se borró su último documento) no deja la lista vacía.
watch(counts, (c) => {
  if (kind.value !== 'all' && !c[kind.value]) kind.value = 'all'
  if (tag.value && !props.files.some((f) => f.tags.includes(tag.value!))) tag.value = null
})

const sortOpen = ref(false)
const sortBox = ref<HTMLElement | null>(null)
/** Tocar fuera del menú de orden lo cierra. */
function onPointerDown(e: PointerEvent): void {
  if (sortOpen.value && !sortBox.value?.contains(e.target as Node)) sortOpen.value = false
}
function pickSort(s: VaultSort): void {
  sort.value = s
  sortOpen.value = false
}

// ------------------------------------------------------------------ Presentación

const KIND_ICON: Record<VaultKind, Component> = { image: FileImage, pdf: FileText, text: FileType, other: FileIcon }
const kindOf = (f: VaultFile): VaultKind => vaultKind(f.mime)
const fmtDay = (iso: string): string => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(bcp47(), { day: 'numeric', month: 'short', year: 'numeric' })
}
const REVIEW_TONE: Record<ReviewState, string> = { overdue: 'tone-danger', soon: 'tone-warn', later: 'tone-info' }
function review(f: VaultFile): { tone: string; label: string } | null {
  const s = reviewState(f.reviewDate)
  if (!s || !f.reviewDate) return null
  return { tone: REVIEW_TONE[s], label: t(`ui.vault.b.${s}`, { date: fmtDay(f.reviewDate) }) }
}

// ------------------------------------------------------------------ Miniaturas (solo imágenes, al verse)

const THUMB_MAX_BYTES = 15 * 1024 * 1024
const thumbs = ref<Record<string, string>>({})
const wanted: string[] = []
const requested = new Set<string>()
let running = 0
let alive = true

function pump(): void {
  while (running < 2 && wanted.length) {
    const id = wanted.shift()!
    running++
    void fetch(`/api/vault/files/${id}/raw`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null)
      .then((url) => {
        running--
        if (url && alive && props.files.some((f) => f.id === id)) thumbs.value = { ...thumbs.value, [id]: url }
        else if (url) URL.revokeObjectURL(url)
        pump()
      })
  }
}

const observer = import.meta.client
  ? new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const id = (e.target as HTMLElement).dataset.thumb
          observer?.unobserve(e.target)
          if (id && !requested.has(id)) {
            requested.add(id)
            wanted.push(id)
          }
        }
        pump()
      },
      { rootMargin: '200px' },
    )
  : null

/** v-thumb="file": pide la miniatura cuando el documento entra en pantalla. */
const vThumb: Directive<HTMLElement, VaultFile> = {
  mounted(el, { value: f }) {
    if (kindOf(f) !== 'image' || f.sizeBytes > THUMB_MAX_BYTES || requested.has(f.id)) return
    el.dataset.thumb = f.id
    observer?.observe(el)
  },
  unmounted(el) {
    observer?.unobserve(el)
  },
}

// Documentos borrados (o la bóveda cerrada): fuera sus miniaturas de la memoria.
watch(
  () => props.files.map((f) => f.id).join(),
  () => {
    const ids = new Set(props.files.map((f) => f.id))
    const next: Record<string, string> = {}
    for (const [id, url] of Object.entries(thumbs.value)) {
      if (ids.has(id)) next[id] = url
      else URL.revokeObjectURL(url)
    }
    thumbs.value = next
    for (const id of [...requested]) if (!ids.has(id)) requested.delete(id)
  },
)
onBeforeUnmount(() => {
  alive = false
  observer?.disconnect()
  for (const url of Object.values(thumbs.value)) URL.revokeObjectURL(url)
  thumbs.value = {}
})

// ------------------------------------------------------------------ Editar

interface Draft {
  file: VaultFile
  base: string
  ext: string
  tags: string[]
  tagInput: string
  reviewDate: string
}
const draft = ref<Draft | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const allTags = computed(() => tagsInUse(props.files))
const suggestions = computed(() => (draft.value ? allTags.value.filter((x) => !draft.value!.tags.includes(x)).slice(0, 8) : []))

function startEdit(f: VaultFile): void {
  draft.value = { file: f, ...splitName(f.name), tags: [...f.tags], tagInput: '', reviewDate: f.reviewDate ?? '' }
  void nextTick(() => nameInput.value?.focus())
}
function commitTag(): void {
  const d = draft.value
  if (!d || !d.tagInput.trim()) return
  d.tags = addTags(d.tags, d.tagInput)
  d.tagInput = ''
}
function onTagKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTag()
  } else if (e.key === 'Backspace' && draft.value && !draft.value.tagInput && draft.value.tags.length) {
    draft.value.tags = draft.value.tags.slice(0, -1)
  }
}
function presetDate(months: number): void {
  if (!draft.value) return
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  draft.value.reviewDate = isoDay(d)
}
const draftValid = computed(() => !!draft.value?.base.trim())
function saveEdit(): void {
  const d = draft.value
  if (!d || !draftValid.value) return
  commitTag()
  const patch: { name?: string; tags?: string[]; reviewDate?: string | null } = {}
  const name = `${d.base.trim()}${d.ext}`
  if (name !== d.file.name) patch.name = name
  if (d.tags.join('\n') !== d.file.tags.join('\n')) patch.tags = d.tags
  const date = d.reviewDate || null
  if (date !== d.file.reviewDate) patch.reviewDate = date
  draft.value = null
  if (Object.keys(patch).length) emit('save', d.file, patch)
}

// ------------------------------------------------------------------ Borrar

const pendingDelete = ref<VaultFile | null>(null)
function confirmDelete(): void {
  const f = pendingDelete.value
  pendingDelete.value = null
  if (f) emit('remove', f)
}

// ------------------------------------------------------------------ Soltar ficheros (portable de escritorio)

const dragging = ref(false)
let dragDepth = 0
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
function onDragEnter(e: DragEvent): void {
  if (!hasFiles(e)) return
  dragDepth++
  dragging.value = true
}
function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}
function onDrop(e: DragEvent): void {
  dragDepth = 0
  dragging.value = false
  const list = [...(e.dataTransfer?.files ?? [])]
  if (list.length && !props.busy) emit('upload', list)
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (draft.value) draft.value = null
  else if (sortOpen.value) sortOpen.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onPointerDown, true)
})
</script>

<template>
  <section
    class="vb"
    :aria-label="t('ui.vault.docs', { n: files.length })"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="vb-body">
      <!-- Cabecera fija al desplazar: búsqueda, orden, vista y filtros -->
      <div v-if="files.length" class="vb-head">
        <div class="vb-bar">
          <label class="vb-search">
            <Search :size="18" aria-hidden="true" />
            <input v-model="query" type="search" class="vb-q" :placeholder="t('ui.vault.b.search')" :aria-label="t('ui.vault.b.search')" autocomplete="off" spellcheck="false" />
            <button v-if="query" type="button" class="vb-clear" :aria-label="t('ui.vault.b.clearSearch')" @click="query = ''"><X :size="18" /></button>
          </label>

          <div ref="sortBox" class="vb-sort">
            <button type="button" class="btn vb-sort-btn" :aria-expanded="sortOpen" aria-haspopup="menu" @click="sortOpen = !sortOpen">
              <ArrowDownUp :size="18" aria-hidden="true" />
              <span class="vb-sort-label"><small>{{ t('ui.vault.b.sort') }}</small>{{ t(`ui.vault.b.sort.${sort}`) }}</span>
              <ChevronDown :size="16" aria-hidden="true" class="chev" :class="{ up: sortOpen }" />
            </button>
            <div v-if="sortOpen" class="vb-menu" role="menu">
              <button v-for="s in VAULT_SORTS" :key="s" type="button" role="menuitemradio" :aria-checked="sort === s" class="vb-menu-item" @click="pickSort(s)">
                <span>{{ t(`ui.vault.b.sort.${s}`) }}</span>
                <Check v-if="sort === s" :size="18" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div class="vb-view" role="group" :aria-label="t('ui.vault.b.viewLabel')">
            <button type="button" class="vb-view-btn" :aria-pressed="view === 'list'" :title="t('ui.vault.b.view.list')" @click="view = 'list'">
              <List :size="20" aria-hidden="true" /><span>{{ t('ui.vault.b.view.list') }}</span>
            </button>
            <button type="button" class="vb-view-btn" :aria-pressed="view === 'grid'" :title="t('ui.vault.b.view.grid')" @click="view = 'grid'">
              <LayoutGrid :size="20" aria-hidden="true" /><span>{{ t('ui.vault.b.view.grid') }}</span>
            </button>
          </div>
        </div>

        <!-- Filtros en una línea deslizable: tipo (con recuento) y, tras el separador, etiquetas -->
        <div class="vb-chips" role="group" :aria-label="t('ui.vault.b.kinds')">
          <button v-for="k in kindChips" :key="k" type="button" class="vb-chip" :aria-pressed="kind === k" @click="kind = k">
            {{ t(`ui.vault.b.kind.${k}`) }}<span class="n mono">{{ counts[k] }}</span>
          </button>
          <template v-if="allTags.length">
            <span class="vb-chips-sep" aria-hidden="true" />
            <button
              v-for="x in allTags"
              :key="x"
              type="button"
              class="vb-chip vb-chip-tag"
              :aria-pressed="tag === x"
              :aria-label="tag === x ? t('ui.vault.b.removeTag', { tag: x }) : t('ui.vault.b.filterTag', { tag: x })"
              @click="tag = tag === x ? null : x"
            >
              <Tag :size="14" aria-hidden="true" />{{ x }}<X v-if="tag === x" :size="14" aria-hidden="true" />
            </button>
          </template>
        </div>
        <span v-if="filtered" class="vb-shown mono" role="status">{{ t('ui.vault.b.shown', { n: shown.length, total: files.length }) }}</span>
      </div>

      <!-- Subida en curso -->
      <div v-if="uploading" class="vb-progress" role="status">
        <FileUp :size="18" aria-hidden="true" />
        <span>{{ t('ui.vault.b.uploading', { i: uploading.i, n: uploading.n }) }}</span>
        <span class="vb-progress-bar" aria-hidden="true"><span :style="{ transform: `scaleX(${(uploading.i - 1) / uploading.n})` }" /></span>
      </div>

      <!-- Vacía -->
      <div v-if="!files.length" class="vb-empty">
        <span class="vb-empty-orb" aria-hidden="true"><Vault :size="34" /></span>
        <h3>{{ t('ui.vault.b.emptyTitle') }}</h3>
        <p>{{ t('vault.empty') }}</p>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="emit('add')"><Plus :size="20" aria-hidden="true" />{{ t('ui.vault.b.addDocs') }}</button>
      </div>

      <!-- Sin coincidencias -->
      <div v-else-if="!shown.length" class="vb-empty">
        <span class="vb-empty-orb muted" aria-hidden="true"><SearchX :size="32" /></span>
        <h3>{{ t('ui.vault.b.noMatch') }}</h3>
        <p>{{ t('ui.vault.b.noMatchSub') }}</p>
        <button type="button" class="btn" @click="clearFilters"><X :size="18" aria-hidden="true" />{{ t('ui.vault.b.clearFilters') }}</button>
      </div>

      <!-- Lista -->
      <ul v-else-if="view === 'list'" class="vb-list">
        <li v-for="f in shown" :key="f.id" class="vb-row" :class="{ on: activeId === f.id }">
          <button type="button" class="vb-open" :aria-label="t('ui.vault.b.openOf', { name: f.name })" @click="emit('open', f)">
            <span v-thumb="f" class="vb-icon" :class="`k-${kindOf(f)}`" aria-hidden="true">
              <img v-if="thumbs[f.id]" :src="thumbs[f.id]" alt="" decoding="async" />
              <component :is="KIND_ICON[kindOf(f)]" v-else :size="22" />
            </span>
            <span class="vb-meta">
              <strong class="vb-name">{{ f.name }}</strong>
              <small>
                <span v-if="extBadge(f.name)" class="vb-ext">{{ extBadge(f.name) }}</span>
                <span class="mono">{{ formatBytes(f.sizeBytes) }}</span>
                <span class="dot" aria-hidden="true">·</span>
                <span>{{ fmtDay(f.addedAt) }}</span>
                <span v-if="f.tags.length" class="vb-inline-tags"><Tag :size="12" aria-hidden="true" />{{ f.tags.join(', ') }}</span>
              </small>
            </span>
          </button>
          <span v-if="review(f)" class="ui-chip vb-review" :class="review(f)!.tone"><CalendarClock :size="14" aria-hidden="true" />{{ review(f)!.label }}</span>
          <span class="vb-actions">
            <button type="button" class="btn vb-act" :disabled="busy" :aria-label="t('ui.vault.b.editOf', { name: f.name })" @click="startEdit(f)">
              <Pencil :size="18" aria-hidden="true" /><span>{{ t('ui.vault.b.edit') }}</span>
            </button>
            <button type="button" class="btn vb-act del" :disabled="busy" :aria-label="t('ui.vault.b.deleteOf', { name: f.name })" @click="pendingDelete = f">
              <Trash2 :size="18" aria-hidden="true" />
            </button>
          </span>
        </li>
      </ul>

      <!-- Iconos -->
      <ul v-else class="vb-grid">
        <li v-for="f in shown" :key="f.id" class="vb-card" :class="[{ on: activeId === f.id }, `k-${kindOf(f)}`]">
          <button type="button" class="vb-card-open" :aria-label="t('ui.vault.b.openOf', { name: f.name })" @click="emit('open', f)">
            <span v-thumb="f" class="vb-thumb" aria-hidden="true">
              <img v-if="thumbs[f.id]" :src="thumbs[f.id]" alt="" decoding="async" />
              <template v-else>
                <component :is="KIND_ICON[kindOf(f)]" :size="44" stroke-width="1.5" />
                <span v-if="extBadge(f.name)" class="vb-badge">{{ extBadge(f.name) }}</span>
              </template>
              <span v-if="review(f)" class="ui-chip vb-review vb-review-on" :class="review(f)!.tone"><CalendarClock :size="13" />{{ review(f)!.label }}</span>
            </span>
            <span class="vb-card-name">{{ f.name }}</span>
          </button>
          <div class="vb-card-foot">
            <span class="vb-card-meta">
              <span class="mono">{{ formatBytes(f.sizeBytes) }}</span>
              <span v-if="f.tags.length" class="vb-card-tags"><Tag :size="12" aria-hidden="true" />{{ f.tags.join(', ') }}</span>
              <span v-else>{{ fmtDay(f.addedAt) }}</span>
            </span>
            <button type="button" class="btn vb-act icon" :disabled="busy" :aria-label="t('ui.vault.b.editOf', { name: f.name })" @click="startEdit(f)">
              <Pencil :size="18" aria-hidden="true" />
            </button>
            <button type="button" class="btn vb-act icon del" :disabled="busy" :aria-label="t('ui.vault.b.deleteOf', { name: f.name })" @click="pendingDelete = f">
              <Trash2 :size="18" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>

      <!-- Soltar ficheros -->
      <div v-if="dragging" class="vb-drop" aria-hidden="true">
        <FileUp :size="40" />
        <strong>{{ t('ui.vault.b.drop') }}</strong>
        <small>{{ t('ui.vault.b.dropSub') }}</small>
      </div>
    </div>

    <!-- Editar: nombre, etiquetas y fecha de revisión (arriba: el teclado en pantalla aparece abajo) -->
    <div v-if="draft" class="vb-backdrop" @click.self="draft = null">
      <form class="vb-dialog" role="dialog" aria-modal="true" :aria-label="t('ui.vault.b.editTitle')" @submit.prevent="saveEdit">
        <header class="vb-dialog-head">
          <span class="vb-icon" :class="`k-${kindOf(draft.file)}`" aria-hidden="true">
            <img v-if="thumbs[draft.file.id]" :src="thumbs[draft.file.id]" alt="" />
            <component :is="KIND_ICON[kindOf(draft.file)]" v-else :size="22" />
          </span>
          <span class="vb-meta">
            <strong>{{ t('ui.vault.b.editTitle') }}</strong>
            <small class="mono">{{ formatBytes(draft.file.sizeBytes) }} · {{ fmtDay(draft.file.addedAt) }}</small>
          </span>
          <button type="button" class="btn icon" :aria-label="t('common.cancel')" @click="draft = null"><X :size="20" /></button>
        </header>

        <label class="vb-field">
          <span class="vb-label">{{ t('ui.vault.b.name') }}</span>
          <span class="vb-name-row">
            <input ref="nameInput" v-model="draft.base" class="ui-field" :maxlength="MAX_NAME_LEN" autocomplete="off" spellcheck="false" :aria-label="t('ui.vault.renameLabel')" />
            <span v-if="draft.ext" class="vb-ext big">{{ draft.ext.slice(1).toUpperCase() }}</span>
          </span>
        </label>

        <div class="vb-field">
          <span class="vb-label">{{ t('ui.vault.b.tags') }} <small class="mono">{{ draft.tags.length }}/{{ MAX_TAGS }}</small></span>
          <div class="vb-tagbox">
            <span v-for="x in draft.tags" :key="x" class="vb-tag on">
              {{ x }}
              <button type="button" class="vb-tag-x" :aria-label="t('ui.vault.b.removeTag', { tag: x })" @click="draft.tags = draft.tags.filter((y) => y !== x)"><X :size="14" /></button>
            </span>
            <input
              v-if="draft.tags.length < MAX_TAGS"
              v-model="draft.tagInput"
              class="vb-tag-input"
              :maxlength="MAX_TAG_LEN"
              :placeholder="t('ui.vault.b.tagPlaceholder')"
              :aria-label="t('ui.vault.b.tags')"
              autocomplete="off"
              @keydown="onTagKey"
              @blur="commitTag"
            />
            <button v-if="draft.tagInput.trim()" type="button" class="btn vb-tag-add" @mousedown.prevent @click="commitTag"><Plus :size="16" aria-hidden="true" />{{ t('ui.vault.b.addTag') }}</button>
          </div>
          <span v-if="draft.tags.length >= MAX_TAGS" class="vb-hint">{{ t('ui.vault.b.tagsMax', { n: MAX_TAGS }) }}</span>
          <span v-else-if="suggestions.length" class="vb-suggest">
            <small>{{ t('ui.vault.b.suggested') }}</small>
            <button v-for="x in suggestions" :key="x" type="button" class="vb-tag" @click="draft.tags = addTags(draft.tags, x)"><Plus :size="12" aria-hidden="true" />{{ x }}</button>
          </span>
        </div>

        <div class="vb-field">
          <span class="vb-label">{{ t('ui.vault.b.reviewDate') }}</span>
          <span class="vb-date-row">
            <input v-model="draft.reviewDate" type="date" class="ui-field vb-date" :aria-label="t('ui.vault.b.reviewDate')" />
            <button type="button" class="vb-chip" :aria-pressed="false" @click="presetDate(6)">{{ t('ui.vault.b.in6m') }}</button>
            <button type="button" class="vb-chip" :aria-pressed="false" @click="presetDate(12)">{{ t('ui.vault.b.in1y') }}</button>
            <button type="button" class="vb-chip" :aria-pressed="!draft.reviewDate" @click="draft.reviewDate = ''">{{ t('ui.vault.b.noDate') }}</button>
          </span>
          <span class="vb-hint">{{ t('ui.vault.b.reviewHint') }}</span>
        </div>

        <div class="vb-dialog-actions">
          <button type="button" class="btn del-text" @click="pendingDelete = draft.file; draft = null"><Trash2 :size="18" aria-hidden="true" /><span>{{ t('nav.delete') }}</span></button>
          <span class="grow" />
          <button type="button" class="btn" @click="draft = null">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary" :disabled="!draftValid || busy"><Check :size="18" aria-hidden="true" />{{ t('common.save') }}</button>
        </div>
      </form>
    </div>

    <ConfirmDialog
      v-if="pendingDelete"
      :title="t('nav.delete.title')"
      :message="t('vault.delete.body', { name: pendingDelete.name })"
      :confirm-label="t('nav.delete')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>

<style scoped>
.vb {
  min-width: 0;
}

/* Contenedor de consulta: con la vista previa al lado, el explorador ocupa media pantalla. Los diálogos quedan
 * fuera (la contención haría de «position: fixed» algo relativo a este bloque). */
.vb-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  container: vb / inline-size;
}

/* ------------------------------------------------------------ Cabecera fija (búsqueda y filtros siempre a mano) */
.vb-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: -0.5rem -0.25rem 0;
  padding: 0.5rem 0.25rem 0.6rem;
  background: linear-gradient(180deg, var(--bg) 82%, transparent);
}

/* ------------------------------------------------------------ Barra */
.vb-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.vb-search {
  flex: 1 1 9rem;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--touch);
  padding: 0 0.3rem 0 0.8rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-faint);
  transition: border-color 0.12s, box-shadow 0.12s;
}

.vb-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}

.vb-q {
  flex: 1;
  min-width: 0;
  height: 2.6rem;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  outline: none;
}

.vb-q::-webkit-search-cancel-button {
  display: none;
}

.vb-clear {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  cursor: var(--cursor-point);
}

.vb-sort {
  position: relative;
}

.vb-sort-btn {
  gap: 0.55rem;
  padding: 0 0.75rem;
}

.vb-sort-label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.1;
}

.vb-sort-label small {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.chev {
  color: var(--text-faint);
  transition: transform 0.15s;
}

.chev.up {
  transform: rotate(180deg);
}

.vb-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 41;
  min-width: 12rem;
  padding: 0.3rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  box-shadow: 0 14px 34px rgb(0 0 0 / 45%);
  animation: pop-in 0.14s ease-out;
}

.vb-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  min-height: var(--touch);
  padding: 0 0.8rem;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: var(--cursor-point);
}

.vb-menu-item[aria-checked='true'] {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.vb-menu-item:active {
  background: var(--surface-3);
}

.vb-view {
  display: flex;
  padding: 0.15rem;
  gap: 0.15rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
}

.vb-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.75rem;
  min-width: 2.9rem;
  padding: 0 0.7rem;
  border: 0;
  border-radius: calc(var(--radius) - 3px);
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  cursor: var(--cursor-point);
  transition: background-color 0.12s, color 0.12s;
}

.vb-view-btn[aria-pressed='true'] {
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

/* ------------------------------------------------------------ Filtros */
/* Una sola línea que se desliza con el dedo. */
.vb-chips {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  overflow-x: auto;
  scrollbar-width: none;
  touch-action: pan-x;
  padding-right: 1.5rem;
  mask-image: linear-gradient(90deg, #000 calc(100% - 2rem), transparent);
}

.vb-chips::-webkit-scrollbar {
  display: none;
}

.vb-chips > * {
  flex: none;
}

.vb-chips-sep {
  width: 1px;
  height: 1.6rem;
  margin: 0 0.2rem;
  background: var(--border);
}

.vb-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.75rem;
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: var(--cursor-point);
  transition: background-color 0.12s, color 0.12s, border-color 0.12s;
}

.vb-chip .n {
  min-width: 1.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 0.75rem;
  text-align: center;
}

.vb-chip[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  color: var(--accent);
}

.vb-chip[aria-pressed='true'] .n {
  background: var(--accent);
  color: var(--accent-ink);
}

.vb-chip:active {
  transform: scale(0.97);
}

.vb-chip-tag {
  color: var(--info);
}

.vb-chip-tag[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--info) 70%, var(--border));
  background: color-mix(in srgb, var(--info) 16%, var(--surface));
  color: var(--info);
}

.vb-shown {
  align-self: flex-end;
  margin-top: -0.2rem;
  font-size: 0.8rem;
  color: var(--text-faint);
}

/* ------------------------------------------------------------ Subida */
.vb-progress {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem 0.8rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  color: var(--accent);
  font-weight: 700;
  overflow: hidden;
}

.vb-progress-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.vb-progress-bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform 0.3s ease-out;
}

/* ------------------------------------------------------------ Vacía / sin coincidencias */
.vb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2rem 1rem 2.2rem;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border);
  background: var(--surface-grad);
  text-align: center;
}

.vb-empty h3 {
  font-size: 1.15rem;
}

.vb-empty p {
  max-width: 32rem;
  color: var(--text-muted);
  font-size: 0.92rem;
}

.vb-empty-orb {
  display: grid;
  place-items: center;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 50%;
  color: var(--accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 8%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.vb-empty-orb.muted {
  color: var(--text-muted);
  background: var(--surface-3);
  box-shadow: none;
}

/* ------------------------------------------------------------ Tipos (color de cada clase de documento) */
.k-image {
  --kind: #8fb8e0;
}

.k-pdf {
  --kind: #ec8466;
}

.k-text {
  --kind: #e5b85c;
}

.k-other {
  --kind: #a9b0a2;
}

.vb-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--radius);
  overflow: hidden;
  color: var(--kind);
  background: color-mix(in srgb, var(--kind) 14%, var(--surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kind) 28%, transparent);
}

.vb-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ------------------------------------------------------------ Lista */
.vb-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.vb-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.35rem 0.3rem 0.45rem;
  border-radius: var(--radius);
  transition: background-color 0.12s;
}

.vb-row + .vb-row {
  box-shadow: 0 -1px 0 var(--hairline);
}

.vb-row.on {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--accent);
}

.vb-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.6rem;
  padding: 0.2rem 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
  transition: transform 0.08s ease-out;
}

.vb-open:active {
  transform: scale(0.985);
}

.vb-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.vb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.98rem;
}

.vb-meta small {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.vb-ext {
  flex: none;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.vb-ext.big {
  padding: 0.35rem 0.55rem;
  font-size: 0.8rem;
}

.dot {
  color: var(--border);
}

.vb-inline-tags {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--info);
}

.vb-inline-tags svg,
.vb-card-tags svg {
  flex: none;
}

.vb-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 10rem;
  min-height: 2rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--info) 35%, transparent);
  background: color-mix(in srgb, var(--info) 9%, transparent);
  color: var(--info);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: var(--cursor-point);
}

.vb-tag.more {
  cursor: var(--cursor);
  color: var(--text-faint);
  border-color: var(--border);
  background: none;
}

.vb-review {
  flex: none;
  white-space: nowrap;
}

.vb-actions {
  flex: none;
  display: flex;
  gap: 0.35rem;
}

.vb-act {
  padding: 0 0.75rem;
  gap: 0.4rem;
}

.vb-act.icon {
  padding: 0;
}

.del {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}

.del-text {
  color: var(--danger);
}

/* ------------------------------------------------------------ Iconos */
.vb-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
  gap: var(--gap);
}

.vb-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  overflow: hidden;
  transition: border-color 0.12s, box-shadow 0.12s;
}

.vb-card.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.vb-card-open {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.5rem 0.2rem;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
  transition: transform 0.08s ease-out;
}

.vb-card-open:active {
  transform: scale(0.98);
}

.vb-thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  overflow: hidden;
  color: var(--kind);
  background:
    radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--kind) 26%, transparent), transparent 70%),
    color-mix(in srgb, var(--kind) 8%, var(--bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kind) 22%, transparent);
}

.vb-thumb img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.vb-badge {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  padding: 0.12rem 0.45rem;
  border-radius: 5px;
  background: color-mix(in srgb, var(--kind) 85%, #000);
  color: #0f1412;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.vb-review-on {
  position: absolute;
  left: 0.4rem;
  top: 0.4rem;
  max-width: calc(100% - 0.8rem);
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  font-size: 0.72rem;
}

.vb-card-name {
  display: -webkit-box;
  min-height: 2.5em;
  overflow: hidden;
  font-weight: 700;
  font-size: 0.92rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.vb-card-foot {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem 0.5rem;
}

.vb-card-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--text-faint);
  line-height: 1.3;
}

.vb-card-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vb-card-tags {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--info);
}

/* ------------------------------------------------------------ Soltar */
.vb-drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 12rem;
  border-radius: var(--radius-lg);
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--bg) 82%, var(--accent));
  color: var(--accent);
  pointer-events: none;
  animation: fade-in 0.12s ease-out;
}

.vb-drop small {
  color: var(--text-muted);
}

/* ------------------------------------------------------------ Editar */
.vb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2.5rem 1rem 1rem;
  overflow-y: auto;
  background: rgb(0 0 0 / 62%);
  animation: fade-in 0.14s ease-out;
}

.vb-dialog {
  width: min(40rem, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1rem 1.1rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  box-shadow: 0 24px 60px rgb(0 0 0 / 50%);
  animation: pop-in 0.16s ease-out;
}

.vb-dialog-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--hairline);
}

.vb-dialog-head strong {
  font-size: 1.1rem;
}

.vb-dialog-head .btn.icon {
  padding: 0;
}

.vb-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.vb-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.vb-label small {
  margin-left: 0.3rem;
  letter-spacing: 0;
}

.vb-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.vb-name-row .ui-field {
  flex: 1;
  min-width: 0;
  font-size: 1.05rem;
}

.vb-tagbox {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  min-height: var(--touch);
  padding: 0.3rem 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
}

.vb-tagbox:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.vb-tag.on {
  gap: 0.1rem;
  min-height: 2.75rem;
  padding: 0 0.2rem 0 0.7rem;
  cursor: var(--cursor);
  font-size: 0.88rem;
}

.vb-tag-x {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  margin: -0.2rem -0.2rem -0.2rem 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: var(--cursor-point);
}

.vb-tag-x:active {
  background: color-mix(in srgb, var(--info) 20%, transparent);
}

.vb-tag-input {
  flex: 1 1 10rem;
  min-width: 8rem;
  height: 2.75rem;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  outline: none;
}

.vb-tag-add {
  min-height: 2.75rem;
  padding: 0 0.7rem;
}

.vb-suggest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.vb-suggest small,
.vb-hint {
  font-size: 0.8rem;
  color: var(--text-faint);
}

.vb-suggest .vb-tag {
  min-height: 2.75rem;
}

.vb-date-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.vb-date {
  min-width: 11rem;
  color-scheme: dark;
}

.vb-dialog-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--hairline);
}

.grow {
  flex: 1;
}

/* ------------------------------------------------------------ Explorador estrecho (vista previa al lado, móvil) */
@container vb (max-width: 44rem) {
  .vb-act span,
  .vb-view-btn span {
    display: none;
  }

  .vb-act {
    padding: 0;
  }
}

@container vb (max-width: 34rem) {
  .vb-row .vb-review {
    display: none;
  }

  .vb-name {
    display: -webkit-box;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.25;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .vb-sort-label small {
    display: none;
  }

  .vb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .del-text span {
    display: none;
  }

  .vb-dialog-actions .btn {
    padding: 0 0.8rem;
  }
}
</style>
