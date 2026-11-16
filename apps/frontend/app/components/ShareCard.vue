<script setup lang="ts">
import { Wifi, WifiOff } from '@lucide/vue'
import type { PortableStatus } from '@survival-os/shared-types'

/**
 * «Compartir en la red local» (versión portable, ADR 0016): equivalente del punto de acceso Wi-Fi de
 * la Pi. Vista pública de SOLO LECTURA en la IP privada del equipo; nunca se activa sola.
 */
const t = useT()
const android = useAndroid()
const st = ref<PortableStatus | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  st.value = await $fetch<PortableStatus>('/api/portable/status', { timeout: 8000, retry: 0 }).catch(() => st.value)
}
onMounted(load)

async function toggle(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    await postAction('/api/portable/share', { on: !st.value?.share.on })
    await new Promise((r) => setTimeout(r, 1200)) // el lanzador arranca la pasarela
    await load()
  } catch (err) {
    error.value = actionErrorMessage(err)
  } finally {
    busy.value = false
  }
}

const on = computed(() => !!st.value?.share.on)
</script>

<template>
  <AppCard :title="t('portable.share')" :icon="on ? Wifi : WifiOff" :tone="on ? 'ok' : 'muted'" :pill="on ? t('mnt.net.on') : t('mnt.net.off')">
    <p>{{ t('portable.shareHint') }}</p>
    <div v-if="on && st?.share.url" class="url">
      <span class="faint small">{{ t('portable.shareOpen') }}</span>
      <strong class="mono selectable">{{ st.share.url }}</strong>
    </div>
    <button type="button" class="btn" :class="{ 'btn-primary': !on }" :disabled="busy || !st" @click="toggle">
      <component :is="on ? WifiOff : Wifi" :size="18" aria-hidden="true" />{{ on ? t('portable.shareOff') : t('portable.shareOn') }}
    </button>
    <p v-if="on" class="faint small">{{ android ? t('android.shareHint') : t('portable.shareFirewall') }}</p>
    <p v-else-if="android" class="faint small">{{ t('android.shareHotspot') }}</p>
    <p v-if="st?.share.error || error" class="warn small" role="alert">{{ st?.share.error ?? error }}</p>
  </AppCard>
</template>

<style scoped>
.url {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.url strong {
  font-size: clamp(1.05rem, 0.9rem + 0.6vw, 1.4rem);
  color: var(--accent);
  overflow-wrap: anywhere;
}

.small {
  font-size: 0.85rem;
}

.warn {
  color: var(--warn);
}
</style>
