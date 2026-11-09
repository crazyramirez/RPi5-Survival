<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import type { Component } from 'vue'
import type { Tone } from '~/utils/alerts'

defineProps<{ to: string; title: string; icon: Component; summary: string | null; tone: Tone }>()
const t = useT()
</script>

<template>
  <NuxtLink :to="to" class="tile" :class="`tone-${tone}`">
    <span class="top">
      <span class="badge"><component :is="icon" :size="30" aria-hidden="true" /></span>
      <ChevronRight :size="20" class="chev" aria-hidden="true" />
    </span>
    <span class="title">{{ title }}</span>
    <span class="summary">
      <span class="dot" aria-hidden="true" />
      <span class="text">{{ summary ?? t('state.loading') }}</span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.35rem;
  min-height: 0;
  padding: 0.8rem 0.85rem 0.75rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  /* Halo del tono en la esquina inferior: indica el estado sin leer. */
  background:
    radial-gradient(85% 70% at 100% 100%, color-mix(in srgb, var(--tone) 11%, transparent), transparent 70%),
    var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  overflow: hidden;
  transition: transform 0.08s ease-out;
}

.tile:active {
  transform: scale(0.98);
  border-color: var(--accent);
}

.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.badge {
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 0.8rem;
  color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 6%, transparent));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.chev {
  color: var(--text-faint);
}

.title {
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.summary {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.25;
}

.text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dot {
  flex: none;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 20%, transparent);
  transform: translateY(-0.05rem);
}
</style>
