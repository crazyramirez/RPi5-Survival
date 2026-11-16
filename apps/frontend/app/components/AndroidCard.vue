<script setup lang="ts">
import { BatteryCharging, Bell, FolderCog, HardDrive, Lock, LockOpen, MapPin, PackageCheck, Power, Settings, Tablet } from '@lucide/vue'
import type { Component } from 'vue'
import type { AndroidAction, AndroidStatus } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * App Android (ADR 0020) en Mantenimiento: dispositivo, carpeta de datos, permisos de Android, «Fijar la pantalla»
 * y «Cerrar Survivelia OS». Lo nativo lo hace la app (puente); aquí solo se muestra y se pide.
 */
const t = useT()
const st = ref<AndroidStatus | null>(null)
const error = ref<string | null>(null)
const confirmQuit = ref(false)
const closed = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  st.value = await $fetch<AndroidStatus>('/api/android/status', { timeout: 8000, retry: 0 }).catch(() => st.value)
}
onMounted(() => {
  void load()
  // Los permisos se conceden en pantallas de Android: se refresca al volver.
  timer = setInterval(() => void load(), 4000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

async function act(action: AndroidAction, on?: boolean): Promise<void> {
  error.value = null
  try {
    await postAction('/api/android/action', { action, ...(on !== undefined ? { on } : {}) })
    setTimeout(() => void load(), 1200)
  } catch (err) {
    error.value = actionErrorMessage(err)
  }
}

interface PermRow { key: keyof AndroidStatus['permissions']; action: AndroidAction; icon: Component }
const PERMS: PermRow[] = [
  { key: 'location', action: 'permission-location', icon: MapPin },
  { key: 'allFiles', action: 'permission-files', icon: HardDrive },
  { key: 'battery', action: 'permission-battery', icon: BatteryCharging },
  { key: 'notifications', action: 'permission-notifications', icon: Bell },
  { key: 'installApps', action: 'permission-install', icon: PackageCheck },
]
const perms = computed(() => PERMS.filter((p) => p.key !== 'location' || st.value?.permissions.gnssHardware !== false))

async function quit(): Promise<void> {
  confirmQuit.value = false
  try {
    await quitPortable()
    closed.value = true
  } catch (err) {
    error.value = actionErrorMessage(err)
  }
}
</script>

<template>
  <AppCard class="span-all" :title="t('android.title')" :icon="Tablet" tone="info">
    <p>{{ t('android.intro') }}</p>
    <dl v-if="st" class="kv">
      <div><dt>{{ t('android.device') }}</dt><dd>{{ st.model }} · Android {{ st.android }}</dd></div>
      <div><dt>{{ t('android.version') }}</dt><dd class="mono">{{ st.version }} ({{ st.abi }})</dd></div>
      <div><dt>{{ t('portable.dataDir') }}</dt><dd class="mono">{{ st.dataDir ?? t('common.none') }}</dd></div>
      <div><dt>{{ t('portable.free') }}</dt><dd class="mono">{{ st.freeBytes != null && st.freeBytes >= 0 ? formatBytes(st.freeBytes) : t('common.none') }}</dd></div>
    </dl>
    <p v-if="st?.dataDeletedOnUninstall" class="warn small">{{ t('android.privateWarn') }}</p>
    <div class="row">
      <button type="button" class="btn" @click="act('storage')"><FolderCog :size="18" aria-hidden="true" />{{ t('android.changeStorage') }}</button>
    </div>
    <p class="faint small">{{ t('android.storageHint') }}</p>

    <h3 class="cap">{{ t('android.permissions') }}</h3>
    <p v-if="st && !st.permissions.gnssHardware" class="faint small">{{ t('android.noGnss') }}</p>
    <div class="perms">
      <div v-for="p in perms" :key="p.key" class="ui-row perm" :class="`tone-${st?.permissions[p.key] ? 'ok' : 'warn'}`">
        <component :is="p.icon" :size="18" aria-hidden="true" />
        <span class="grow">
          <strong>{{ t(`android.perm.${p.key}` as never) }}</strong>
          <span class="faint small block">{{ t(`android.perm.${p.key}.hint` as never) }}</span>
        </span>
        <span v-if="st?.permissions[p.key]" class="ok small">{{ t('android.granted') }}</span>
        <button v-else type="button" class="btn small" @click="act(p.action)">{{ t('android.grant') }}</button>
      </div>
    </div>
    <p class="faint small">{{ t('android.oemHint') }}</p>
    <div class="row">
      <button type="button" class="btn" @click="act('app-settings')"><Settings :size="18" aria-hidden="true" />{{ t('android.appSettings') }}</button>
    </div>

    <h3 class="cap">{{ t('android.kiosk') }}</h3>
    <p class="faint small">{{ t('android.kioskHint') }}</p>
    <div class="row">
      <button type="button" class="btn" @click="act('kiosk', !st?.kiosk)">
        <component :is="st?.kiosk ? LockOpen : Lock" :size="18" aria-hidden="true" />{{ st?.kiosk ? t('android.kioskOff') : t('android.kioskOn') }}
      </button>
    </div>

    <h3 class="cap">{{ t('portable.quit') }}</h3>
    <p class="faint small">{{ t('android.quitHint') }}</p>
    <div class="row">
      <button type="button" class="btn btn-danger" :disabled="closed" @click="confirmQuit = true">
        <Power :size="18" aria-hidden="true" />{{ t('portable.quit') }}
      </button>
    </div>
    <p v-if="error" class="warn small" role="alert">{{ error }}</p>
    <p class="faint small note">{{ t('android.notAvailable') }}</p>

    <ConfirmDialog v-if="confirmQuit" :title="t('portable.quitTitle')" :message="t('android.quitBody')" :confirm-label="t('portable.quit')" danger @confirm="quit" @cancel="confirmQuit = false" />
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

.perms {
  display: grid;
  gap: 0.4rem;
}

.perm {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.grow {
  flex: 1;
  min-width: 0;
}

.block {
  display: block;
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
</style>
