<script setup lang="ts">
import { Cpu } from '@lucide/vue'
import type { Esp32Status } from '@survival-os/shared-types'
import { formatNumber } from '~/utils/format'

/** Dispositivos ESP32 por USB serie. Sondeo propio (5 s) solo mientras la tarjeta está visible. */
const t = useT()
const st = ref<Esp32Status | null>(null)
const down = ref(false)

async function load(): Promise<void> {
  try {
    st.value = await $fetch<Esp32Status>('/api/esp32/status', { timeout: 4000, retry: 0 })
    down.value = false
  } catch {
    down.value = true
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => !document.hidden && void load(), 5000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const ago = (iso: string | null): string => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))} s` : '—')
</script>

<template>
  <AppCard
    :title="t('esp.title')"
    :icon="Cpu"
    :tone="st?.devices.some((d) => d.connected) ? 'ok' : 'muted'"
    :pill="down ? t('state.unavailable') : t('esp.count', { n: st?.devices.filter((d) => d.connected).length ?? 0 })"
  >
    <p v-if="down">{{ t('esp.down') }}</p>
    <p v-else-if="st && !st.devices.length">{{ t('esp.none') }}</p>
    <div v-for="d in st?.devices ?? []" :key="d.port" class="dev">
      <KvRow :label="d.id" :value="d.connected ? t('esp.connected', { ago: ago(d.lastSeen) }) : t('esp.disconnected')" :tone="d.connected ? 'ok' : 'warn'" />
      <KvRow v-for="r in d.readings" :key="r.sensor" :label="r.sensor" :value="`${formatNumber(r.value, 2)} ${r.unit}`" mono />
      <p class="faint mono">{{ d.port }} · {{ d.chip }}<template v-if="d.firmware"> · {{ d.firmware }}</template> · {{ t('esp.stats', { l: d.stats.lines, i: d.stats.invalid, x: d.stats.dropped }) }}</p>
      <p v-for="(e, i) in d.events.slice(0, 3)" :key="i" class="faint">{{ e.kind }} · {{ ago(e.at) }}</p>
    </div>
    <template v-if="st?.ports.length">
      <p class="faint">{{ t('esp.ports') }}</p>
      <KvRow v-for="p in st.ports" :key="p.path" :label="p.path" :value="`${p.chip} → ${p.use}`" mono />
    </template>
    <p class="faint">{{ t('esp.note') }}</p>
  </AppCard>
</template>

<style scoped>
.dev {
  padding-bottom: 0.4rem;
  border-bottom: 1px dashed var(--border);
}

.faint {
  font-size: 0.8rem;
}
</style>
