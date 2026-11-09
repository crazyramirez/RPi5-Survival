<script setup lang="ts">
import { CircleHelp, TriangleAlert } from '@lucide/vue'

/** Confirmación táctil (sin diálogos nativos del navegador, que bloquean el kiosco). */
defineProps<{ title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const t = useT()
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <section class="dialog" :class="danger ? 'tone-danger' : 'tone-info'" role="alertdialog" aria-modal="true" :aria-label="title">
      <span class="orb" aria-hidden="true">
        <component :is="danger ? TriangleAlert : CircleHelp" :size="26" />
      </span>
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <div class="actions">
        <button type="button" class="btn" :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="button" class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" :disabled="busy" @click="emit('confirm')">
          {{ busy ? t('state.loading') : confirmLabel }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 68%);
  animation: fade-in 0.14s ease-out;
}

.dialog {
  width: min(31rem, calc(100vw - 2rem));
  padding: 1.3rem 1.3rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
  background:
    radial-gradient(90% 60% at 50% 0%, color-mix(in srgb, var(--tone) 12%, transparent), transparent 70%),
    var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  text-align: center;
  animation: pop-in 0.16s ease-out;
}

.orb {
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 15%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 65%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--tone) 8%, transparent);
}

h2 {
  font-size: 1.25rem;
  letter-spacing: -0.01em;
}

p {
  color: var(--text-muted);
  line-height: 1.45;
}

.actions {
  align-self: stretch;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.actions .btn {
  min-height: 3.5rem;
}
</style>
