<script setup lang="ts">
const { locked } = useScreenLock()
const { panelOpen } = useDisplaySettings()
const portable = usePortable()
const android = useAndroid()
const route = useRoute()
</script>

<template>
  <div class="shell" :class="{ 'shell-guide': route.meta.guideCatalog === true }">
    <StatusBar />
    <main class="content">
      <slot />
    </main>
    <ActionBar />
    <DisplayPanel v-if="panelOpen" />
    <!-- Portable desde una memoria USB (ADR 0019): «¿abrir al conectar?» la primera vez en cada equipo. -->
    <UsbAutoOpenPrompt v-if="portable && !android" />
    <!-- «Survivelia OS actualizado a la versión X» (una vez por versión) o aviso si la actualización falló. -->
    <UpdateNotice />
    <!-- Versión nueva disponible: tarjeta en superposición que invita a instalarla. -->
    <UpdatePrompt />
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

/* Catálogos (emergencias, lector, visor): solo un borde algo más visible; barras y paleta iguales que el resto. */
.shell-guide {
  --guide-border: color-mix(in srgb, var(--text) 25%, var(--border));
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
