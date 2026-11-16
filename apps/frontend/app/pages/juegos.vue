<script setup lang="ts">
import { Gamepad2, RefreshCw, Wrench } from '@lucide/vue'
import type { GamesStatus } from '@survival-os/shared-types'

/**
 * Juegos offline (ADR 0012): la copia local de Viseni Games en un iframe. Se sirve desde OTRO origen
 * (127.0.0.1:8790), así que los juegos no pueden tocar Survivelia OS. Sin pantalla completa ni ventanas
 * nuevas ni navegación de la página superior: Atrás/Inicio siguen siempre a mano.
 */
const t = useT()
const status = ref<GamesStatus | null>(null)
const loading = ref(true)
async function load(): Promise<void> {
  loading.value = true
  status.value = await $fetch<GamesStatus>('/api/games/status', { timeout: 6000, retry: 0 }).catch(() => null)
  loading.value = false
}
onMounted(load)
</script>

<template>
  <div class="games">
    <iframe
      v-if="status?.available"
      class="frame"
      :src="status.url"
      :title="t('games.title')"
      allow="autoplay; gamepad"
      sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-modals"
      referrerpolicy="no-referrer"
    />
    <div v-else-if="!loading" class="empty">
      <AppCard :title="t('games.title')" :icon="Gamepad2" tone="muted">
        <p>{{ status && !status.installed ? t('games.notInstalled') : t('games.unavailable') }}</p>
        <p v-if="status?.installed && status.reason" class="faint">{{ translateServer(status.reason) }}</p>
        <div class="row">
          <NuxtLink to="/sistema/mantenimiento" class="btn btn-primary"><Wrench :size="18" aria-hidden="true" />{{ t('games.goDownload') }}</NuxtLink>
          <button type="button" class="btn" @click="load"><RefreshCw :size="18" aria-hidden="true" />{{ t('games.retry') }}</button>
        </div>
      </AppCard>
    </div>
  </div>
</template>

<style scoped>
.games {
  position: relative;
  height: 100%;
  background: #020203;
}

.frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.empty {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 1rem;
}

.empty > * {
  max-width: 34rem;
}

.row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
</style>
