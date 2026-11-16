<script setup lang="ts">
import type { Component } from 'vue'

/**
 * Estado vacío centrado (sin datos todavía): icono grande, qué falta y qué hacer. Se adapta a cualquier
 * pantalla: en el panel de la Pi ocupa el alto disponible; en monitores grandes no se estira.
 */
defineProps<{ icon: Component; title: string; text?: string }>()
</script>

<template>
  <section class="empty-state">
    <span class="orb" aria-hidden="true"><component :is="icon" :size="40" /></span>
    <h2>{{ title }}</h2>
    <p v-if="text">{{ text }}</p>
    <div class="actions"><slot /></div>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: min(100%, 26rem);
  max-width: 40rem;
  margin: 0 auto;
  padding: clamp(1.25rem, 4vh, 3rem) 1.25rem;
  text-align: center;
  animation: fade-in 0.16s ease-out;
}

.orb {
  display: grid;
  place-items: center;
  width: clamp(4.5rem, 10vmin, 6.5rem);
  height: clamp(4.5rem, 10vmin, 6.5rem);
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 6%, transparent);
}

.orb svg {
  width: 48%;
  height: 48%;
}

h2 {
  font-size: clamp(1.25rem, 1rem + 1vw, 1.75rem);
  letter-spacing: -0.01em;
}

p {
  color: var(--text-muted);
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.actions :deep(.btn) {
  min-height: 3.2rem;
  padding: 0 1.3rem;
}
</style>
