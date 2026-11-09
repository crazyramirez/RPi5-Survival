<script setup lang="ts">
import type { NuxtError } from '#app'

/** Pantalla de recuperación: nunca dejar una pantalla negra en el kiosco. */
const props = defineProps<{ error: NuxtError }>()
const t = useT()

const forbidden = computed(() => props.error.statusCode === 403)

function home(): void {
  void clearError({ redirect: '/' })
}
</script>

<template>
  <div class="recovery">
    <h1>{{ forbidden ? t('error.forbidden.title') : t('error.generic.title') }}</h1>
    <p v-if="forbidden">{{ t('error.forbidden.body') }}</p>
    <p v-else>{{ t('error.generic.body', { code: error.statusCode ?? '?' }) }}</p>
    <button type="button" class="btn btn-primary" @click="home">{{ t('error.home') }}</button>
    <p class="faint">{{ t('error.recovery') }}</p>
  </div>
</template>

<style scoped>
.recovery {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  text-align: center;
}

h1 {
  font-size: 1.5rem;
}

p {
  max-width: 40rem;
  color: var(--text-muted);
}
</style>
