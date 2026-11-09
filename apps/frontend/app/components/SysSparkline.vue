<script setup lang="ts">
import type { Tone } from '~/utils/alerts'

/**
 * Minigráfica de tendencia. Los huecos (null = sin medida) cortan la línea: nunca se interpola.
 * SVG estático, sin animación; se redibuja solo cuando llega una muestra nueva (cada 10 s).
 */
const props = defineProps<{
  label: string
  values: (number | null)[]
  min: number
  max: number
  value: string | null
  unit?: string
  tone?: Tone
  /** Umbral (en unidades del dato) dibujado como línea discontinua. */
  mark?: number
  span: string
}>()

const W = 100
const H = 32
const y = (v: number): number => H - ((Math.min(props.max, Math.max(props.min, v)) - props.min) / (props.max - props.min || 1)) * H
const x = (i: number): number => (props.values.length <= 1 ? W : (i / (props.values.length - 1)) * W)

/** Tramos continuos de muestras medidas. */
const segments = computed(() => {
  const out: { line: string; area: string }[] = []
  let pts: [number, number][] = []
  const flush = (): void => {
    if (pts.length >= 2) {
      const line = pts.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' ')
      out.push({ line, area: `${pts[0]![0].toFixed(2)},${H} ${line} ${pts[pts.length - 1]![0].toFixed(2)},${H}` })
    }
    pts = []
  }
  props.values.forEach((v, i) => (v == null ? flush() : pts.push([x(i), y(v)])))
  flush()
  return out
})
const markY = computed(() => (props.mark == null ? null : y(props.mark)))
const enough = computed(() => props.values.filter((v) => v != null).length >= 2)
</script>

<template>
  <div class="spark" :class="`tone-${value == null ? 'muted' : (tone ?? 'ok')}`">
    <div class="top">
      <span class="label">{{ label }}</span>
      <span class="val mono">{{ value ?? '—' }}<small v-if="unit && value != null">{{ unit }}</small></span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
      <line v-if="markY != null" x1="0" :y1="markY" :x2="W" :y2="markY" class="mark" />
      <template v-for="(s, i) in segments" :key="i">
        <polygon :points="s.area" class="area" />
        <polyline :points="s.line" class="line" />
      </template>
    </svg>
    <span class="span">{{ enough ? span : '…' }}</span>
  </div>
</template>

<style scoped>
.spark {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.6rem 0.75rem 0.5rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}

.label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-muted);
}

.val {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--tone);
}

.val small {
  margin-left: 0.15rem;
  font-size: 0.75rem;
  color: var(--text-faint);
}

svg {
  width: 100%;
  height: 2.6rem;
  overflow: visible;
}

.line {
  fill: none;
  stroke: var(--tone);
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.area {
  fill: color-mix(in srgb, var(--tone) 16%, transparent);
}

.mark {
  stroke: var(--text-faint);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}

.span {
  font-size: 0.7rem;
  color: var(--text-faint);
  text-align: right;
}
</style>
