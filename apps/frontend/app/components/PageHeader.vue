<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import type { Component } from 'vue'

import { CURRENT_PHASE } from '~/utils/modules'

/** `back`: volver a la pantalla madre, siempre a la izquierda del título (mismo sitio en toda la app). */
defineProps<{ title: string; icon?: Component; phase?: number; back?: { to: string; label: string } }>()
const t = useT()
</script>

<template>
  <header class="page-head">
    <NuxtLink v-if="back" :to="back.to" class="btn back-link"><ArrowLeft :size="20" aria-hidden="true" />{{ back.label }}</NuxtLink>
    <component :is="icon" v-if="icon" :size="26" class="icon" aria-hidden="true" />
    <h1>{{ title }}</h1>
    <StatePill v-if="phase && phase > CURRENT_PHASE" tone="muted" :label="t('common.phase.pending', { n: phase })" />
    <!-- Acciones de la pantalla en la misma fila (ahorra altura en 1024×600). -->
    <slot />
  </header>
</template>

<style scoped>
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.7rem;
}

.page-head h1 {
  flex: none;
  font-size: 1.35rem;
  font-weight: 700;
}

.icon {
  color: var(--accent);
}

/* Volver: siempre a la izquierda, mismo aspecto en toda la app. */
.back-link {
  min-height: 2.75rem; /* ≥ 44 px táctil */
  text-decoration: none;
  color: var(--text);
}
</style>
