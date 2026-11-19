<script setup lang="ts">
/**
 * Tamaño de letra del lector: A− · % · A+ (tocar el % vuelve al 100 %). En la barra del lector, o flotante en el
 * modo lectura a pantalla completa (`floating`, visible solo entonces).
 */
defineProps<{ floating?: boolean }>()
const t = useT()
const { pct, canSmaller, canLarger, smaller, larger, reset } = useReaderFont()
</script>

<template>
  <div class="font" :class="{ floating, 'reading-only': floating }" role="group" :aria-label="t('reader.font')">
    <button type="button" class="step small" :disabled="!canSmaller" :aria-label="t('reader.font.smaller')" :title="t('reader.font.smaller')" @click="smaller">
      A<sub>−</sub>
    </button>
    <button type="button" class="pct" :aria-label="t('reader.font.reset')" :title="t('reader.font.reset')" :aria-pressed="pct !== 100" @click="reset">
      {{ pct }} %
    </button>
    <button type="button" class="step big" :disabled="!canLarger" :aria-label="t('reader.font.larger')" :title="t('reader.font.larger')" @click="larger">
      A<sup>+</sup>
    </button>
  </div>
</template>

<style scoped>
.font {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
}

.font button {
  min-height: calc(var(--touch) - 8px);
  border: none;
  border-radius: calc(var(--radius) - 3px);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: var(--cursor-point);
  transition: background-color 0.12s, transform 0.08s ease-out;
}

.font button:active:not(:disabled) {
  transform: scale(0.94);
  background: var(--surface-3);
}

.font button:disabled {
  opacity: 0.35;
  cursor: var(--cursor);
}

.step {
  min-width: 2.6rem;
  font-family: Georgia, 'Times New Roman', serif !important;
  line-height: 1;
}

.step.small {
  font-size: 0.95rem;
}

.step.big {
  font-size: 1.3rem;
}

.step sub,
.step sup {
  font-family: var(--font-ui);
  font-size: 0.6em;
  color: var(--accent);
}

.pct {
  min-width: 3.6rem;
  padding: 0 0.3rem;
  font-family: var(--font-mono) !important;
  font-size: 0.82rem;
  color: var(--text-muted) !important;
}

.pct[aria-pressed='true'] {
  color: var(--accent) !important;
}

/* Modo lectura: píldora translúcida abajo a la derecha (solo visible entonces, ver .reading-only). */
.floating {
  position: fixed;
  right: max(0.8rem, env(safe-area-inset-right));
  bottom: max(0.8rem, env(safe-area-inset-bottom));
  z-index: 70;
  border-radius: 999px;
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
}

.floating button {
  border-radius: 999px;
}
</style>
