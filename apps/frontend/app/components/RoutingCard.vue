<script setup lang="ts">
import { Download, Route, Trash2 } from '@lucide/vue'
import type { RoutingStatus } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * Rutas sin conexión (ADR 0010) en Mantenimiento: instala BRouter (Java incluido) y las cuadrículas de
 * datos de una región. Necesita red solo durante la descarga; después todo funciona sin Internet.
 */
const props = defineProps<{ online: boolean }>()
const t = useT()
const status = ref<RoutingStatus | null>(null)
async function load(): Promise<void> {
  status.value = await $fetch<RoutingStatus>('/api/routing/status', { timeout: 5000, retry: 0 }).catch(() => null)
}
const job = useAdminJob('routing', () => setTimeout(() => void load(), 4000))
onMounted(load)

/** Cuadrículas de cada región (mismas que scripts/routing-install.sh) y tamaño aproximado publicado. */
const REGIONS = [
  { id: 'espana', tiles: ['W10_N35', 'W10_N40', 'W5_N35', 'W5_N40', 'E0_N35', 'E0_N40'], size: '≈ 420 MB' },
  { id: 'canarias', tiles: ['W20_N25', 'W15_N25'], size: '≈ 10 MB' },
] as const
const has = (tiles: readonly string[]): boolean => !!status.value && tiles.every((n) => status.value!.segments.some((s) => s.name === n))
const totalBytes = computed(() => (status.value?.segments ?? []).reduce((a, s) => a + s.bytes, 0))
const pending = ref<{ id: string; size: string } | null>(null)
const confirmRemove = ref(false)
</script>

<template>
  <AppCard
    :title="t('ui.routing.title')" :icon="Route" :tone="status?.available ? 'ok' : 'muted'"
    :pill="status?.available ? t('ui.routing.on') : status?.segments.length ? t('ui.routing.down') : t('ui.routing.off')"
  >
    <p>{{ t('ui.routing.note') }}</p>
    <div v-for="r in REGIONS" :key="r.id" class="opt">
      <span class="grow">
        <strong>{{ t(`ui.routing.region.${r.id}`) }}</strong>
        <small>{{ has(r.tiles) ? t('ui.routing.installed') : r.size }}</small>
      </span>
      <button
        type="button" class="btn" :class="{ 'btn-primary': !has(r.tiles) }" :disabled="job.running.value || !props.online"
        @click="pending = { id: r.id, size: r.size }"
      >
        <Download :size="18" aria-hidden="true" />{{ has(r.tiles) ? t('ui.routing.update') : t('mnt.content.download') }}
      </button>
    </div>
    <p v-if="!props.online" class="warn small">{{ t('mnt.content.offline') }}</p>
    <p v-if="status?.segments.length" class="faint small">
      {{ t('ui.routing.summary', { n: status.segments.length, size: formatBytes(totalBytes), date: status.downloadedAt?.slice(0, 10) ?? '—' }) }}
    </p>
    <button v-if="status?.segments.length" type="button" class="btn" :disabled="job.running.value" @click="confirmRemove = true">
      <Trash2 :size="18" aria-hidden="true" />{{ t('ui.routing.remove') }}
    </button>
    <JobLog :status="job.status.value" :error="job.error.value" :lines="4" />

    <ConfirmDialog
      v-if="pending"
      :title="t('ui.routing.confirmTitle')"
      :message="t('ui.routing.confirmBody', { size: pending.size })"
      :confirm-label="t('mnt.content.download')"
      @confirm="job.start({ action: 'install', regions: [pending.id] }); pending = null"
      @cancel="pending = null"
    />
    <ConfirmDialog
      v-if="confirmRemove"
      :title="t('ui.routing.removeTitle')"
      :message="t('ui.routing.removeBody')"
      :confirm-label="t('ui.routing.remove')"
      danger
      @confirm="job.start({ action: 'remove' }); confirmRemove = false"
      @cancel="confirmRemove = false"
    />
  </AppCard>
</template>

<style scoped>
.opt {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-3) 35%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.grow small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.small {
  font-size: 0.82rem;
}

.warn {
  color: var(--warn) !important;
}
</style>
