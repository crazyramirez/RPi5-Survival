<script setup lang="ts">
/**
 * Notas, diario y listas de comprobación. Se guardan solas, entran en la búsqueda de la biblioteca y el
 * asistente puede citarlas. No se cifran: lo sensible va a la bóveda (se dice en pantalla).
 */
import { CheckSquare, Clock, Eye, NotebookPen, Pencil, Pin, PinOff, Plus, Search, ShieldAlert, Square, Trash2 } from '@lucide/vue'
import type { Note, NoteSummary } from '@survival-os/shared-types'

const t = useT()
const route = useRoute()
const router = useRouter()

const notes = ref<NoteSummary[]>([])
const current = ref<Note | null>(null)
const editing = ref(false)
const filter = ref('')
const loadError = ref<string | null>(null)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const confirmDelete = ref(false)
const busy = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Escrituras: URL como `string` (las rutas tipadas de Nuxt agotan al compilador con PUT/DELETE). */
function write<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<T> {
  return $fetch<T>(url, { method, body, headers: { 'x-survival-action': '1' }, timeout: 8000, retry: 0 }) as Promise<T>
}

async function loadList(): Promise<void> {
  try {
    notes.value = await $fetch<NoteSummary[]>('/api/library/notes', { timeout: 8000, retry: 0 })
    loadError.value = null
  } catch (err) {
    loadError.value = actionErrorMessage(err)
  }
}

async function open(id: number): Promise<void> {
  await flush()
  try {
    current.value = await $fetch<Note>(`/api/library/notes/${id}`, { timeout: 8000, retry: 0 })
    editing.value = false
    saveState.value = 'idle'
    void router.replace({ query: { id: String(id) } })
  } catch (err) {
    loadError.value = actionErrorMessage(err)
  }
}

async function create(title: string, body: string): Promise<void> {
  await flush()
  try {
    const n = await write<Note>('/api/library/notes', 'POST', { title, body })
    await loadList()
    current.value = n
    editing.value = true
    void router.replace({ query: { id: String(n.id) } })
  } catch (err) {
    loadError.value = actionErrorMessage(err)
  }
}

/** Plantillas: texto en el idioma de la interfaz; la lista de kit sigue la de Ready.gov (FEMA). */
function newNote(kind: 'blank' | 'kit' | 'log'): void {
  if (kind === 'kit') void create(t('notes.tpl.kit.title'), t('notes.tpl.kit.body'))
  else if (kind === 'log') void create(t('notes.tpl.log.title'), `${stamp()} `)
  else void create(t('notes.untitled'), '')
}

function stamp(): string {
  const d = new Date()
  return `[${d.toLocaleDateString(bcp47(), { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(bcp47(), { hour: '2-digit', minute: '2-digit' })}]`
}

// ------------------------------------------------------------------ Guardado automático
function scheduleSave(): void {
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 700)
}

async function save(): Promise<void> {
  const n = current.value
  if (!n) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    const saved = await write<Note>(`/api/library/notes/${n.id}`, 'PUT', { title: n.title, body: n.body })
    // Solo se actualizan los metadatos: el texto en edición no se pisa.
    if (current.value?.id === saved.id) current.value = { ...current.value, tasks: saved.tasks, updatedAt: saved.updatedAt, title: saved.title }
    saveState.value = 'saved'
    void loadList()
  } catch {
    saveState.value = 'error'
  }
}

/** Guarda lo pendiente antes de cambiar de nota o salir. */
async function flush(): Promise<void> {
  if (saveTimer) await save()
}

async function togglePin(): Promise<void> {
  const n = current.value
  if (!n) return
  await flush()
  const saved = await write<Note>(`/api/library/notes/${n.id}`, 'PUT', { pinned: !n.pinned }).catch(() => null)
  if (saved && current.value?.id === saved.id) current.value = { ...current.value, pinned: saved.pinned }
  await loadList()
}

async function remove(): Promise<void> {
  const n = current.value
  if (!n) return
  busy.value = true
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    await write(`/api/library/notes/${n.id}`, 'DELETE')
    current.value = null
    confirmDelete.value = false
    void router.replace({ query: {} })
    await loadList()
  } finally {
    busy.value = false
  }
}

// ------------------------------------------------------------------ Edición
const textarea = ref<HTMLTextAreaElement | null>(null)

function insertLine(text: string): void {
  const n = current.value
  if (!n) return
  editing.value = true
  const body = n.body.length && !n.body.endsWith('\n') ? `${n.body}\n` : n.body
  n.body = `${body}${text}`
  scheduleSave()
  void nextTick(() => {
    const el = textarea.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

/** Vista: cada línea es texto o una casilla que se marca con un toque. */
const TASK_RE = /^(\s*[-*] \[)( |x|X)(\] )(.*)$/
const lines = computed(() =>
  (current.value?.body ?? '').split('\n').map((raw, i) => {
    const m = TASK_RE.exec(raw)
    return m ? { i, task: true, done: m[2] !== ' ', text: m[4] ?? '' } : { i, task: false, done: false, text: raw }
  }),
)

function toggleTask(i: number): void {
  const n = current.value
  if (!n) return
  const parts = n.body.split('\n')
  const m = TASK_RE.exec(parts[i] ?? '')
  if (!m) return
  parts[i] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`
  n.body = parts.join('\n')
  scheduleSave()
}

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? notes.value.filter((n) => `${n.title} ${n.preview}`.toLowerCase().includes(q)) : notes.value
})
const when = (iso: string): string => new Date(iso).toLocaleString(bcp47(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

onMounted(async () => {
  await loadList()
  const id = Number(route.query.id)
  if (Number.isInteger(id) && id > 0) await open(id)
})
onBeforeRouteLeave(async () => {
  await flush()
})
onBeforeUnmount(() => {
  if (saveTimer) void save()
})
</script>

<template>
  <div class="page notes">
    <PageHeader :title="t('notes.title')" :icon="NotebookPen" :back="{ to: '/biblioteca', label: t('module.library') }" />

    <p v-if="loadError" class="notice tone-danger">{{ loadError }}</p>

    <div class="layout">
      <!-- Lista -->
      <aside class="side">
        <div class="new">
          <button type="button" class="btn btn-primary" @click="newNote('blank')"><Plus :size="18" aria-hidden="true" />{{ t('notes.new') }}</button>
          <button type="button" class="btn" @click="newNote('kit')"><CheckSquare :size="18" aria-hidden="true" />{{ t('notes.tpl.kit.short') }}</button>
          <button type="button" class="btn" @click="newNote('log')"><Clock :size="18" aria-hidden="true" />{{ t('notes.tpl.log.short') }}</button>
        </div>
        <label v-if="notes.length > 5" class="filter">
          <Search :size="16" aria-hidden="true" />
          <input v-model="filter" type="search" class="selectable" :placeholder="t('notes.filter')" :aria-label="t('notes.filter')" />
        </label>
        <ul class="list">
          <li v-for="n in shown" :key="n.id">
            <button type="button" class="item" :class="{ on: current?.id === n.id }" @click="open(n.id)">
              <span class="item-head">
                <Pin v-if="n.pinned" :size="14" class="pin" :aria-label="t('notes.pinned')" />
                <strong>{{ n.title }}</strong>
              </span>
              <small v-if="n.preview">{{ n.preview }}</small>
              <span class="item-meta">
                <span v-if="n.tasks.total" class="mono">☑ {{ n.tasks.done }}/{{ n.tasks.total }}</span>
                <span>{{ when(n.updatedAt) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="!notes.length && !loadError" class="empty">{{ t('notes.empty') }}</p>
      </aside>

      <!-- Nota -->
      <section v-if="current" class="editor" :aria-label="current.title">
        <div class="ed-head">
          <input v-model="current.title" class="ui-field title selectable" maxlength="120" :aria-label="t('notes.titleField')" @input="scheduleSave" />
          <button type="button" class="btn icon-btn" :aria-label="current.pinned ? t('notes.unpin') : t('notes.pin')" :aria-pressed="current.pinned" @click="togglePin">
            <component :is="current.pinned ? PinOff : Pin" :size="18" />
          </button>
          <button type="button" class="btn icon-btn" :aria-label="t('notes.delete')" @click="confirmDelete = true"><Trash2 :size="18" /></button>
        </div>
        <div class="toolbar">
          <button type="button" class="btn small" :aria-pressed="editing" @click="editing = !editing">
            <component :is="editing ? Eye : Pencil" :size="16" aria-hidden="true" />{{ editing ? t('notes.view') : t('notes.edit') }}
          </button>
          <button type="button" class="btn small" @click="insertLine('- [ ] ')"><Square :size="16" aria-hidden="true" />{{ t('notes.addTask') }}</button>
          <button type="button" class="btn small" @click="insertLine(`${stamp()} `)"><Clock :size="16" aria-hidden="true" />{{ t('notes.addTime') }}</button>
          <span class="save-state" :class="saveState" role="status">
            {{ saveState === 'saving' ? t('notes.saving') : saveState === 'saved' ? t('notes.saved') : saveState === 'error' ? t('notes.saveError') : '' }}
          </span>
        </div>

        <textarea
          v-if="editing"
          ref="textarea"
          v-model="current.body"
          class="ui-field body selectable"
          :placeholder="t('notes.placeholder')"
          :aria-label="t('notes.bodyField')"
          @input="scheduleSave"
        />
        <div v-else class="view" @dblclick="editing = true">
          <template v-for="l in lines" :key="l.i">
            <button v-if="l.task" type="button" class="task" :class="{ done: l.done }" :aria-pressed="l.done" @click="toggleTask(l.i)">
              <component :is="l.done ? CheckSquare : Square" :size="22" aria-hidden="true" />
              <span>{{ l.text }}</span>
            </button>
            <p v-else class="line selectable">{{ l.text || ' ' }}</p>
          </template>
          <p v-if="!current.body.trim()" class="empty">{{ t('notes.emptyNote') }}</p>
        </div>
        <p class="privacy"><ShieldAlert :size="15" aria-hidden="true" /><span>{{ t('notes.privacy') }}</span></p>
      </section>
      <section v-else class="editor placeholder">
        <NotebookPen :size="40" aria-hidden="true" />
        <p>{{ t('notes.pick') }}</p>
      </section>
    </div>

    <ConfirmDialog
      v-if="confirmDelete && current"
      :title="t('notes.deleteTitle')"
      :message="t('notes.deleteBody', { title: current.title })"
      :confirm-label="t('notes.delete')"
      danger
      :busy="busy"
      @confirm="remove"
      @cancel="confirmDelete = false"
    />
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
  gap: var(--gap);
  min-height: 0;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.new {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}

.new .btn-primary {
  grid-column: 1 / -1;
}

.filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.6rem;
  min-height: 2.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-faint);
}

.filter input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
}

.item.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

.item-head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.item-head strong,
.item small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin {
  flex: none;
  color: var(--accent);
}

.item small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.item-meta {
  display: flex;
  gap: 0.6rem;
  font-size: 0.72rem;
  color: var(--text-faint);
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.75rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.editor.placeholder {
  align-items: center;
  justify-content: center;
  min-height: 16rem;
  color: var(--text-faint);
}

.ed-head {
  display: flex;
  gap: 0.4rem;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.btn.small {
  min-height: 2.6rem;
  padding: 0 0.7rem;
  font-size: 0.88rem;
}

.btn.small[aria-pressed='true'] {
  border-color: var(--accent);
}

.save-state {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.save-state.error {
  color: var(--danger);
  font-weight: 700;
}

.body {
  min-height: 14rem;
  resize: vertical;
  font-size: 1rem;
  line-height: 1.5;
}

.view {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 10rem;
}

.line {
  white-space: pre-wrap;
  word-break: break-word;
}

.task {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: var(--touch);
  padding: 0 0.4rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: var(--cursor-point);
}

.task:active {
  background: var(--surface-3);
}

.task svg {
  flex: none;
  color: var(--accent);
}

.task.done span {
  color: var(--text-faint);
  text-decoration: line-through;
}

.privacy {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.privacy svg {
  flex: none;
  color: var(--warn);
}

.empty {
  color: var(--text-faint);
  font-size: 0.9rem;
}

@media (max-width: 700px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
