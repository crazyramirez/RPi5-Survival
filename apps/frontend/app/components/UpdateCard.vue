<script setup lang="ts">
import { CloudDownload, RefreshCw, RotateCcw, ShieldCheck } from '@lucide/vue'
import type { UpdateMode } from '@survival-os/shared-types'
import type { MessageKey } from '~/locales/es'
import { formatBytes, formatClock, formatDate } from '~/utils/format'

/**
 * Actualizaciones desde GitHub Releases (ADR 0021) en Mantenimiento: versión instalada y última, novedades,
 * «Buscar ahora», «Instalar» y el modo (Automática / Solo avisar / Desactivada). Todo honesto: sin comprobación
 * no se muestra ninguna versión «disponible».
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
  <AppCard :title="t('upd.title')" :icon="CloudDownload" :tone="summary.tone" :pill="pill">
    <p class="state" :class="`tone-${summary.tone}`">{{ summary.text }}</p>
    <template v-if="st?.supported">
      <p class="faint small">
        {{ t('upd.installed', { v: st.installed }) }}
        <template v-if="st.latest"> · {{ t('upd.latest', { v: st.latest.version, date: st.latest.date }) }}</template>
      </p>
      <p class="faint small">{{ t('upd.checked', { when: when(st.okAt ?? st.checkedAt) }) }}</p>
      <p v-if="errorText" class="warn small">{{ errorText }}</p>
      <p v-if="st.lastInstall && !st.lastInstall.ok" class="warn small">
        {{ t('upd.last.fail', { v: st.lastInstall.version ?? '?', msg: st.lastInstall.message ?? '' }) }}
      </p>
      <p v-else-if="st.lastInstall?.ok" class="faint small">{{ t('upd.last.ok', { v: st.lastInstall.version ?? '?', when: when(st.lastInstall.at) }) }}</p>

      <details v-if="st.latest?.notes && st.status === 'available'" class="notes">
        <summary>{{ t('upd.notes') }}</summary>
        <pre>{{ st.latest.notes }}</pre>
      </details>

      <div class="row">
        <button type="button" class="btn" :disabled="busy" @click="job.start({ action: 'check' })">
          <RefreshCw :size="18" aria-hidden="true" />{{ t('upd.check') }}
        </button>
        <button v-if="canInstall" type="button" class="btn btn-primary" :disabled="busy" @click="confirmInstall = true">
          <CloudDownload :size="18" aria-hidden="true" />{{ t('upd.install', { v: st.latest?.version ?? '' }) }}
        </button>
        <button v-if="canApplyNow" type="button" class="btn btn-primary" :disabled="busy || applying" @click="doApplyNow">
          <RotateCcw :size="18" aria-hidden="true" />{{ t('upd.applyNow') }}
        </button>
        <button v-if="apkReady" type="button" class="btn btn-primary" @click="openInstaller">
          <CloudDownload :size="18" aria-hidden="true" />{{ t('upd.prompt.openInstaller') }}
        </button>
        <span v-if="canInstall && st.asset" class="faint small">{{ t('upd.size', { size: formatBytes(st.asset.size) }) }}</span>
      </div>

      <fieldset class="modes">
        <legend class="small">{{ t('upd.mode') }}</legend>
        <label v-for="m in MODES" :key="m" class="ui-row check">
          <input type="radio" name="update-mode" :value="m" :checked="st.mode === m" :disabled="busy" @change="changeMode(m)" />
          {{ t(`upd.mode.${m}` as MessageKey) }}
        </label>
        <p class="faint small">{{ modeHint }}</p>
      </fieldset>
      <p class="faint small privacy"><ShieldCheck :size="14" aria-hidden="true" />{{ t('upd.privacy') }}</p>
    </template>
    <p v-if="error" class="warn small">{{ error }}</p>
    <JobLog :status="job.status.value" :error="job.error.value" :lines="5" />

    <ConfirmDialog
      v-if="confirmInstall"
      :title="t('upd.confirm.title', { v: st?.latest?.version ?? '' })"
      :message="confirmBody"
      :confirm-label="t('upd.install', { v: st?.latest?.version ?? '' })"
      @confirm="install"
      @cancel="confirmInstall = false"
    />
  </AppCard>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.state {
  font-weight: 600;
}

.small {
  font-size: 0.82rem;
}

.warn {
  color: var(--warn) !important;
}

.modes {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.4rem 0.7rem 0.5rem;
  margin: 0;
}

.notes pre {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.82rem;
  max-height: 14rem;
  overflow: auto;
  margin: 0.4rem 0 0;
}

.privacy {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
</style>
