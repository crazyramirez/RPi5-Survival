<script setup lang="ts">
import { Maximize2 } from '@lucide/vue'

/** Botón «Pantalla completa» de la barra de un visor: entra en el modo lectura (useReadingMode). */
const t = useT()
const { enter } = useReadingMode()
</script>

<template>
  <button type="button" class="btn reading-btn" :aria-label="t('reading.enter')" :title="t('reading.enter')" @click="enter">
    <Maximize2 :size="20" aria-hidden="true" />
    <span class="lbl">{{ t('reading.enter') }}</span>
  </button>
</template>

<style scoped>
.reading-btn {
  flex: none;
}

/* Barras estrechas (móvil, títulos largos): solo el icono. */
@media (max-width: 760px) {
  .lbl {
    display: none;
  }

  .reading-btn {
    padding: 0;
  }
}
</style>
