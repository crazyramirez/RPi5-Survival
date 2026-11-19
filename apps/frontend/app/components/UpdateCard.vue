<script setup lang="ts">
import { CircleCheck, CloudDownload, CloudOff, RefreshCw, RotateCcw, ShieldCheck, TriangleAlert } from '@lucide/vue'
import type { UpdateMode } from '@survival-os/shared-types'
import type { MessageKey } from '~/locales/es'
import { formatBytes, formatClock, formatDate } from '~/utils/format'

/**
 * Actualizaciones desde GitHub Releases (ADR 0021) en Mantenimiento: versión instalada y última, novedades,
 * «Buscar ahora», «Instalar» y el modo (Automática / Solo avisar / Desactivada). Todo honesto: sin comprobación
 * no se muestra ninguna versión «disponible». Compacta: estado y acciones en una fila; el modo, segmentado.
 */
const t = useT()
const { status: st, refresh, setMode, applyNow } = useUpdates()
const error = ref<string | null>(null)
const confirmInstall = ref(false)
const applying = ref(false)

const android = useAndroid()
const job = useAdminJob('update-online', () => void refresh())
/** Android: la última «Instalar» dejó el APK verificado listo (si el instalador se cerró, se reabre sin descargar). */
const apkReady = computed(() => {
  const s = job.status.value
  return android && !busy.value && s?.state === 'inactive' && !!(s.data as { apk?: string } | null)?.apk && st.value?.status === 'available'
})
async function openInstaller(): Promise<void> {
  error.value = null
  await postAction('/api/android/action', { action: 'install-update' }).catch((err: unknown) => (error.value = actionErrorMessage(err)))
}
const auto = useAdminJob('update-auto', () => void refresh())
onMounted(refresh)
const busy = computed(() => job.running.value || auto.running.value)

const when = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : `${formatDate(d)} ${formatClock(d)}`
}

/** Estado principal en una frase (y el tono de la tarjeta). */
const summary = computed((): { text: string; tone: 'ok' | 'info' | 'warn' | 'muted' } => {
  const s = st.value
  if (!s) return { text: t('state.loading'), tone: 'muted' }
  if (!s.supported) return { text: t('upd.dev'), tone: 'muted' }
  if (s.prepared && s.prepared !== s.installed) return { text: t('upd.state.prepared', { v: s.prepared }), tone: 'info' }
  if (s.deferred) return { text: t(`upd.deferred.${s.deferred.reason}` as MessageKey), tone: 'info' }
  if (s.downloaded) return { text: t('upd.state.downloaded', { v: s.downloaded }), tone: 'info' }
  switch (s.status) {
    case 'available':
      return { text: t('upd.state.available', { v: s.latest?.version ?? '?' }), tone: 'info' }
    case 'up-to-date':
      return { text: t('upd.state.upToDate'), tone: 'ok' }
    case 'newer-installed':
      return { text: t('upd.state.newer'), tone: 'muted' }
    case 'no-asset':
      return { text: t('upd.state.noAsset', { v: s.latest?.version ?? '?' }), tone: 'warn' }
    case 'needs-step':
      return { text: t('upd.state.needsStep', { v: s.latest?.version ?? '?', min: s.latest?.minFrom ?? '?' }), tone: 'warn' }
    default:
      return { text: t('upd.state.never'), tone: 'muted' }
  }
})

const pill = computed(() => {
  const s = st.value
  if (!s?.supported) return undefined
  if (s.status === 'available' || (s.prepared && s.prepared !== s.installed)) return t('upd.pill.available')
  if (s.mode === 'off') return t('upd.pill.off')
  return s.status === 'up-to-date' ? t('upd.pill.ok') : t('upd.pill.unknown')
})

const errorText = computed(() => {
  const e = st.value?.error
  if (!e) return null
  if (e.code === 'offline') return t('upd.err.offline')
  if (e.code === 'no-release') return t('upd.err.noRelease')
  if (e.code === 'signature') return t('upd.err.signature')
  return t('upd.err.other', { msg: e.message })
})

const canInstall = computed(() => {
  const s = st.value
  return !!s?.supported && s.status === 'available' && !(s.prepared && s.prepared === s.latest?.version)
})
const canApplyNow = computed(() => {
  const s = st.value
  return s?.kind === 'portable' && !!s.prepared && s.prepared !== s.installed
})

/** Icono del indicador de estado (gira mientras busca o instala). */
const stateIcon = computed(() => {
  if (busy.value) return RefreshCw
  if (errorText.value) return CloudOff
  return summary.value.tone === 'ok' ? CircleCheck : summary.value.tone === 'warn' ? TriangleAlert : CloudDownload
})

const MODES: UpdateMode[] = ['auto', 'notify', 'off']
const modeHint = computed(() => {
  const s = st.value
  if (!s) return ''
  if (s.mode === 'auto') return t(`upd.mode.auto.hint.${s.kind === 'dev' ? 'portable' : s.kind}` as MessageKey)
  return t(`upd.mode.${s.mode}.hint` as MessageKey)
})

async function changeMode(mode: UpdateMode): Promise<void> {
  error.value = null
  await setMode(mode).catch((err: unknown) => (error.value = actionErrorMessage(err)))
}

async function install(): Promise<void> {
  confirmInstall.value = false
  await job.start({ action: 'install' })
}

async function doApplyNow(): Promise<void> {
  error.value = null
  applying.value = true
  await applyNow().catch((err: unknown) => {
    applying.value = false
    error.value = actionErrorMessage(err)
  })
}

const confirmBody = computed(() => {
  const s = st.value
  const size = s?.asset ? formatBytes(s.asset.size) : '?'
  const kind = s?.kind === 'android' ? 'android' : s?.kind === 'portable' ? 'portable' : 'system'
  return t(`upd.confirm.${kind}` as MessageKey, { size })
})
</script>

<template>
  <section class="upd" :class="`tone-${summary.tone}`" :aria-label="t('upd.title')">
    <div class="hero">
      <span class="orb" :class="{ busy }" aria-hidden="true"><component :is="stateIcon" :size="22" /></span>
      <div class="text">
        <small class="cap">{{ t('upd.title') }}<template v-if="pill"> · {{ pill }}</template></small>
        <strong class="state">{{ summary.text }}</strong>
        <span v-if="st?.supported" class="meta">
          {{ t('upd.installed', { v: st.installed }) }}
          <template v-if="st.latest"><span class="sep" aria-hidden="true">·</span>{{ t('upd.latest', { v: st.latest.version, date: st.latest.date }) }}</template>
          <span class="sep" aria-hidden="true">·</span>{{ t('upd.checked', { when: when(st.okAt ?? st.checkedAt) }) }}
        </span>
      </div>
      <div v-if="st?.supported" class="actions">
        <button v-if="canInstall" type="button" class="btn btn-primary" :disabled="busy" @click="confirmInstall = true">
          <CloudDownload :size="18" aria-hidden="true" />{{ t('upd.install', { v: st.latest?.version ?? '' }) }}
          <span v-if="st.asset" class="size">{{ formatBytes(st.asset.size) }}</span>
        </button>
        <button v-if="canApplyNow" type="button" class="btn btn-primary" :disabled="busy || applying" @click="doApplyNow">
          <RotateCcw :size="18" aria-hidden="true" />{{ t('upd.applyNow') }}
        </button>
        <button v-if="apkReady" type="button" class="btn btn-primary" @click="openInstaller">
          <CloudDownload :size="18" aria-hidden="true" />{{ t('upd.prompt.openInstaller') }}
        </button>
        <button type="button" class="btn" :disabled="busy" @click="job.start({ action: 'check' })">
          <RefreshCw :size="18" :class="{ spin: busy }" aria-hidden="true" />{{ t('upd.check') }}
        </button>
      </div>
    </div>

    <template v-if="st?.supported">
      <p v-if="errorText" class="alert">{{ errorText }}</p>
      <p v-if="st.lastInstall && !st.lastInstall.ok" class="alert">
        {{ t('upd.last.fail', { v: st.lastInstall.version ?? '?', msg: st.lastInstall.message ?? '' }) }}
      </p>
      <details v-if="st.latest?.notes && st.status === 'available'" class="notes">
        <summary>{{ t('upd.notes') }}</summary>
        <pre>{{ st.latest.notes }}</pre>
      </details>

      <div class="foot">
        <div class="seg" role="radiogroup" :aria-label="t('upd.mode')">
          <button
            v-for="m in MODES" :key="m" type="button" role="radio" :aria-checked="st.mode === m"
            :disabled="busy" @click="st.mode !== m && changeMode(m)"
          >
            {{ t(`upd.mode.${m}` as MessageKey) }}
          </button>
        </div>
        <p class="hint">
          {{ modeHint }}
          <template v-if="st.lastInstall?.ok">{{ ' ' + t('upd.last.ok', { v: st.lastInstall.version ?? '?', when: when(st.lastInstall.at) }) }}</template>
          <span class="privacy"><ShieldCheck :size="13" aria-hidden="true" />{{ t('upd.privacy') }}</span>
        </p>
      </div>
    </template>
    <p v-if="error" class="alert">{{ error }}</p>
    <JobLog v-if="job.running.value || job.status.value?.state === 'failed' || job.error.value" :status="job.status.value" :error="job.error.value" :lines="3" />

    <ConfirmDialog
      v-if="confirmInstall"
      :title="t('upd.confirm.title', { v: st?.latest?.version ?? '' })"
      :message="confirmBody"
      :confirm-label="t('upd.install', { v: st?.latest?.version ?? '' })"
      @confirm="install"
      @cancel="confirmInstall = false"
    />
  </section>
</template>

<style scoped>
.upd {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.75rem 0.9rem 0.8rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 11%, transparent), transparent 55%),
    var(--surface-grad);
  overflow: hidden;
}

/* Filo superior con el tono del estado (como AppCard). */
.upd::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, var(--tone), transparent 80%);
}

/* Sin estado definido, el acento de la marca. */
.upd.tone-muted {
  --tone: var(--accent);
}

/* ------------------------------------------------ Fila principal */
.hero {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 15%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 65%, transparent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone) 8%, transparent);
}

.orb.busy svg,
.spin {
  animation: spin 1s linear infinite;
}

.text {
  flex: 1 1 18rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.cap {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tone);
}

.state {
  font-size: 1.05rem;
  line-height: 1.25;
}

.meta {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.sep {
  margin: 0 0.35rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.actions .btn {
  min-height: 2.75rem;
  gap: 0.45rem;
}

.size {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  background: color-mix(in srgb, var(--accent-ink) 14%, transparent);
}

/* ------------------------------------------------ Modo */
.foot {
  display: flex;
  align-items: center;
  gap: 0.6rem 0.9rem;
  flex-wrap: wrap;
  padding-top: 0.6rem;
  border-top: 1px solid var(--hairline);
}

.seg {
  flex: none;
  display: inline-flex;
  padding: 3px;
  gap: 3px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.seg button {
  min-height: 2.5rem;
  padding: 0 0.95rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  cursor: var(--cursor-point);
  transition: background-color 0.12s, color 0.12s;
}

.seg button[aria-checked='true'] {
  color: var(--accent-ink);
  background: var(--accent);
}

.seg button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.hint {
  flex: 1 1 16rem;
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--text-faint);
}

.privacy {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.3rem;
}

.privacy svg {
  flex: none;
  color: var(--ok);
}

.alert {
  padding: 0.45rem 0.7rem;
  border-radius: var(--radius);
  font-size: 0.84rem;
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--warn) 50%, var(--border));
  background: color-mix(in srgb, var(--warn) 9%, transparent);
}

.notes summary {
  cursor: var(--cursor-point);
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--tone);
}

.notes pre {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.82rem;
  max-height: 14rem;
  overflow: auto;
  margin: 0.4rem 0 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Móvil: acciones y modo a todo el ancho. */
@media (max-width: 640px) {
  .actions,
  .seg {
    width: 100%;
  }

  .actions .btn,
  .seg button {
    flex: 1;
  }

  .seg button {
    padding: 0 0.4rem;
  }
}
</style>
