<script setup lang="ts">
import { Info, TriangleAlert } from '@lucide/vue'
import type { Probe } from '@survival-os/shared-types'

/** Muestra el motivo real por el que un dato no está disponible (nunca un valor inventado). */
const props = defineProps<{ probe: Probe<unknown> | undefined | null }>()
const t = useT()

const view = computed(() => {
  const p = props.probe
  if (!p) return { tone: 'muted', text: t('state.loading'), error: false }
  if (p.state === 'ok') return null
  return { tone: p.state === 'error' ? 'danger' : 'muted', text: p.reason, error: p.state === 'error' }
})
</script>

<template>
  <p v-if="view" class="note" :class="`tone-${view.tone}`">
    <component :is="view.error ? TriangleAlert : Info" :size="16" aria-hidden="true" />
    <span>{{ view.text }}</span>
  </p>
</template>

<style scoped>
.note {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.note svg {
  flex: none;
  margin-top: 0.15rem;
  color: var(--tone);
}
</style>
