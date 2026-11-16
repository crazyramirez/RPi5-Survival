<script setup lang="ts">
import { BookOpen, FileText, FolderOpen, HardDriveDownload, Map as MapIcon, Power, Usb, Wifi } from '@lucide/vue'
import type { Component } from 'vue'
import type { PortableStatus } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * Versión portable (ADR 0014) en Mantenimiento: dónde se ejecuta, carpetas para añadir contenido,
 * «Instalar en este equipo» y «Cerrar Survival OS».
 */
const t = useT()
const st = ref<PortableStatus | null>(null)
const error = ref<string | null>(null)
const confirmInstall = ref(false)
const confirmQuit = ref(false)
const closed = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  st.value = await $fetch<PortableStatus>('/api/portable/status', { timeout: 8000, retry: 0 }).catch(() => st.value)
  if (st.value?.installJob.state !== 'running' && timer) {
    clearInterval(timer)
    timer = undefined
  }
}
onMounted(load)
onBeforeUnmount(() => timer && clearInterval(timer))

const FOLDERS: { key: 'maps' | 'docs' | 'zim' | 'data'; icon: Component }[] = [
  { key: 'maps', icon: MapIcon },
  { key: 'docs', icon: FileText },
  { key: 'zim', icon: BookOpen },
  { key: 'data', icon: FolderOpen },
]

async function openFolder(folder: string): Promise<void> {
  error.value = null
  await postAction('/api/portable/open-folder', { folder }).catch((err: unknown) => (error.value = actionErrorMessage(err)))
}

async function install(): Promise<void> {
  confirmInstall.value = false
  error.value = null
  try {
    await postAction('/api/portable/install')
    timer = setInterval(() => void load(), 1000)
    await load()
  } catch (err) {
    error.value = actionErrorMessage(err)
  }
}

const sharing = ref(false)
async function toggleShare(): Promise<void> {
  sharing.value = true
  error.value = null
  try {
    await postAction('/api/portable/share', { on: !st.value?.share.on })
    await new Promise((r) => setTimeout(r, 1200)) // el lanzador arranca la pasarela
    await load()
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    sharing.value = false
  }
}

async function quit(): Promise<void> {
  confirmQuit.value = false
  try {
    await quitPortable()
    closed.value = true
  } catch (err) {
    error.value = actionErrorMessage(err)
  }
}

const job = computed(() => st.value?.installJob)
</script>

<template>
  <AppCard class="span-all" :title="t('portable.title')" :icon="Usb" tone="info">
    <p>{{ t('portable.intro') }}</p>
    <dl v-if="st" class="kv">
      <div><dt>{{ t('portable.runningFrom') }}</dt><dd class="mono">{{ st.root }}</dd></div>
      <div><dt>{{ t('portable.free') }}</dt><dd class="mono">{{ st.freeBytes != null ? formatBytes(st.freeBytes) : t('common.none') }}</dd></div>
    </dl>

    <h3 class="cap">{{ t('portable.folders') }}</h3>
    <p class="faint small">{{ t('portable.foldersHint') }}</p>
    <div class="folders">
      <button v-for="f in FOLDERS" :key="f.key" type="button" class="btn" @click="openFolder(f.key)">
        <component :is="f.icon" :size="18" aria-hidden="true" />{{ t(`portable.folder.${f.key}` as never) }}
      </button>
    </div>

    <h3 class="cap">{{ t('portable.install') }}</h3>
    <template v-if="st?.install">
      <p v-if="st.install.installedHere" class="ok small">{{ t('portable.installedHere') }}</p>
      <p v-else-if="!st.install.supported" class="warn small">{{ t('portable.installUnsupported') }}</p>
      <template v-else>
        <p class="small">
          {{ st.install.update ? t('portable.installUpdate', { dest: st.install.dest }) : t('portable.installHint', { dest: st.install.dest }) }}
          {{ t('portable.installSize', { size: formatBytes(st.install.bytes) }) }}
        </p>
        <div class="row">
          <button type="button" class="btn btn-primary" :disabled="job?.state === 'running'" @click="confirmInstall = true">
            <HardDriveDownload :size="18" aria-hidden="true" />{{ job?.state === 'running' ? t('portable.installRunning') : t('portable.installButton') }}
          </button>
          <span v-if="job?.state === 'running' && job.message" class="faint small">{{ job.message }}</span>
        </div>
        <p v-if="job?.state === 'done'" class="ok small" role="status">
          {{ t('portable.installDone', { dest: job.dest ?? '' }) }} {{ t('portable.installShortcuts', { list: job.shortcuts.join(' · ') }) }}
        </p>
        <p v-if="job?.state === 'failed'" class="warn small" role="alert">{{ t('portable.installFailed', { error: job.message ?? '' }) }}</p>
      </template>
    </template>

    <h3 class="cap">{{ t('portable.share') }}</h3>
    <p class="faint small">{{ t('portable.shareHint') }}</p>
    <div class="row">
      <button type="button" class="btn" :class="{ 'btn-primary': !st?.share.on }" :disabled="sharing" @click="toggleShare">
        <Wifi :size="18" aria-hidden="true" />{{ st?.share.on ? t('portable.shareOff') : t('portable.shareOn') }}
      </button>
      <strong v-if="st?.share.on && st.share.url" class="mono share-url selectable">{{ st.share.url }}</strong>
    </div>
    <p v-if="st?.share.on" class="faint small">{{ t('portable.shareFirewall') }}</p>
    <p v-if="st?.share.error" class="warn small" role="alert">{{ st.share.error }}</p>

    <h3 class="cap">{{ t('portable.quit') }}</h3>
    <p class="faint small">{{ t('portable.quitHint') }}</p>
    <div class="row">
      <button type="button" class="btn btn-danger" :disabled="closed" @click="confirmQuit = true">
        <Power :size="18" aria-hidden="true" />{{ t('portable.quit') }}
      </button>
      <span v-if="closed" class="ok small" role="status">{{ t('portable.closing') }}</span>
    </div>
    <p v-if="error" class="warn small" role="alert">{{ error }}</p>
    <p class="faint small note">{{ t('portable.notAvailable') }}</p>

    <ConfirmDialog
      v-if="confirmInstall && st?.install"
      :title="t('portable.install')"
      :message="`${st.install.update ? t('portable.installUpdate', { dest: st.install.dest }) : t('portable.installHint', { dest: st.install.dest })} ${t('portable.installSize', { size: formatBytes(st.install.bytes) })}`"
      :confirm-label="t('portable.installButton')"
      @confirm="install"
      @cancel="confirmInstall = false"
    />
    <ConfirmDialog v-if="confirmQuit" :title="t('portable.quitTitle')" :message="t('portable.quitBody')" :confirm-label="t('portable.quit')" danger @confirm="quit" @cancel="confirmQuit = false" />
  </AppCard>
</template>

<style scoped>
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.4rem;
  margin: 0.2rem 0 0.4rem;
}

.kv div {
  min-width: 0;
}

.kv dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.kv dd {
  margin: 0.1rem 0 0;
  overflow-wrap: anywhere;
}

.cap {
  margin-top: 0.6rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.folders {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.5rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.small {
  font-size: 0.85rem;
}

.ok {
  color: var(--ok);
}

.warn {
  color: var(--warn);
}

.note {
  margin-top: 0.6rem;
}

.share-url {
  font-size: 1.1rem;
  color: var(--accent);
}
</style>
