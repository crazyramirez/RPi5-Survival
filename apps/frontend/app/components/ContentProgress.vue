<script setup lang="ts">
import { CloudDownload, Download } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'

/**
 * Tira de progreso en el inicio mientras se preparan los contenidos (ADR 0015). Datos reales del
 * motor: cuántos elementos de la selección están instalados y qué se descarga ahora.
 * Equipo todavía vacío (nada instalado ni descargándose): aviso con acceso directo a «Descargarlo todo».
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
const empty = computed(() => !!ov.value && !job.running.value && !active.value && !ov.value.items.some((i) => i.state === 'installed'))
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
  <NuxtLink v-else-if="empty" to="/sistema/mantenimiento#mnt-content" class="progress empty">
    <CloudDownload :size="22" aria-hidden="true" />
    <span class="grow">
      <strong>{{ t('content.empty.title') }}</strong>
      <small>{{ t('content.empty.body') }}</small>
    </span>
    <span class="cta">{{ t('all.title') }}</span>
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

/* Equipo vacío: el mismo naranja que «Mantenimiento» para que se vea a la primera. */
.empty {
  border-color: color-mix(in srgb, var(--maint) 55%, var(--border));
  background: color-mix(in srgb, var(--maint) 10%, var(--surface));
}

.empty svg {
  color: var(--maint);
}

.cta {
  flex: none;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius);
  background: var(--maint);
  color: var(--maint-ink);
  font-weight: 700;
}

@media (max-width: 520px) {
  .empty {
    flex-wrap: wrap;
  }

  .empty .grow {
    flex-basis: calc(100% - 2.5rem);
  }

  .empty .grow small {
    white-space: normal;
  }

  .empty .cta {
    flex: 1 1 100%;
    text-align: center;
  }
}
</style>
