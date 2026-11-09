<script setup lang="ts">
import { ArrowLeft, House, Lock, SunDim } from '@lucide/vue'

const t = useT()
const route = useRoute()
const router = useRouter()
const { lock } = useScreenLock()
const { panelOpen } = useDisplaySettings()

const atHome = computed(() => route.path === '/')
/** En la vista pública el bloqueo de pantalla no tiene sentido (es el móvil de otra persona). */
const publicView = isPublicView()

function back(): void {
  // En kiosco no hay historial fiable al arrancar: si no hay a dónde volver, ir a Inicio.
  if (window.history.state?.back) router.back()
  else void router.push('/')
}
</script>

<template>
  <nav class="actions" aria-label="Navegación principal">
    <button type="button" class="action" :disabled="atHome" @click="back">
      <ArrowLeft :size="26" aria-hidden="true" />
      <span>{{ t('nav.back') }}</span>
    </button>
    <NuxtLink to="/" class="action" :class="{ current: atHome }">
      <House :size="26" aria-hidden="true" />
      <span>{{ t('nav.home') }}</span>
    </NuxtLink>
    <button type="button" class="action" @click="panelOpen = true">
      <SunDim :size="26" aria-hidden="true" />
      <span>{{ t('nav.display') }}</span>
    </button>
    <button v-if="!publicView" type="button" class="action" @click="lock">
      <Lock :size="26" aria-hidden="true" />
      <span>{{ t('nav.lock') }}</span>
    </button>
  </nav>
</template>

<style scoped>
.actions {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 0.5rem;
  height: var(--action-h);
  padding: 0.45rem 0.75rem;
  background: linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--surface) 60%, var(--bg)));
  border-top: 1px solid var(--border);
}

.action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: var(--touch);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.action svg {
  color: var(--text-muted);
}

.action:active:not(:disabled) {
  background: var(--surface-3);
  transform: scale(0.97);
}

.action:disabled {
  opacity: 0.4;
  cursor: default;
}

.action.current {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 16%, var(--surface-3)), color-mix(in srgb, var(--accent) 8%, var(--surface-2)));
  color: var(--accent);
}

.action.current svg {
  color: var(--accent);
}
</style>
