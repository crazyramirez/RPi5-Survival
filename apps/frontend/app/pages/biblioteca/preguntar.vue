<script setup lang="ts">
import { ArrowLeft, Bot, Check, ChevronRight, History, Send, ShieldAlert, Square, Trash2 } from '@lucide/vue'
import type { AskHistory, AskHistoryEntry, AskSource, AssistantStatus } from '@survival-os/shared-types'
import { formatClock, formatDate } from '~/utils/format'
import { llmModelLabel } from '~/utils/llm'

/**
 * Asistente de consulta local. Las respuestas se basan SOLO en fragmentos de la biblioteca
 * (protocolos, documentos, Wikipedia) y citan sus fuentes. La salida del modelo se muestra como
 * texto plano (nunca HTML).
 */
const t = useT()
const router = useRouter()
const route = useRoute()
const status = ref<AssistantStatus | null>(null)
const question = ref('')
const answer = ref('')
const sources = ref<AskSource[]>([])
const phase = ref<'idle' | 'searching' | 'thinking' | 'writing' | 'done' | 'error'>('idle')
const error = ref<string | null>(null)
const elapsed = ref<number | null>(null)
const speed = ref<number | null>(null)
/** Otra pregunta ocupa el modelo (409): se ofrece cancelarla. */
const otherBusy = ref(false)
const cancelling = ref(false)
let ctrl: AbortController | null = null

async function loadStatus(): Promise<void> {
  status.value = await $fetch<AssistantStatus>('/api/library/ask/status', { timeout: 5000, retry: 0 }).catch(() => null)
}

// ---- Historial de consultas (solo en el equipo; el usuario puede borrarlo o no guardarlo)
/** Escritura en el historial. URL como `string`: las rutas tipadas de Nuxt agotan al compilador con PUT/DELETE. */
function historyWrite(url: string, method: 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<unknown> {
  return $fetch<unknown>(url, { method, body, headers: { 'x-survival-action': '1' }, timeout: 5000, retry: 0 })
}
const history = ref<AskHistory | null>(null)
/** Consulta del historial que se está mostrando (null = pregunta nueva). */
const viewing = ref<AskHistoryEntry | null>(null)
const confirmClear = ref(false)
const historyBusy = ref(false)

async function loadHistory(): Promise<void> {
  history.value = await $fetch<AskHistory>('/api/library/ask/history', { timeout: 5000, retry: 0 }).catch(() => null)
}

function showEntry(e: AskHistoryEntry): void {
  if (busy.value) return
  viewing.value = e
  question.value = e.question
  answer.value = e.answer
  sources.value = e.sources
  error.value = null
  otherBusy.value = false
  speed.value = null
  elapsed.value = Math.round(e.ms / 100) / 10
  phase.value = 'done'
  if (route.query.h !== String(e.id)) void router.replace({ query: { h: String(e.id) } })
}

/** /biblioteca/preguntar?h=<id> (p. ej. desde la búsqueda de la Biblioteca). */
async function openFromQuery(): Promise<void> {
  const h = typeof route.query.h === 'string' && /^\d{1,12}$/.test(route.query.h) ? Number(route.query.h) : null
  if (h === null || viewing.value?.id === h) return
  const e = await $fetch<AskHistoryEntry>(`/api/library/ask/history/${h}`, { timeout: 5000, retry: 0 }).catch(() => null)
  if (e) showEntry(e)
  else error.value = t('ask.history.missing')
}
watch(() => route.query.h, openFromQuery)

async function historyAction(run: () => Promise<unknown>): Promise<void> {
  historyBusy.value = true
  try {
    await run()
  } catch {
    error.value = t('ask.history.error')
  } finally {
    historyBusy.value = false
    await loadHistory()
  }
}

function deleteEntry(id: number): Promise<void> {
  return historyAction(async () => {
    await historyWrite(`/api/library/ask/history/${id}`, 'DELETE')
    if (viewing.value?.id === id) newQuestion()
  })
}

function clearHistory(): Promise<void> {
  return historyAction(async () => {
    await historyWrite('/api/library/ask/history', 'DELETE')
    confirmClear.value = false
    if (viewing.value) newQuestion()
  })
}

function setSaving(enabled: boolean): Promise<void> {
  return historyAction(() => historyWrite('/api/library/ask/history/settings', 'PUT', { enabled }))
}

function newQuestion(): void {
  viewing.value = null
  question.value = ''
  answer.value = ''
  sources.value = []
  elapsed.value = null
  phase.value = 'idle'
  if (route.query.h) void router.replace({ query: {} })
}

/** Modelo a mostrar: el de la consulta guardada que se está viendo o el cargado ahora. */
const modelLabel = computed(() => llmModelLabel(viewing.value ? viewing.value.model : status.value?.model, t))

function when(iso: string): string {
  const d = new Date(iso)
  return `${formatDate(d)} · ${formatClock(d)}`
}

onMounted(() => {
  void loadStatus()
  void loadHistory()
  void openFromQuery()
})

function linkFor(s: AskSource): string {
  return s.source === 'zim' ? `/biblioteca/leer?u=${encodeURIComponent(s.href)}` : s.href
}

async function ask(): Promise<void> {
  const q = question.value.trim()
  if (q.length < 3 || phase.value === 'searching' || phase.value === 'thinking' || phase.value === 'writing') return
  answer.value = ''
  sources.value = []
  error.value = null
  otherBusy.value = false
  viewing.value = null
  if (route.query.h) void router.replace({ query: {} })
  elapsed.value = null
  speed.value = null
  phase.value = 'searching'
  ctrl = new AbortController()
  const started = Date.now()
  try {
    const res = await fetch('/api/library/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-survival-action': '1' },
      body: JSON.stringify({ question: q }),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; statusMessage?: string; busySeconds?: number }
      if (res.status === 409) {
        otherBusy.value = true
        throw new Error(t('ask.busy', { s: Math.round(j.busySeconds ?? 0) }))
      }
      throw new Error(j.error ?? j.statusMessage ?? t('ask.error'))
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        const ev = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (!ev || data === undefined) continue
        const v = JSON.parse(data) as unknown
        if (ev === 'sources') {
          sources.value = v as AskSource[]
          phase.value = 'thinking'
        } else if (ev === 'token') {
          phase.value = 'writing'
          answer.value += v as string
        } else if (ev === 'timings') {
          const tm = v as { predicted_per_second?: number }
          if (tm.predicted_per_second) speed.value = Math.round(tm.predicted_per_second * 10) / 10
        } else if (ev === 'error') {
          throw new Error(String(v))
        } else if (ev === 'cancelled') {
          error.value = t('ask.cancelled')
        } else if (ev === 'done' && (v as { historyId?: number | null }).historyId) {
          void loadHistory()
        }
      }
    }
    phase.value = 'done'
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      phase.value = 'done'
    } else {
      error.value = err instanceof Error ? err.message : t('ask.error')
      phase.value = 'error'
    }
  } finally {
    elapsed.value = Math.round((Date.now() - started) / 100) / 10
    ctrl = null
  }
}

function stop(): void {
  ctrl?.abort()
}

/** Cancela la pregunta que ocupa el modelo (p. ej. abandonada en otra pantalla) y lanza la nuestra. */
async function cancelOther(): Promise<void> {
  cancelling.value = true
  try {
    await $fetch('/api/library/ask/cancel', { method: 'POST', headers: { 'x-survival-action': '1' }, timeout: 5000, retry: 0 })
    await ask()
  } catch {
    error.value = t('ask.error')
  } finally {
    cancelling.value = false
  }
}

onBeforeUnmount(stop)
const busy = computed(() => ['searching', 'thinking', 'writing'].includes(phase.value))

// ---- Presentación: fases visibles del progreso (solo lectura de `phase`).
const STEPS = ['searching', 'thinking', 'writing'] as const
const stepIndex = computed(() => (STEPS as readonly string[]).indexOf(phase.value))
</script>

<template>
  <div class="page">
    <header class="top">
      <button type="button" class="btn" @click="router.push('/biblioteca')"><ArrowLeft :size="20" /> {{ t('module.library') }}</button>
      <span class="title-orb" aria-hidden="true"><Bot :size="22" /></span>
      <h1>{{ t('ask.title') }}</h1>
      <StatePill
        v-if="status"
        :tone="status.available ? 'ok' : status.active ? 'info' : 'muted'"
        :label="status.available ? (llmModelLabel(status.model, t) ?? t('mnt.llm.on')) : status.active ? t('mnt.llm.loading') : t('mnt.llm.off')"
      />
    </header>

    <div class="notice tone-warn disclaimer">
      <ShieldAlert :size="18" aria-hidden="true" />
      <span>{{ t('ask.disclaimer') }}</span>
    </div>

    <div v-if="status && !status.available" class="notice tone-info">
      <span>{{ status.active ? t('ask.loading') : t('ask.notInstalled') }}</span>
      <NuxtLink v-if="!status.active" to="/sistema/mantenimiento" class="btn">{{ t('mnt.open') }}</NuxtLink>
    </div>

    <div class="layout">
      <div class="main">
        <form class="composer" @submit.prevent="ask">
          <input v-model="question" type="text" maxlength="300" :placeholder="t('ask.placeholder')" enterkeyhint="send" />
          <button v-if="!busy" type="submit" class="btn btn-primary" :disabled="question.trim().length < 3 || !status?.available">
            <Send :size="20" /> {{ t('ask.send') }}
          </button>
          <button v-else type="button" class="btn btn-danger" @click="stop"><Square :size="18" /> {{ t('ask.stop') }}</button>
        </form>

        <!-- Progreso real de la consulta: las fases que emite el servidor. -->
        <ol v-if="busy || (phase === 'done' && answer)" class="steps">
          <li
            v-for="(st, i) in STEPS"
            :key="st"
            :class="{ now: phase === st, done: phase === 'done' || stepIndex > i }"
          >
            <span class="step-dot" aria-hidden="true"><Check :size="13" /></span>
            {{ t(`ui.ask.step.${st}`) }}
          </li>
        </ol>

        <p v-if="phase === 'searching'" class="muted status-line">{{ t('ask.searching') }}</p>
        <p v-else-if="phase === 'thinking'" class="muted status-line">{{ t('ask.thinking', { n: sources.length }) }}</p>
        <p v-if="error" class="err">{{ error }}</p>
        <button v-if="otherBusy && phase === 'error'" type="button" class="btn btn-danger" :disabled="cancelling" @click="cancelOther">
          <Square :size="18" /> {{ t('ask.cancelOther') }}
        </button>

        <!-- Salida de la IA: SIEMPRE texto plano (interpolación + pre-wrap), nunca v-html. -->
        <article v-if="answer" class="answer">
          <header class="answer-head">
            <span class="answer-orb" aria-hidden="true"><Bot :size="16" /></span>
            <span class="answer-label">{{ t('ui.ask.answer') }}</span>
            <span v-if="phase === 'done' && elapsed" class="answer-meta mono">
              {{ t('ask.timing', { s: elapsed }) }}<template v-if="speed"> · {{ t('ui.ask.speed', { n: speed }) }}</template>
            </span>
          </header>
          <p class="answer-text">{{ answer }}</p>
          <footer v-if="phase === 'done' && modelLabel" class="answer-foot mono">{{ modelLabel }}</footer>
        </article>

        <section v-if="sources.length" class="sources">
          <h2 class="ui-sec">{{ t('ask.sources') }}</h2>
          <NuxtLink v-for="s in sources" :key="s.n" :to="linkFor(s)" class="src">
            <span class="num mono">{{ s.n }}</span>
            <span class="grow">{{ s.title }}</span>
            <StatePill :tone="s.source === 'protocol' ? 'warn' : s.source === 'doc' ? 'info' : 'ok'" :label="t(`lib.source.${s.source}` as never)" />
            <ChevronRight :size="18" class="chev" aria-hidden="true" />
          </NuxtLink>
        </section>
      </div>

      <aside class="hist" :aria-label="t('ask.history.title')">
        <div class="hist-head">
          <span class="hist-icon" aria-hidden="true"><History :size="18" /></span>
          <strong class="grow">{{ t('ask.history.title') }}</strong>
          <span v-if="history" class="count mono">{{ history.items.length }}/{{ history.limit }}</span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            :checked="history?.enabled === false"
            :disabled="!history || historyBusy"
            @change="setSaving(!($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t('ask.history.dontSave') }}</span>
        </label>
        <p v-if="history && !history.enabled" class="faint">{{ t('ask.history.off') }}</p>
        <p v-if="!history" class="faint">{{ t('ask.history.unavailable') }}</p>
        <p v-else-if="!history.items.length" class="faint">{{ t('ask.history.empty') }}</p>
        <button v-if="viewing" type="button" class="btn btn-primary" @click="newQuestion"><Send :size="18" /> {{ t('ask.history.new') }}</button>
        <ul v-if="history?.items.length" class="hist-list">
          <li v-for="e in history.items" :key="e.id" :class="{ active: viewing?.id === e.id }">
            <button type="button" class="item" :disabled="busy" @click="showEntry(e)">
              <span class="q">{{ e.question }}</span>
              <span class="when">{{ when(e.createdAt) }}</span>
            </button>
            <button type="button" class="del" :aria-label="t('ask.history.delete')" :disabled="historyBusy" @click="deleteEntry(e.id)">
              <Trash2 :size="18" />
            </button>
          </li>
        </ul>
        <button v-if="history?.items.length" type="button" class="btn btn-danger" :disabled="historyBusy" @click="confirmClear = true">
          <Trash2 :size="18" /> {{ t('ask.history.clear') }}
        </button>
      </aside>
    </div>

    <ConfirmDialog
      v-if="confirmClear"
      :title="t('ask.history.clearTitle')"
      :message="t('ask.history.clearBody', { n: history?.items.length ?? 0 })"
      :confirm-label="t('ask.history.clear')"
      danger
      :busy="historyBusy"
      @confirm="clearHistory"
      @cancel="confirmClear = false"
    />
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------ Cabecera */
.top {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.6rem;
}

.title-orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}

h1 {
  flex: 1;
  min-width: 0;
  font-size: 1.3rem;
  letter-spacing: -0.01em;
}

.disclaimer {
  font-size: 0.875rem;
  padding: 0.5rem 0.8rem;
}

/* ------------------------------------------------------------ Disposición */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 17rem;
  gap: 1rem;
  align-items: start;
}

@media (max-width: 800px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.main {
  min-width: 0;
}

/* ------------------------------------------------------------ Compositor */
.composer {
  display: flex;
  gap: 0.4rem;
  margin: 0.7rem 0 0.6rem;
  padding: 0.35rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.composer input {
  flex: 1;
  min-width: 0;
  min-height: 3.1rem;
  padding: 0 0.8rem;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 1.1rem;
  outline: none;
}

.composer .btn {
  min-height: 3.1rem;
}

/* ------------------------------------------------------------ Fases */
.steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
  padding: 0;
}

.steps li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.7rem 0.25rem 0.35rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 0.82rem;
  font-weight: 700;
}

.step-dot {
  display: grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: var(--surface-3);
  color: transparent;
}

.steps li.now {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 55%, var(--border));
  background: color-mix(in srgb, var(--info) 10%, transparent);
}

.steps li.now .step-dot {
  background: var(--info);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 22%, transparent);
}

.steps li.done {
  color: var(--ok);
  border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
}

.steps li.done .step-dot {
  background: color-mix(in srgb, var(--ok) 22%, transparent);
  color: var(--ok);
}

.status-line {
  font-size: 0.9rem;
  margin-bottom: 0.4rem;
}

.err {
  color: var(--danger);
  font-weight: 700;
  margin-bottom: 0.4rem;
}

/* ------------------------------------------------------------ Respuesta */
.answer {
  position: relative;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  overflow: hidden;
  animation: fade-in 0.18s ease-out;
}

.answer::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, var(--accent), transparent 80%);
}

.answer-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem 0;
}

.answer-orb {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.answer-label {
  flex: 1;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.answer-meta {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.answer-text {
  padding: 0.55rem 1rem 0.9rem;
  white-space: pre-wrap;
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--text);
}

.answer-foot {
  padding: 0.4rem 1rem 0.6rem;
  border-top: 1px solid var(--hairline);
  font-size: 0.75rem;
  color: var(--text-faint);
}

/* ------------------------------------------------------------ Fuentes */
.sources {
  margin-top: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.src {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--touch);
  padding: 0.3rem 0.5rem 0.3rem 0.4rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  transition: transform 0.08s ease-out;
}

.src:active {
  transform: scale(0.99);
  border-color: var(--accent);
}

.num {
  flex: none;
  display: grid;
  place-items: center;
  min-width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
}

.chev {
  flex: none;
  color: var(--text-faint);
}

/* ------------------------------------------------------------ Historial */
.hist {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.7rem;
  padding: 0.7rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.hist-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hist-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.count {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--touch);
  font-size: 0.9rem;
}

.toggle input {
  width: 1.5rem;
  height: 1.5rem;
  accent-color: var(--accent);
}

.hist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 55vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.hist-list li {
  position: relative;
  display: flex;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  overflow: hidden;
}

.hist-list li.active {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, var(--surface-2));
}

.hist-list li.active::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent);
}

.item {
  flex: 1;
  min-width: 0;
  min-height: var(--touch);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.4rem 0.6rem;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.item .q {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.when {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.del {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--touch);
  border: 0;
  border-left: 1px solid var(--hairline);
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}

.del:active:not(:disabled) {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.faint {
  font-size: 0.85rem;
}
</style>
