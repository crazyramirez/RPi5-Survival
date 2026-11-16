<script setup lang="ts">
import { Download, LoaderCircle, RotateCw, ShieldCheck, Sparkles, X } from '@lucide/vue'
import { formatBytes } from '~/utils/format'

/**
 * Aviso de versión nueva (ADR 0021) en superposición: invita a instalar con un toque. Aparece cuando el equipo
 * sabe que hay versión nueva (comprobada por update-online/update-auto: la web no sale a Internet), una vez por
 * versión; «Más tarde» la aparca 12 h. Nunca en la bienvenida ni con la pantalla bloqueada.
 */
const t = useT()
const route = useRoute()
const { locked } = useScreenLock()
const { status: st, refresh, applyNow } = useUpdates()
const job = useAdminJob('update-online', () => void refresh())

const SNOOZE = 'survival-os:update-snooze'
const SNOOZE_MS = 12 * 3600_000
const snoozed = ref<{ v: string; until: number } | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

onMounted(() => {
  try {
    snoozed.value = JSON.parse(localStorage.getItem(SNOOZE) ?? 'null') as { v: string; until: number } | null
  } catch {
    snoozed.value = null
  }
  void refresh()
})

/** Portable con la versión ya preparada: se aplica reiniciando. Si no, se descarga e instala. */
const prepared = computed(() => {
  const s = st.value
  return !!s && s.kind === 'portable' && !!s.prepared && s.prepared !== s.installed
})
const version = computed(() => {
  const s = st.value
  if (!s?.supported) return null
  if (prepared.value) return s.prepared
  const fresh = s.status === 'available' && !(s.prepared && s.prepared === s.latest?.version)
  return fresh ? (s.latest?.version ?? null) : null
})

const show = computed(() => {
  const v = version.value
  if (!v || locked.value || route.path.startsWith('/bienvenida')) return false
  if (busy.value) return true
  const z = snoozed.value
  return !(z && z.v === v && Date.now() < z.until)
})

/** Novedades: las primeras líneas, sin marcas de Markdown. */
const notes = computed(() => {
  const n = st.value?.latest?.notes
  if (!n) return []
  return n
    .split('\n')
    .map((l) => l.replace(/^[\s>*#-]+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 2)
    .slice(0, 4)
})

const size = computed(() => (st.value?.asset ? formatBytes(st.value.asset.size) : null))

function later(): void {
  const v = version.value
  if (!v) return
  snoozed.value = { v, until: Date.now() + SNOOZE_MS }
  try {
    localStorage.setItem(SNOOZE, JSON.stringify(snoozed.value))
  } catch {
    // sin almacenamiento: vuelve a salir al recargar
  }
}

async function install(): Promise<void> {
  error.value = null
  busy.value = true
  try {
    if (prepared.value) await applyNow()
    else await job.start({ action: 'install' })
    if (job.error.value) throw new Error(job.error.value)
  } catch (err) {
    busy.value = false
    error.value = actionErrorMessage(err)
  }
}
</script>

<template>
  <Transition name="upd">
    <div v-if="show" class="scrim" role="dialog" aria-modal="true" :aria-label="t('upd.prompt.title', { v: version ?? '' })" @click.self="busy || later()">
      <article class="card">
        <button v-if="!busy" type="button" class="close" :aria-label="t('upd.prompt.later')" @click="later"><X :size="20" /></button>

        <header class="top">
          <span class="halo" aria-hidden="true" />
          <img src="/icon-192.png" alt="" class="app-icon" width="76" height="76" />
          <span class="badge"><Sparkles :size="14" aria-hidden="true" />{{ t('upd.prompt.badge') }}</span>
        </header>

        <div class="body">
          <h2>{{ t('upd.prompt.title', { v: version ?? '' }) }}</h2>
          <p class="from">{{ t('upd.prompt.from', { v: st?.installed ?? '' }) }}</p>
          <ul v-if="notes.length" class="notes">
            <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
          </ul>
          <p v-else class="lead">{{ t('upd.prompt.body') }}</p>

          <div class="meta">
            <span class="chip ok"><ShieldCheck :size="15" aria-hidden="true" />{{ t('upd.prompt.verified') }}</span>
            <span v-if="size && !prepared" class="chip">{{ t('upd.size', { size }) }}</span>
          </div>

          <p v-if="busy" class="state" role="status"><LoaderCircle :size="18" class="spin" aria-hidden="true" />{{ t('upd.prompt.installing') }}</p>
          <p v-if="error" class="err" role="alert">{{ error }}</p>

          <div class="actions">
            <button type="button" class="btn ghost" :disabled="busy" @click="later">{{ t('upd.prompt.later') }}</button>
            <button type="button" class="btn btn-primary go" :disabled="busy" @click="install">
              <RotateCw v-if="prepared" :size="20" aria-hidden="true" />
              <Download v-else :size="20" aria-hidden="true" />
              {{ prepared ? t('upd.prompt.apply') : t('upd.prompt.install') }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </Transition>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 160;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(4 6 5 / 0.62);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  backdrop-filter: blur(10px) saturate(1.1);
}

.card {
  position: relative;
  width: min(30rem, 100%);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: var(--surface);
  box-shadow:
    0 30px 80px rgb(0 0 0 / 0.6),
    0 0 0 1px rgb(255 255 255 / 0.03);
}

.close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.25);
  color: var(--text-muted);
  cursor: pointer;
}

/* Cabecera: el fondo topográfico de la app con el icono en un halo. */
.top {
  position: relative;
  display: grid;
  place-items: center;
  gap: 0.7rem;
  padding: 1.6rem 1rem 1.1rem;
  overflow: hidden;
  background:
    linear-gradient(180deg, transparent 40%, var(--surface)),
    url('/backgrounds/welcome-topo.webp') center / cover;
}

.halo {
  position: absolute;
  top: 0.6rem;
  width: 9rem;
  height: 9rem;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 45%, transparent), transparent);
}

.app-icon {
  position: relative;
  border-radius: 22%;
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.55);
}

.badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--maint);
  color: var(--maint-ink);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.body {
  display: grid;
  gap: 0.65rem;
  padding: 0.2rem 1.4rem 1.3rem;
  text-align: center;
}

h2 {
  margin: 0;
  font-size: 1.35rem;
  line-height: 1.2;
}

.from {
  margin: -0.3rem 0 0;
  font-size: 0.85rem;
  color: var(--text-faint);
}

.lead {
  margin: 0;
  color: var(--text-muted);
}

.notes {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius);
  background: var(--surface-2);
  list-style: none;
  text-align: left;
}

.notes li {
  position: relative;
  padding-left: 1rem;
  font-size: 0.9rem;
  line-height: 1.35;
  color: var(--text-muted);
}

.notes li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.5em;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--accent);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.8rem;
  color: var(--text-muted);
}

.chip.ok {
  color: var(--ok);
  border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
}

.state,
.err {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.9rem;
}

.state {
  color: var(--info);
}

.err {
  color: var(--danger);
}

.actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0.6rem;
  margin-top: 0.3rem;
}

.btn {
  justify-content: center;
  min-height: 3.2rem;
}

.ghost {
  background: transparent;
}

.go {
  font-size: 1.05rem;
  box-shadow: 0 8px 26px color-mix(in srgb, var(--accent) 30%, transparent);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.upd-enter-active,
.upd-leave-active {
  transition: opacity 0.25s ease;
}

.upd-enter-active .card,
.upd-leave-active .card {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.upd-enter-from,
.upd-leave-to {
  opacity: 0;
}

.upd-enter-from .card,
.upd-leave-to .card {
  transform: translateY(16px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .upd-enter-active,
  .upd-leave-active,
  .upd-enter-active .card,
  .upd-leave-active .card {
    transition: none;
  }
}

@media (max-width: 420px) {
  .actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .go {
    order: -1;
  }
}
</style>
