<script setup lang="ts">
import type { AdminJobStatus } from '@survival-os/shared-types'
import type { Tone } from '~/utils/alerts'

/** Estado y últimas líneas del registro de una tarea de mantenimiento. */
const props = defineProps<{ status: AdminJobStatus | null; error?: string | null; lines?: number }>()
const t = useT()

const view = computed<{ tone: Tone; label: string } | null>(() => {
  const s = props.status
  if (!s || (s.state === 'inactive' && !s.log.length)) return null
  if (s.state === 'active' || s.state === 'activating') return { tone: 'info', label: t('job.running') }
  if (s.state === 'failed' || (s.result && s.result !== 'success')) return { tone: 'danger', label: t('job.failed') }
  return { tone: 'ok', label: t('job.done') }
})
const tail = computed(() => (props.status?.log ?? []).slice(-(props.lines ?? 6)))
</script>

<template>
  <div v-if="view || error" class="job">
    <StatePill v-if="view" :tone="view.tone" :label="view.label" />
    <p v-if="error" class="err">{{ error }}</p>
    <pre v-if="tail.length" class="log mono">{{ tail.join('\n') }}</pre>
  </div>
</template>

<style scoped>
.job {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.err {
  color: var(--danger) !important;
  font-weight: 700;
}

.log {
  margin: 0;
  max-height: 9rem;
  overflow: auto;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hairline);
  border-left: 2px solid var(--accent);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
