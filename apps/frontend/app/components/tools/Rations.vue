<script setup lang="ts">
/** Agua y comida para un grupo y unos días, con las normas mínimas del Manual Esfera (2018). */
import { Droplets, Minus, Plus } from '@lucide/vue'
import { rations, SPHERE } from '~/utils/fieldtools'

const t = useT()
const people = ref(2)
const days = ref(3)
const plan = computed(() => rations(people.value, days.value))
const n = (v: number): string => v.toLocaleString(bcp47(), { maximumFractionDigits: 0 })

function step(which: 'people' | 'days', d: number): void {
  const r = which === 'people' ? people : days
  r.value = Math.min(which === 'people' ? 100 : 365, Math.max(1, r.value + d))
}
</script>

<template>
  <AppCard :title="t('field.rations.title')" :icon="Droplets" tone="info">
    <div class="steppers">
      <div v-for="w in (['people', 'days'] as const)" :key="w" class="stepper">
        <span class="lbl">{{ t(`field.rations.${w}`) }}</span>
        <button type="button" class="btn icon-btn" :aria-label="t('field.rations.less')" @click="step(w, -1)"><Minus :size="18" /></button>
        <output class="val mono">{{ w === 'people' ? people : days }}</output>
        <button type="button" class="btn icon-btn" :aria-label="t('field.rations.more')" @click="step(w, 1)"><Plus :size="18" /></button>
      </div>
    </div>
    <dl v-if="plan" class="res">
      <div class="strong">
        <dt>{{ t('field.rations.drink') }}</dt>
        <dd class="mono">{{ n(plan.drinkL) }} L</dd>
      </div>
      <div>
        <dt>{{ t('field.rations.basic') }}</dt>
        <dd class="mono">{{ n(plan.basicL) }} L</dd>
      </div>
      <div>
        <dt>{{ t('field.rations.food') }}</dt>
        <dd class="mono">{{ n(plan.kcal) }} kcal</dd>
      </div>
    </dl>
    <p class="note">{{ t('field.rations.source', { d: SPHERE.drinkLPerDay, b: SPHERE.basicLPerDay, k: n(SPHERE.kcalPerDay) }) }}</p>
  </AppCard>
</template>

<style scoped>
.steppers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.stepper {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 0.2rem 0.35rem;
}

.lbl {
  grid-column: 1 / -1;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
}

.val {
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
}

.res {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 0;
}

.res div {
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.res dt {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-faint);
}

.res dd {
  margin: 0;
  font-size: 1.1rem;
}

.res .strong dd {
  color: var(--tone);
  font-weight: 700;
}

.note {
  font-size: 0.78rem;
  color: var(--text-faint);
}
</style>
