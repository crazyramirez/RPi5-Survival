<script setup lang="ts">
import { ArrowDownUp, Scale } from '@lucide/vue'
import { convert, unitsOf, type UnitCategory } from '~/utils/fieldtools'

const t = useT()
const CATS: UnitCategory[] = ['length', 'mass', 'volume', 'temperature', 'speed', 'pressure']
/** Pareja inicial de cada categoría: la conversión más pedida. */
const DEFAULTS: Record<UnitCategory, [string, string]> = {
  length: ['km', 'mi'],
  mass: ['kg', 'lb'],
  volume: ['L', 'gal (US)'],
  temperature: ['°C', '°F'],
  speed: ['km/h', 'kn'],
  pressure: ['hPa', 'mmHg'],
}

const cat = ref<UnitCategory>('length')
const from = ref('km')
const to = ref('mi')
const text = ref('1')

function pick(c: UnitCategory): void {
  cat.value = c
  ;[from.value, to.value] = DEFAULTS[c]
}
function swap(): void {
  ;[from.value, to.value] = [to.value, from.value]
}

const value = computed(() => Number.parseFloat(text.value.replace(',', '.')))
const result = computed(() => (text.value.trim() ? convert(value.value, cat.value, from.value, to.value) : null))
const shown = computed(() =>
  result.value === null ? '—' : result.value.toLocaleString(bcp47(), { maximumSignificantDigits: 7 }),
)
</script>

<template>
  <AppCard :title="t('field.units.title')" :icon="Scale" tone="info">
    <div class="cats" role="group" :aria-label="t('field.units.title')">
      <button v-for="c in CATS" :key="c" type="button" class="cat" :aria-pressed="cat === c" @click="pick(c)">{{ t(`field.units.${c}`) }}</button>
    </div>
    <div class="row">
      <input v-model="text" class="ui-field mono selectable num" inputmode="decimal" :aria-label="t('field.units.value')" />
      <select v-model="from" class="ui-field unit" :aria-label="t('field.units.from')">
        <option v-for="u in unitsOf(cat)" :key="u" :value="u">{{ u }}</option>
      </select>
    </div>
    <div class="swap-row">
      <button type="button" class="btn icon-btn" :aria-label="t('field.units.swap')" @click="swap"><ArrowDownUp :size="18" /></button>
    </div>
    <div class="row">
      <output class="out mono selectable" :class="{ bad: text.trim() && result === null }">{{ shown }}</output>
      <select v-model="to" class="ui-field unit" :aria-label="t('field.units.to')">
        <option v-for="u in unitsOf(cat)" :key="u" :value="u">{{ u }}</option>
      </select>
    </div>
  </AppCard>
</template>

<style scoped>
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.cat {
  min-height: 2.4rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: var(--cursor-point);
}

.cat[aria-pressed='true'] {
  color: var(--accent-ink);
  border-color: var(--accent);
  background: var(--accent);
}

.swap-row {
  display: flex;
  justify-content: center;
  margin: -0.2rem 0;
}

.row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.num,
.out {
  flex: 1;
  min-width: 0;
  min-height: 3rem;
  font-size: 1.15rem;
}

.out {
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone) 50%, var(--border));
  background: var(--bg);
  font-weight: 700;
  font-size: 1.05rem;
  overflow-x: auto;
  white-space: nowrap;
}

.out.bad {
  color: var(--danger);
}

.unit {
  flex: none;
  width: 7rem;
  min-height: 3rem;
}
</style>
