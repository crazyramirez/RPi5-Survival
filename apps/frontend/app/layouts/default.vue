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

/* La composición de catálogo conserva las proporciones de la propuesta sin cambiar las otras pantallas. */
.shell-guide {
  background: var(--bg);
  --bar-h: 44px;
  --action-h: 96px;
  --guide-border: color-mix(in srgb, var(--text) 25%, var(--border));
  --actions-padding: 5px 14px 17px;
  --actions-gap: 12px;
  --actions-font-size: 1.25rem;
  --actions-icon-size: 30px;
  --status-font-size: 0.95rem;
  --status-clock-size: 1.25rem;
  --status-version-display: none;
  --status-detail-display: none;
}
@media (max-width: 1150px), (max-height: 700px) {
  .shell-guide {
    --action-h: 68px;
    --actions-padding: 7px 10px;
    --actions-gap: 8px;
    --actions-font-size: 1.05rem;
    --actions-icon-size: 26px;
    --status-font-size: 0.875rem;
    --status-clock-size: 1.15rem;
  }
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
