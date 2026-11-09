<script setup lang="ts">
import type { Component } from 'vue'
import type { Tone } from '~/utils/alerts'

/** Tarjeta base: filo e icono con el tono de estado. Mismo lenguaje visual en todas las pantallas. */
defineProps<{
  title: string
  icon?: Component
  tone?: Tone
  pill?: string
}>()
</script>

<template>
  <section class="card" :class="`tone-${tone ?? 'muted'}`">
    <header class="head">
      <span v-if="icon" class="icon"><component :is="icon" :size="18" aria-hidden="true" /></span>
      <h2>{{ title }}</h2>
      <StatePill v-if="pill" :tone="tone ?? 'muted'" :label="pill" />
    </header>
    <div class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.75rem 0.9rem 0.85rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  overflow: hidden;
}

/* Filo superior con el tono de la tarjeta. */
.card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, var(--tone), transparent 80%);
  opacity: 0.85;
}

.head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.head h2 {
  flex: 1;
  min-width: 0;
  font-size: 1rem;
  font-weight: 700;
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

/* Sin tono propio el icono usa el acento de la marca. */
.tone-muted .icon {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--text);
}

.body :deep(p) {
  color: var(--text-muted);
  font-size: 0.9rem;
}
</style>
