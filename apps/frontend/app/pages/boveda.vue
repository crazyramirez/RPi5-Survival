<script setup lang="ts">
import type { Component } from 'vue'
import {
  File as FileIcon,
  FileImage,
  FileText,
  FileType,
  FileUp,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Usb,
  Vault,
  X,
} from '@lucide/vue'
import type { RemovableFile, VaultFile, VaultStatus } from '@survival-os/shared-types'
import type { Tone } from '~/utils/alerts'
import { formatBytes, formatDuration } from '~/utils/format'

const t = useT()
const isLocal = ref(true)
const st = ref<VaultStatus | null>(null)
const down = ref(false)
const files = ref<VaultFile[]>([])
const removable = ref<RemovableFile[] | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

const pass = ref('')
const pass2 = ref('')
const sizeMiB = ref(1024)
const preview = ref<{ file: VaultFile; url: string } | null>(null)
const pendingDelete = ref<VaultFile | null>(null)

// ---- Renombrar: se edita el nombre; la extensión se conserva (de ella dependen el tipo y la vista previa).
const renaming = ref<{ file: VaultFile; base: string; ext: string } | null>(null)
function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 && i >= name.length - 6 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' }
}
function startRename(f: VaultFile): void {
  renaming.value = { file: f, ...splitName(f.name) }
}
function saveRename(): Promise<void> {
  const r = renaming.value
  if (!r) return Promise.resolve()
  const name = `${r.base.trim()}${r.ext}`
  renaming.value = null
  if (!r.base.trim() || name === r.file.name) return Promise.resolve()
  return act(async () => {
    await vaultFetch(`files/${r.file.id}`, { method: 'PATCH', body: { name } })
    if (preview.value?.file.id === r.file.id) preview.value = { ...preview.value, file: { ...preview.value.file, name } }
  })
}
const fileInput = ref<HTMLInputElement | null>(null)
const now = ref(Date.now())

async function vaultFetch<T>(path: string, opts: Record<string, unknown> = {}): Promise<T> {
  return await ($fetch as (u: string, o: Record<string, unknown>) => Promise<T>)(`/api/vault/${path}`, {
    timeout: 600_000,
    retry: 0,
    ...opts,
    headers: { 'x-survival-action': '1', ...((opts.headers as Record<string, string>) ?? {}) },
  })
}

async function refresh(): Promise<void> {
  try {
    st.value = await vaultFetch<VaultStatus>('status')
    down.value = false
    if (st.value.unlocked) files.value = await vaultFetch<VaultFile[]>('files')
    else clearSensitive()
  } catch {
    down.value = true
  }
}

function clearSensitive(): void {
  files.value = []
  removable.value = null
  if (preview.value) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}

async function act(fn: () => Promise<void>): Promise<void> {
  error.value = null
  busy.value = true
  try {
    await fn()
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    busy.value = false
    await refresh()
  }
}

function setup(): Promise<void> {
  return act(async () => {
    if (pass.value !== pass2.value) throw Object.assign(new Error(t('vault.mismatch')), { statusMessage: t('vault.mismatch') })
    try {
      await vaultFetch('setup', { method: 'POST', body: { passphrase: pass.value, sizeMiB: sizeMiB.value } })
    } finally {
      pass.value = ''
      pass2.value = ''
    }
  })
}

function unlock(): Promise<void> {
  return act(async () => {
    try {
      await vaultFetch('unlock', { method: 'POST', body: { passphrase: pass.value } })
    } finally {
      pass.value = ''
    }
  })
}

function lock(): Promise<void> {
  clearSensitive()
  return act(async () => {
    await vaultFetch('lock', { method: 'POST' })
  })
}

async function open(f: VaultFile): Promise<void> {
  error.value = null
  try {
    const res = await fetch(`/api/vault/files/${f.id}/raw`, { cache: 'no-store' })
    if (!res.ok) throw new Error(t('vault.openFailed'))
    if (preview.value) URL.revokeObjectURL(preview.value.url)
    preview.value = { file: f, url: URL.createObjectURL(await res.blob()) }
  } catch (err) {
    error.value = actionErrorMessage(err)
  }
}

function closePreview(): void {
  if (preview.value) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}

function upload(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  return act(async () => {
    if (!file) return
    await vaultFetch(`files?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } })
    if (fileInput.value) fileInput.value.value = ''
  })
}

function loadRemovable(): Promise<void> {
  return act(async () => {
    removable.value = await vaultFetch<RemovableFile[]>('removable')
  })
}

function importFile(r: RemovableFile): Promise<void> {
  return act(async () => {
    await vaultFetch('import', { method: 'POST', body: { media: r.media, path: r.path } })
  })
}

function confirmDelete(): Promise<void> {
  const f = pendingDelete.value
  pendingDelete.value = null
  return act(async () => {
    if (f) await vaultFetch(`files/${f.id}`, { method: 'DELETE' })
    if (preview.value?.file.id === f?.id) closePreview()
  })
}

const lockIn = computed(() => (st.value?.lockAt ? Math.max(0, Math.round((Date.parse(st.value.lockAt) - now.value) / 1000)) : null))
const kind = (f: VaultFile): 'image' | 'pdf' | 'text' | 'other' =>
  f.mime.startsWith('image/') ? 'image' : f.mime === 'application/pdf' ? 'pdf' : f.mime.startsWith('text/') ? 'text' : 'other'

// ------------------------------------------------------------------ Solo presentación

const FILE_ICONS: Record<ReturnType<typeof kind>, Component> = { image: FileImage, pdf: FileText, text: FileType, other: FileIcon }
const fileIcon = (f: VaultFile): Component => FILE_ICONS[kind(f)]

/** Cuenta atrás m:ss del bloqueo automático (dato del servicio: lockAt). */
const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const lockSoon = computed(() => lockIn.value !== null && lockIn.value < 60)
/** Fracción restante hasta el bloqueo; null si no hay medida (no se dibuja la barra). */
const lockRatio = computed(() =>
  st.value?.unlocked && lockIn.value !== null && st.value.autoLockSeconds > 0 ? Math.min(1, lockIn.value / st.value.autoLockSeconds) : null,
)

const hero = computed<{ tone: Tone; icon: Component; title: string; sub: string } | null>(() => {
  const s = st.value
  if (!s) return null
  if (!s.configured) return { tone: 'info', icon: KeyRound, title: t('ui.vault.heroSetup'), sub: t('ui.vault.heroSetupSub') }
  if (!s.unlocked) {
    const waiting = s.retryAfterSeconds > 0
    return {
      tone: waiting || s.failedAttempts > 0 ? 'warn' : 'ok',
      icon: waiting ? ShieldAlert : Lock,
      title: t('ui.vault.heroLocked'),
      sub: waiting ? t('vault.wait', { s: s.retryAfterSeconds }) : t('ui.vault.heroLockedSub'),
    }
  }
  return { tone: 'warn', icon: LockOpen, title: t('ui.vault.heroUnlocked'), sub: t('ui.vault.heroUnlockedSub') }
})

const heroStats = computed<{ key: string; label: string; value: string; tone?: Tone }[]>(() => {
  const s = st.value
  if (!s) return []
  const none = t('common.none')
  if (!s.configured) {
    return [{ key: 'cs', label: t('ui.vault.cryptsetup'), value: s.cryptsetup ? t('state.yes') : t('state.no'), tone: s.cryptsetup ? 'ok' : 'danger' }]
  }
  const container = { key: 'size', label: t('ui.vault.container'), value: s.containerBytes != null ? formatBytes(s.containerBytes) : none }
  if (!s.unlocked) {
    return [
      container,
      { key: 'fails', label: t('ui.vault.attempts'), value: String(s.failedAttempts), tone: s.failedAttempts > 0 ? 'warn' : undefined },
      { key: 'auto', label: t('ui.vault.autolockAfter'), value: formatDuration(s.autoLockSeconds) },
    ]
  }
  return [
    { key: 'lock', label: t('ui.vault.lockIn'), value: lockIn.value !== null ? clock(lockIn.value) : none, tone: lockSoon.value ? 'warn' : undefined },
    { key: 'free', label: t('ui.vault.freeLabel'), value: s.freeBytes != null ? formatBytes(s.freeBytes) : none },
    { key: 'docs', label: t('ui.vault.docsLabel'), value: String(files.value.length) },
    container,
  ]
})

let timer: ReturnType<typeof setInterval> | undefined
let lastTouch = 0
function activity(): void {
  if (!st.value?.unlocked || Date.now() - lastTouch < 30_000) return
  lastTouch = Date.now()
  void vaultFetch('touch', { method: 'POST' }).catch(() => undefined)
}

onMounted(() => {
  isLocal.value = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  if (!isLocal.value) return
  void refresh()
  timer = setInterval(() => {
    now.value = Date.now()
    if (lockIn.value === 0 || (st.value?.retryAfterSeconds ?? 0) > 0) void refresh()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  clearSensitive()
})
</script>

<template>
  <div class="page" @pointerdown="activity">
    <PageHeader :title="t('module.vault')" :icon="Vault" :phase="5" />

    <!-- Acceso remoto: la bóveda solo responde en loopback. -->
    <section v-if="!isLocal" class="hero tone-danger">
      <span class="orb" aria-hidden="true"><ShieldAlert :size="28" /></span>
      <div class="hero-text">
        <h2>{{ t('ui.vault.heroRestricted') }}</h2>
        <p class="wrap">{{ t('vault.localOnly') }}</p>
      </div>
    </section>

    <template v-else>
      <div v-if="down" class="notice tone-danger" role="alert"><ShieldAlert :size="18" aria-hidden="true" /><span>{{ t('vault.down') }}</span></div>
      <div v-if="error" class="notice tone-danger err" role="alert"><TriangleAlert :size="18" aria-hidden="true" /><strong>{{ error }}</strong></div>

      <!-- Estado de la bóveda -->
      <section v-if="hero" class="hero" :class="`tone-${hero.tone}`">
        <span class="orb" aria-hidden="true"><component :is="hero.icon" :size="28" /></span>
        <div class="hero-text">
          <h2>{{ hero.title }}</h2>
          <p>{{ hero.sub }}</p>
          <p class="hero-id mono">{{ t('ui.vault.cipher') }}</p>
        </div>
        <dl class="hero-stats">
          <div v-for="h in heroStats" :key="h.key">
            <dt>{{ h.label }}</dt>
            <dd class="mono" :class="h.tone ? `tone-${h.tone} toned` : ''">{{ h.value }}</dd>
          </div>
        </dl>
        <!-- Cuenta atrás real del bloqueo automático (solo desbloqueada y con lockAt). -->
        <span v-if="lockRatio !== null" class="hero-bar" :class="lockSoon ? 'tone-warn' : 'tone-ok'" aria-hidden="true">
          <span :style="{ transform: `scaleX(${lockRatio})` }" />
        </span>
      </section>

      <!-- Sin configurar -->
      <div v-if="st && !st.configured" class="bento">
        <AppCard :title="t('vault.setup')" :icon="KeyRound" tone="info">
          <p>{{ t('vault.design') }}</p>
          <input v-model="pass" type="password" class="ui-field pass" autocomplete="new-password" :placeholder="t('vault.pass')" />
          <input v-model="pass2" type="password" class="ui-field pass" autocomplete="new-password" :placeholder="t('vault.pass2')" />
          <span class="cap">{{ t('ui.vault.size') }}</span>
          <div class="seg" role="group" :aria-label="t('ui.vault.size')">
            <button v-for="s in [512, 1024, 4096]" :key="s" type="button" class="seg-btn mono" :aria-pressed="sizeMiB === s" @click="sizeMiB = s">
              {{ formatBytes(s * 1024 * 1024) }}
            </button>
          </div>
          <button type="button" class="btn btn-primary big" :disabled="busy || !pass || !st.cryptsetup" @click="setup">
            <KeyRound :size="20" aria-hidden="true" />
            {{ busy ? t('vault.creating') : t('vault.create') }}
          </button>
          <span v-if="!st.cryptsetup" class="err-line"><TriangleAlert :size="16" aria-hidden="true" />{{ t('vault.noCryptsetup') }}</span>
        </AppCard>

        <AppCard :title="t('ui.vault.security')" :icon="ShieldAlert" tone="warn">
          <div class="sec-item tone-warn"><ShieldAlert :size="20" aria-hidden="true" /><span>{{ t('vault.passWarning') }}</span></div>
          <div class="sec-item tone-danger"><ShieldAlert :size="20" aria-hidden="true" /><span>{{ t('vault.never') }}</span></div>
        </AppCard>
      </div>

      <!-- Bloqueada -->
      <div v-else-if="st && !st.unlocked" class="bento">
        <AppCard :title="t('ui.vault.unlockTitle')" :icon="KeyRound" :tone="st.retryAfterSeconds > 0 ? 'warn' : 'ok'">
          <form class="stack" @submit.prevent="unlock">
            <input v-model="pass" type="password" class="ui-field pass selectable" autocomplete="current-password" :placeholder="t('vault.pass')" />
            <button type="submit" class="btn btn-primary big" :disabled="busy || !pass || st.retryAfterSeconds > 0">
              <LockOpen :size="20" aria-hidden="true" />
              {{ busy ? t('vault.opening') : st.retryAfterSeconds > 0 ? t('vault.wait', { s: st.retryAfterSeconds }) : t('vault.unlock') }}
            </button>
          </form>
          <span v-if="st.failedAttempts" class="ui-chip tone-warn attempts"><TriangleAlert :size="14" aria-hidden="true" />{{ t('vault.attempts', { n: st.failedAttempts }) }}</span>
        </AppCard>

        <AppCard :title="t('ui.vault.security')" :icon="ShieldCheck" tone="info">
          <div class="sec-item tone-info"><ShieldCheck :size="20" aria-hidden="true" /><span>{{ t('vault.localOnly') }}</span></div>
          <div class="sec-item tone-danger"><ShieldAlert :size="20" aria-hidden="true" /><span>{{ t('vault.never') }}</span></div>
        </AppCard>
      </div>

      <!-- Desbloqueada -->
      <template v-else-if="st?.unlocked">
        <div class="ctl-grid">
          <label class="ctl">
            <FileUp :size="24" aria-hidden="true" />
            <span><strong>{{ t('vault.upload') }}</strong><small>{{ t('ui.vault.uploadHint') }}</small></span>
            <input ref="fileInput" type="file" hidden @change="upload" />
          </label>
          <button type="button" class="ctl" :disabled="busy" @click="loadRemovable">
            <Usb :size="24" aria-hidden="true" />
            <span><strong>{{ t('vault.fromUsb') }}</strong><small>{{ t('ui.vault.usbHint') }}</small></span>
          </button>
          <button type="button" class="ctl ctl-danger tone-danger" @click="lock">
            <Lock :size="24" aria-hidden="true" />
            <span><strong>{{ t('vault.lock') }}</strong><small>{{ t('ui.vault.lockHint') }}</small></span>
          </button>
        </div>

        <div class="notice tone-warn never"><ShieldAlert :size="18" aria-hidden="true" /><span>{{ t('vault.never') }}</span></div>

        <template v-if="removable">
          <h2 class="ui-sec">{{ t('vault.fromUsb') }}</h2>
          <div class="list usb">
            <p v-if="!removable.length" class="empty">{{ t('vault.usb.none') }}</p>
            <button v-for="r in removable" :key="r.media + r.path" type="button" class="ui-row item" :disabled="busy" @click="importFile(r)">
              <span class="ficon tone-info" aria-hidden="true"><Usb :size="18" /></span>
              <span class="fmeta">
                <strong class="mono">{{ r.path }}</strong>
                <small>{{ r.media }} · {{ formatBytes(r.sizeBytes) }}</small>
              </span>
              <FileUp :size="18" class="go" aria-hidden="true" />
            </button>
          </div>
        </template>

        <h2 class="ui-sec">{{ t('ui.vault.docs', { n: files.length }) }}</h2>
        <div class="split" :class="{ withPreview: preview && kind(preview.file) !== 'image' }">
          <div class="list">
            <p v-if="!files.length" class="empty"><Vault :size="18" aria-hidden="true" /><span>{{ t('vault.empty') }}</span></p>
            <div v-for="f in files" :key="f.id" class="ui-row frow" :class="{ on: preview?.file.id === f.id }">
              <button type="button" class="item" @click="open(f)">
                <span class="ficon" aria-hidden="true"><component :is="fileIcon(f)" :size="18" /></span>
                <span class="fmeta">
                  <strong>{{ f.name }}</strong>
                  <small>
                    <span class="mono">{{ formatBytes(f.sizeBytes) }}</span>
                    <template v-if="f.tags.length"> · {{ f.tags.join(', ') }}</template>
                  </small>
                </span>
                <span v-if="f.reviewDate" class="ui-chip tone-info review">{{ t('vault.review', { date: f.reviewDate }) }}</span>
              </button>
              <button type="button" class="btn icon" :aria-label="t('ui.vault.rename')" @click="startRename(f)"><Pencil :size="18" /></button>
              <button type="button" class="btn icon del" :aria-label="t('nav.delete')" @click="pendingDelete = f"><Trash2 :size="18" /></button>
            </div>
          </div>
          <!-- Imágenes: visor a pantalla completa con zoom; PDF y texto en la vista lateral. -->
          <ImageViewer v-if="preview && kind(preview.file) === 'image'" :src="preview.url" :name="preview.file.name" @close="closePreview" />
          <div v-if="preview && kind(preview.file) !== 'image'" class="preview">
            <div class="pv-bar">
              <span class="ficon" aria-hidden="true"><component :is="fileIcon(preview.file)" :size="16" /></span>
              <strong class="grow">{{ preview.file.name }}</strong>
              <button type="button" class="btn icon" :aria-label="t('display.close')" @click="closePreview"><X :size="18" /></button>
            </div>
            <img v-if="kind(preview.file) === 'image'" :src="preview.url" :alt="preview.file.name" />
            <iframe v-else-if="kind(preview.file) === 'pdf' || kind(preview.file) === 'text'" :src="preview.url" :title="preview.file.name" />
            <p v-else class="empty">{{ t('vault.noPreview') }}</p>
          </div>
        </div>
      </template>
      <p v-else-if="!down" class="muted">{{ t('state.loading') }}</p>
    </template>

    <ConfirmDialog
      v-if="pendingDelete"
      :title="t('nav.delete.title')"
      :message="t('vault.delete.body', { name: pendingDelete.name })"
      :confirm-label="t('nav.delete')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
    <div v-if="renaming" class="rn-backdrop" @click.self="renaming = null">
      <form class="rn-dialog" @submit.prevent="saveRename">
        <h2><Pencil :size="20" aria-hidden="true" />{{ t('ui.vault.rename') }}</h2>
        <div class="rn-field">
          <input v-model="renaming.base" class="ui-field" maxlength="110" autocomplete="off" :aria-label="t('ui.vault.renameLabel')" />
          <span v-if="renaming.ext" class="rn-ext mono">{{ renaming.ext }}</span>
        </div>
        <div class="rn-actions">
          <button type="button" class="btn" @click="renaming = null">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary" :disabled="!renaming.base.trim() || busy">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------ Estado (resumen) */
.hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 1rem;
  margin-bottom: var(--gap);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 14%, transparent), transparent 55%),
    var(--surface-grad);
  overflow: hidden;
  animation: fade-in 0.16s ease-out;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 70%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--tone) 8%, transparent);
}

.hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.hero-text h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.hero-text p {
  color: var(--text-muted);
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-text p.wrap {
  white-space: normal;
}

.hero-text .hero-id {
  color: var(--text-faint);
  font-size: 0.78rem;
}

.hero-stats {
  flex: none;
  display: flex;
  margin: 0;
}

.hero-stats div {
  padding: 0.15rem 0 0.15rem 1rem;
  margin-left: 1rem;
  border-left: 1px solid var(--border);
}

.hero-stats dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.hero-stats dd {
  margin: 0.2rem 0 0;
  font-size: 1.05rem;
  color: var(--text);
  white-space: nowrap;
}

.toned {
  color: var(--tone) !important;
  font-weight: 700;
}

/* Barra de cuenta atrás: transform (sin relayout), un paso por segundo. */
.hero-bar {
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.hero-bar span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 60%, transparent), var(--tone));
  transform-origin: left center;
  transition: transform 0.3s ease-out;
}

/* ------------------------------------------------------------ Avisos */
.notice {
  margin-bottom: var(--gap);
}

.err strong {
  color: var(--text);
}

.never {
  margin-top: var(--gap);
  font-size: 0.92rem;
}

/* ------------------------------------------------------------ Formularios */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gap);
  align-items: stretch;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.pass {
  width: 100%;
  min-height: 3.5rem;
  padding: 0 0.9rem;
  border-radius: var(--radius);
  font-size: 1.15rem;
  letter-spacing: 0.04em;
}

.big {
  width: 100%;
  min-height: 3.5rem;
  font-size: 1.05rem;
}

.cap {
  margin-top: 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* Selector de tamaño segmentado. */
.seg {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 3px;
  gap: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
}

.seg-btn {
  min-height: var(--touch);
  border: 1px solid transparent;
  border-radius: calc(var(--radius) - 3px);
  background: none;
  color: var(--text-muted);
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s ease-out, background-color 0.12s;
}

.seg-btn:active {
  transform: scale(0.97);
}

.seg-btn[aria-pressed='true'] {
  color: var(--accent-ink);
  border-color: var(--accent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, #fff), var(--accent));
}

.err-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--danger);
  font-weight: 700;
  font-size: 0.9rem;
}

.attempts {
  align-self: flex-start;
  font-weight: 700;
}

/* Texto de seguridad: color pleno (no atenuado) y con icono del tono. */
.sec-item {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.6rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
  background: color-mix(in srgb, var(--tone) 9%, var(--surface));
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.4;
}

.sec-item svg {
  flex: none;
  margin-top: 0.05rem;
  color: var(--tone);
}

/* ------------------------------------------------------------ Acciones */
.ctl-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap);
}

.ctl {
  --tone: var(--accent);
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 4rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: transform 0.08s ease-out, background-color 0.12s;
}

.ctl svg {
  flex: none;
  color: var(--tone);
}

.ctl span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ctl strong {
  font-size: 0.95rem;
  line-height: 1.2;
}

.ctl small {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.25;
}

.ctl:active:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--tone);
  transform: scale(0.97);
}

.ctl:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ctl-danger {
  --tone: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  background: color-mix(in srgb, var(--danger) 16%, var(--surface-2));
}

.ctl-danger:active:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 28%, var(--surface-2));
}

/* ------------------------------------------------------------ Listas */
.split {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--gap);
}

.split.withPreview {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}

.list {
  min-width: 0;
  padding: 0.2rem 0.8rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.usb {
  max-height: 12rem;
  overflow-y: auto;
}

.empty {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.8rem 0.2rem;
  color: var(--text-muted);
  font-size: 0.92rem;
}

.empty svg {
  flex: none;
  margin-top: 0.1rem;
  color: var(--accent);
}

.frow {
  gap: 0.4rem;
}

.frow.on .ficon {
  color: var(--accent-ink);
  background: var(--accent);
}

.item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 3.4rem;
  padding: 0.35rem 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

/* En la lista USB el propio botón es la fila. */
button.ui-row.item {
  border-bottom: 1px solid var(--hairline);
}

button.ui-row.item:last-child {
  border-bottom: none;
}

.item:active:not(:disabled) {
  transform: scale(0.985);
}

.item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ficon {
  --tone: var(--accent);
  flex: none;
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: var(--radius-sm);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.ficon.tone-info {
  --tone: var(--info);
}

.fmeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.fmeta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
}

.fmeta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.review {
  flex: none;
}

.go {
  flex: none;
  color: var(--text-faint);
}

.btn.icon {
  flex: none;
  min-width: var(--touch);
  padding: 0 0.6rem;
}

.del svg {
  color: var(--danger);
}

/* ------------------------------------------------------------ Vista previa */
.preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 18rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: #fff;
  animation: fade-in 0.15s ease-out;
}

.pv-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.4rem 0.35rem 0.6rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface-grad);
  color: var(--text);
}

.pv-bar .ficon {
  width: 1.8rem;
  height: 1.8rem;
}

.grow {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview img {
  max-width: 100%;
  object-fit: contain;
}

.preview iframe {
  flex: 1;
  border: 0;
  min-height: 16rem;
}

.preview .empty {
  padding: 1rem;
  background: var(--surface);
  flex: 1;
}

/* ---------- Renombrar (arriba: el teclado en pantalla aparece abajo) ---------- */
.rn-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3.5rem;
  background: rgb(0 0 0 / 60%);
  animation: fade-in 0.14s ease-out;
}

.rn-dialog {
  width: min(36rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  animation: pop-in 0.16s ease-out;
}

.rn-dialog h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
}

.rn-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.rn-field .ui-field {
  flex: 1;
  min-width: 0;
  font-size: 1.05rem;
}

.rn-ext {
  color: var(--text-muted);
}

.rn-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
</style>
