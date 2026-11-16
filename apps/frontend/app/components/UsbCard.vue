<script setup lang="ts">
import { BellRing, HardDriveUpload, RefreshCw, Unplug, Usb } from '@lucide/vue'
import { formatBytes } from '~/utils/format'

/**
 * Memoria USB de Survival OS (versión portable, ADR 0019): «abrir al conectar esta memoria» en este equipo,
 * expulsarla con seguridad y preparar otra memoria lista para Windows, macOS y Linux.
 */
const t = useT()
const { usb, load, autoOpen, eject } = usePortableUsb()
const prepareJob = useAdminJob('usb-prepare', () => void load(true))
const busy = ref(false)
const error = ref<string | null>(null)
const confirmEject = ref(false)
const confirmPrepare = ref(false)
const ejecting = ref(false)
const target = ref('')
const withData = ref(false)
const rename = ref(true)
const scanning = ref(false)

onMounted(() => void load())

const vol = computed(() => usb.value?.volume)
const ao = computed(() => usb.value?.autoOpen)
const chosen = computed(() => usb.value?.media.find((m) => m.media === target.value) ?? null)
const need = computed(() => (usb.value ? usb.value.prepare.appBytes + (withData.value ? usb.value.prepare.dataBytes : 0) : 0))
const fits = computed(() => !chosen.value || need.value < chosen.value.freeBytes - 64 * 1024 * 1024)
const bigSkipped = computed(() => (withData.value && chosen.value?.fs === 'fat32' ? (usb.value?.prepare.bigData.length ?? 0) : 0))
const volName = computed(() => vol.value?.label || vol.value?.mount || '')

watch(
  () => usb.value?.media,
  (list) => {
    if (!list?.length) target.value = ''
    else if (!list.some((m) => m.media === target.value)) target.value = list[0]!.media
  },
)

async function run(fn: () => Promise<void>): Promise<void> {
  busy.value = true
  error.value = null
  try {
    await fn()
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function rescan(): Promise<void> {
  scanning.value = true
  await load(true)
  scanning.value = false
}

async function doEject(): Promise<void> {
  confirmEject.value = false
  await run(async () => {
    await eject()
    ejecting.value = true
  })
}

function prepare(): void {
  confirmPrepare.value = false
  void prepareJob.start({ media: target.value, withData: withData.value, rename: rename.value })
}
</script>

<template>
  <AppCard class="span-all" :title="t('usb.title')" :icon="Usb" :tone="vol?.removable ? 'ok' : 'info'" :pill="vol?.removable ? volName : undefined">
    <!-- Esta memoria -->
    <template v-if="vol?.removable">
      <p>
        {{ t('usb.here', { name: volName }) }}
        <span v-if="vol.fs" class="faint">· {{ fsLabel(vol.fs) }}</span>
      </p>
      <p v-if="vol.fs === 'fat32'" class="warn small">{{ t('usb.fat32') }}</p>

      <h3 class="cap"><BellRing :size="14" aria-hidden="true" /> {{ t('usb.autoOpen') }}</h3>
      <p class="faint small">{{ t('usb.autoOpenHint') }}</p>
      <p v-if="ao && !ao.supported" class="warn small">{{ t('usb.autoOpenUnsupported', { reason: translateServer(ao.reason ?? '') }) }}</p>
      <template v-else-if="ao">
        <div class="row">
          <button v-if="!ao.paired" type="button" class="btn btn-primary" :disabled="busy" @click="run(() => autoOpen('enable', 'ask'))">
            <BellRing :size="18" aria-hidden="true" />{{ t('usb.autoOpenEnable') }}
          </button>
          <template v-else>
            <StatePill tone="ok" :label="t('usb.autoOpenOn')" />
            <button type="button" class="btn" :disabled="busy" @click="run(() => autoOpen('disable'))">{{ t('usb.autoOpenDisable') }}</button>
          </template>
        </div>
        <div v-if="ao.paired" class="modes" role="radiogroup" :aria-label="t('usb.autoOpen')">
          <label v-for="m in (['ask', 'open'] as const)" :key="m" class="check">
            <input type="radio" name="usb-mode" :checked="ao.mode === m" :disabled="busy" @change="run(() => autoOpen('update', m))" />
            {{ t(`usb.mode.${m}`) }}
          </label>
          <p class="faint small">{{ t('usb.shortcut') }}</p>
        </div>
      </template>

      <h3 class="cap"><Unplug :size="14" aria-hidden="true" /> {{ t('usb.eject') }}</h3>
      <p class="faint small">{{ t('usb.ejectHint') }}</p>
      <div class="row">
        <button type="button" class="btn btn-danger" :disabled="busy || ejecting" @click="confirmEject = true">
          <Unplug :size="18" aria-hidden="true" />{{ t('usb.eject') }}
        </button>
        <span v-if="ejecting" class="ok small" role="status">{{ t('usb.ejecting') }}</span>
      </div>
    </template>
    <p v-else-if="usb" class="faint small">{{ t('usb.notHere') }}</p>

    <!-- Preparar otra memoria -->
    <h3 class="cap"><HardDriveUpload :size="14" aria-hidden="true" /> {{ t('usb.prepare') }}</h3>
    <p class="small">{{ t('usb.prepareHint') }}</p>
    <template v-if="usb">
      <p v-if="!usb.prepare.allPlatforms" class="warn small">{{ t('usb.prepareOnly', { list: usb.prepare.runtimes.join(', ') }) }}</p>
      <div class="row">
        <select v-model="target" class="ui-field" :disabled="!usb.media.length || prepareJob.running.value">
          <option v-if="!usb.media.length" value="" disabled>{{ t('usb.prepareNone') }}</option>
          <option v-for="m in usb.media" :key="m.media" :value="m.media">
            {{ m.label || m.media }}{{ m.fs ? ` · ${fsLabel(m.fs)}` : '' }} · {{ t('usb.free', { free: formatBytes(m.freeBytes), total: formatBytes(m.totalBytes) }) }}
          </option>
        </select>
        <button type="button" class="btn" :disabled="scanning || prepareJob.running.value" @click="rescan">
          <RefreshCw :size="18" aria-hidden="true" />{{ t('usb.refresh') }}
        </button>
      </div>
      <template v-if="chosen">
        <p v-if="chosen.hasSurvival" class="ok small">{{ t('usb.hasSurvival') }}</p>
        <p v-if="chosen.fs === 'fat32'" class="warn small">{{ t('usb.fat32') }}</p>
        <label class="check"><input v-model="withData" type="checkbox" /> {{ t('usb.withData', { size: formatBytes(usb.prepare.dataBytes) }) }}</label>
        <p v-if="bigSkipped" class="warn small">{{ t('usb.bigSkipped', { n: bigSkipped }) }}</p>
        <label class="check"><input v-model="rename" type="checkbox" /> {{ t('usb.rename') }}</label>
        <p class="small" :class="fits ? 'faint' : 'warn'">
          {{ fits ? t('usb.size', { size: formatBytes(need) }) : t('usb.noSpace', { need: formatBytes(need), free: formatBytes(chosen.freeBytes) }) }}
        </p>
        <button type="button" class="btn btn-primary" :disabled="!fits || prepareJob.running.value" @click="confirmPrepare = true">
          <HardDriveUpload :size="18" aria-hidden="true" />{{ prepareJob.running.value ? t('usb.preparing') : t('usb.prepareGo') }}
        </button>
      </template>
      <JobLog :status="prepareJob.status.value" :error="prepareJob.error.value" :lines="5" />
      <p v-if="prepareJob.status.value?.result === 'success' && !prepareJob.running.value" class="ok small" role="status">{{ t('usb.prepareDone') }}</p>
    </template>
    <p v-if="error" class="warn small" role="alert">{{ error }}</p>

    <ConfirmDialog
      v-if="confirmEject" :title="t('usb.ejectTitle')" :message="t('usb.ejectBody')" :confirm-label="t('usb.eject')" danger
      @confirm="doEject" @cancel="confirmEject = false"
    />
    <ConfirmDialog
      v-if="confirmPrepare && chosen" :title="t('usb.prepare')"
      :message="`${t('usb.prepareConfirm', { name: chosen.label || chosen.media })} ${t('usb.size', { size: formatBytes(need) })}`"
      :confirm-label="t('usb.prepareGo')" @confirm="prepare" @cancel="confirmPrepare = false"
    />
  </AppCard>
</template>

<style scoped>
.cap {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.7rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.row .ui-field {
  flex: 1 1 16rem;
  min-width: 0;
}

.modes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.2rem;
  align-items: center;
}

.modes p {
  flex-basis: 100%;
  margin: 0;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--touch);
  cursor: pointer;
}

.check input {
  width: 1.4rem;
  height: 1.4rem;
  accent-color: var(--accent);
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
</style>
