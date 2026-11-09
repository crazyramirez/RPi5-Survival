<script setup lang="ts">
import type { Tone } from '~/utils/alerts'

defineProps<{ label: string; value?: string | number | null; tone?: Tone; mono?: boolean }>()
</script>

<template>
  <div class="kv">
    <span class="k">{{ label }}</span>
    <span class="v" :class="[{ mono }, tone ? `tone-${tone} toned` : '']">
      <slot>{{ value ?? '—' }}</slot>
    </span>
  </div>
</template>

<style scoped>
.kv {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.28rem 0;
  border-bottom: 1px solid var(--hairline);
  font-size: 0.925rem;
}

.kv:last-child {
  border-bottom: none;
}

.k {
  color: var(--text-muted);
  flex: none;
}

.v {
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.toned {
  color: var(--tone);
  font-weight: 700;
}
</style>
