<script setup lang="ts">
import { Contrast, Keyboard, SunDim, Type, X } from '@lucide/vue'
import type { DimLevel } from '~/composables/useDisplaySettings'

const t = useT()
const { settings, panelOpen, update } = useDisplaySettings()
const DIM_LEVELS: DimLevel[] = [0, 30, 60]
</script>

<template>
  <div class="backdrop" @click.self="panelOpen = false">
    <section class="panel" role="dialog" aria-modal="true" :aria-label="t('display.title')">
      <header class="head">
        <h2>{{ t('display.title') }}</h2>
        <button type="button" class="btn" :aria-label="t('display.close')" @click="panelOpen = false">
          <X :size="22" aria-hidden="true" />
        </button>
      </header>

      <div class="row">
        <Contrast :size="22" aria-hidden="true" />
        <span class="label">{{ t('display.contrast') }}</span>
        <button
          type="button"
          class="btn toggle"
          :aria-pressed="settings.highContrast"
          @click="update({ highContrast: !settings.highContrast })"
        >
          {{ settings.highContrast ? t('state.yes') : t('state.no') }}
        </button>
      </div>

      <div class="row">
        <Type :size="22" aria-hidden="true" />
        <span class="label">{{ t('display.largeText') }}</span>
        <button
          type="button"
          class="btn toggle"
          :aria-pressed="settings.largeText"
          @click="update({ largeText: !settings.largeText })"
        >
          {{ settings.largeText ? t('state.yes') : t('state.no') }}
        </button>
      </div>

      <div class="row">
        <Keyboard :size="22" aria-hidden="true" />
        <span class="label">{{ t('display.osk') }}</span>
        <button type="button" class="btn toggle" :aria-pressed="settings.osk" @click="update({ osk: !settings.osk })">
          {{ settings.osk ? t('state.yes') : t('state.no') }}
        </button>
      </div>

      <div class="row">
        <SunDim :size="22" aria-hidden="true" />
        <span class="label">{{ t('display.dim') }}</span>
        <div class="seg" role="group" :aria-label="t('display.dim')">
          <button
            v-for="level in DIM_LEVELS"
            :key="level"
            type="button"
            class="btn"
            :aria-pressed="settings.dim === level"
            @click="update({ dim: level })"
          >
            {{ level === 0 ? t('display.dim.off') : `${level} %` }}
          </button>
        </div>
      </div>

      <p class="note">{{ t('display.dim.note') }}</p>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 62%);
  animation: fade-in 0.14s ease-out;
}

.panel {
  width: min(34rem, calc(100vw - 2rem));
  padding: 1rem 1.1rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  animation: pop-in 0.16s ease-out;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head h2 {
  font-size: 1.2rem;
}

.row svg {
  color: var(--accent);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.5rem;
  border-top: 1px solid var(--hairline);
  padding-top: 0.5rem;
}

.label {
  flex: 1;
  font-weight: 700;
}

.toggle {
  min-width: 5.5rem;
}

.btn[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--accent);
}

.seg {
  display: flex;
  gap: 0.4rem;
}

.note {
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
