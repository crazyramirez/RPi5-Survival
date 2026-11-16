<script setup lang="ts">
/**
 * Pantalla completa sin barra de estado ni barra de acciones: solo para la bienvenida (primera puesta en marcha),
 * que guía por sí misma. Conserva el teclado en pantalla, el bloqueo y la atenuación.
 */
const { locked } = useScreenLock()
</script>

<template>
  <div class="bare">
    <slot />
    <LockOverlay v-if="locked" />
    <OnScreenKeyboard />
    <div class="dim" aria-hidden="true" />
  </div>
</template>

<style scoped>
.bare {
  position: relative;
  height: 100vh;
  height: 100dvh;
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
