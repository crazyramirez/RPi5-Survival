<script setup lang="ts">
const { locked } = useScreenLock()
const { panelOpen } = useDisplaySettings()
</script>

<template>
  <div class="shell">
    <StatusBar />
    <main class="content">
      <slot />
    </main>
    <ActionBar />
    <DisplayPanel v-if="panelOpen" />
    <LockOverlay v-if="locked" />
    <OnScreenKeyboard />
    <!-- Atenuación visual: no afecta a la retroiluminación ni al consumo. -->
    <div class="dim" aria-hidden="true" />
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  /* Mínimo 0: ningún contenido ancho (título largo, tabla) puede ensanchar toda la app en un móvil. */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--bar-h) minmax(0, 1fr) var(--action-h);
  height: 100vh;
  height: 100dvh;
}

.content {
  min-height: 0;
  overflow: hidden;
}

.dim {
  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  background: #000;
  opacity: var(--dim);
}
</style>
