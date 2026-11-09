<script setup lang="ts">
import type { Component } from 'vue'
import type { Tone } from '~/utils/alerts'

/**
 * Medidor radial de 270°. Sin medida (`ratio` null) solo se dibuja la pista:
 * nunca un arco estimado. `marks` = umbrales (0–1) dibujados como muescas.
 */
const props = defineProps<{
  label: string
  icon: Component
  ratio: number | null
  value: string | null
  unit?: string
  sub?: string | null
  tone?: Tone
  marks?: number[]
}>()

const R = 40
const START_DEG = 135
const SWEEP_DEG = 270

function polar(frac: number, r: number): { x: number; y: number } {
  const a = ((START_DEG + SWEEP_DEG * frac) * Math.PI) / 180
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) }
}

const s0 = polar(0, R)
const s1 = polar(1, R)
const ARC = `M ${s0.x.toFixed(2)} ${s0.y.toFixed(2)} A ${R} ${R} 0 1 1 ${s1.x.toFixed(2)} ${s1.y.toFixed(2)}`

const frac = computed(() => (props.ratio == null ? null : Math.min(1, Math.max(0, props.ratio))))
const knob = computed(() => (frac.value == null ? null : polar(frac.value, R)))
const ticks = computed(() => (props.marks ?? []).map((m) => ({ a: polar(m, R + 6), b: polar(m, R + 10) })))
</script>

<template>
  <div class="gauge" :class="`tone-${frac == null ? 'muted' : (tone ?? 'ok')}`">
    <div class="dial">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path :d="ARC" class="track" pathLength="100" />
        <path
          v-if="frac != null"
          :d="ARC"
          class="fill"
          pathLength="100"
          :stroke-dasharray="`${(frac * 100).toFixed(2)} 100`"
        />
        <line v-for="(k, i) in ticks" :key="i" :x1="k.a.x" :y1="k.a.y" :x2="k.b.x" :y2="k.b.y" class="tick" />
        <circle v-if="knob" :cx="knob.x" :cy="knob.y" r="4.6" class="knob" />
      </svg>
      <div class="center">
        <component :is="icon" :size="18" class="icon" aria-hidden="true" />
        <span class="value mono">{{ value ?? '—' }}</span>
        <span v-if="unit && value != null" class="unit">{{ unit }}</span>
      </div>
    </div>
    <span class="label">{{ label }}</span>
    <span class="sub">{{ sub ?? '' }}</span>
  </div>
</template>

<style scoped>
.gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  min-width: 0;
  padding: 0.6rem 0.6rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background:
    radial-gradient(circle at 50% 36%, color-mix(in srgb, var(--tone) 13%, transparent), transparent 62%),
    linear-gradient(180deg, var(--surface-2), var(--surface));
}

.dial {
  position: relative;
  width: 8rem;
  aspect-ratio: 1;
}

.dial > svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.track,
.fill {
  fill: none;
  stroke-width: 7;
  stroke-linecap: round;
}

.track {
  stroke: var(--surface-3);
}

.fill {
  stroke: var(--tone);
  transition: stroke-dasharray 0.5s ease-out;
}

.tick {
  stroke: var(--text-faint);
  stroke-width: 1.6;
  stroke-linecap: round;
}

.knob {
  fill: var(--bg);
  stroke: var(--tone);
  stroke-width: 2.6;
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.icon {
  color: var(--tone);
  margin-bottom: 0.3rem;
}

.value {
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
}

.unit {
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.label {
  margin-top: -0.6rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
}

.sub {
  min-height: 1.1em;
  max-width: 100%;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
