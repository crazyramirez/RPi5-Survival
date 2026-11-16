<script setup lang="ts">
import { Download } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'

/**
 * Tira de progreso en el inicio mientras se preparan los contenidos (ADR 0015). Datos reales del
 * motor: cuántos elementos de la selección están instalados y qué se descarga ahora.
 */
const t = useT()
const ov = ref<ContentOverview | null>(null)
const job = useAdminJob('content')

async function load(): Promise<void> {
  ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => ov.value)
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), 5000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

const active = computed(() => ov.value?.items.find((i) => i.state === 'downloading' || i.state === 'verifying') ?? null)
const view = computed(() => {
  if (!job.running.value || !ov.value) return null
  const tracked = ov.value.items.filter((i) => i.state !== 'missing')
  const done = tracked.filter((i) => i.state === 'installed').length
  const a = active.value
  const name = a ? (ov.value.catalog.find((c) => c.id === a.id)?.title ?? a.id) : null
  const pct = a?.total && a.done != null ? `${Math.min(100, Math.floor((a.done / a.total) * 100))} %` : ''
  return { done, total: tracked.length, name, pct }
})
</script>

<template>
  <NuxtLink v-if="view" to="/sistema/mantenimiento" class="progress tone-info" role="status">
    <Download :size="18" aria-hidden="true" />
    <span class="grow">
      <strong>{{ t('content.progress', { done: view.done, total: view.total }) }}</strong>
      <small v-if="view.name">{{ t('content.progressNow', { name: view.name, pct: view.pct }) }}</small>
    </span>
    <span class="link">{{ t('content.progressLink') }}</span>
  </NuxtLink>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.9rem;
  margin-bottom: var(--gap);
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--info) 45%, var(--border));
  background: color-mix(in srgb, var(--info) 10%, var(--surface));
  color: var(--text);
  text-decoration: none;
}

.progress svg {
  color: var(--info);
}

.grow {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.grow small {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link {
  font-weight: 700;
  color: var(--info);
}
</style>
