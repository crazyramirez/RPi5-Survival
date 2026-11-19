<script setup lang="ts">
const { locked } = useScreenLock()
const { panelOpen } = useDisplaySettings()
const portable = usePortable()
const android = useAndroid()
const route = useRoute()

// Modo lectura (visores): sin barras de la app; .reading-hide oculta además las de la página (main.css).
const reading = useReadingMode()
watch(reading.on, (on) => (document.documentElement.dataset.reading = on ? 'on' : 'off'))
// Al cambiar de pantalla se sale (el modo es de cada visor, no de la app).
watch(() => route.path, () => reading.on.value && void reading.exit())
// Escape o el gesto del sistema sacaron de la pantalla completa que pidió el modo: se sale también de él.
function onFullscreen(): void {
  if (!document.fullscreenElement && reading.ownFullscreen.value) {
    reading.ownFullscreen.value = false
    void reading.exit()
  }
}
onMounted(() => document.addEventListener('fullscreenchange', onFullscreen))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreen))
</script>

<template>
  <div class="shell" :class="{ 'shell-guide': route.meta.guideCatalog === true, reading: reading.on.value }">
    <StatusBar v-show="!reading.on.value" />
    <main class="content">
      <slot />
    </main>
    <ActionBar v-show="!reading.on.value" />
    <ReadingExit v-if="reading.on.value" />
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

/* Modo lectura: solo el contenido (las barras están ocultas y no ocupan fila). */
.shell.reading {
  grid-template-rows: minmax(0, 1fr);
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
