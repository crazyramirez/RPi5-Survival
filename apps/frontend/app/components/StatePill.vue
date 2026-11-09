<script setup lang="ts">
import type { Tone } from '~/utils/alerts'

defineProps<{ tone: Tone; label: string }>()
</script>

<template>
  <span class="pill" :class="`tone-${tone}`"><span class="dot" aria-hidden="true" />{{ label }}</span>
</template>

<style scoped>
.pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0.6rem 0.12rem 0.5rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--tone) 50%, transparent);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--tone) 22%, transparent);
}
</style>
