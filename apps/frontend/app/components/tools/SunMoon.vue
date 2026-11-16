<script setup lang="ts">
/**
 * Sol y Luna calculados en el equipo para la posición disponible: GNSS, el nodo LoRa o las coordenadas
 * escritas en el conversor. Es un cálculo (no una medida) y depende del reloj del equipo: se dice.
 */
import { Moon, Sunrise } from '@lucide/vue'
import { moonInfo, sunTimes } from '~/utils/astro'

const props = defineProps<{ typed: { lat: number; lon: number } | null }>()
const t = useT()
const { nav, refreshNav } = useNav()
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void refreshNav()
  timer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))

/** Posición y su origen, por fiabilidad: GNSS > LoRa > coordenadas escritas. */
const where = computed<{ lat: number; lon: number; source: 'gnss' | 'lora' | 'typed' } | null>(() => {
  const g = nav.value?.gnss
  if (g?.state === 'ok' && g.value.fix !== 'none' && g.value.latitude != null && g.value.longitude != null) return { lat: g.value.latitude, lon: g.value.longitude, source: 'gnss' }
  const f = nav.value?.fallback
  if (f?.state === 'ok') return { lat: f.value.latitude, lon: f.value.longitude, source: 'lora' }
  return props.typed ? { ...props.typed, source: 'typed' } : null
})

const sun = computed(() => (where.value ? sunTimes(now.value, where.value.lat, where.value.lon) : null))
const moon = computed(() => moonInfo(now.value))
const time = (d: Date | null): string => (d ? d.toLocaleTimeString(bcp47(), { hour: '2-digit', minute: '2-digit' }) : '—')
const day = (d: Date): string => d.toLocaleDateString(bcp47(), { day: 'numeric', month: 'short' })
const hours = (h: number): string => {
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
</script>

<template>
  <AppCard :title="t('field.sun.title')" :icon="Sunrise" :tone="sun ? 'info' : 'muted'">
    <template v-if="sun && where">
      <p v-if="sun.polar" class="polar">{{ t(sun.polar === 'day' ? 'field.sun.polarDay' : 'field.sun.polarNight') }}</p>
      <dl v-else class="grid">
        <div><dt>{{ t('field.sun.dawn') }}</dt><dd class="mono">{{ time(sun.dawn) }}</dd></div>
        <div class="strong"><dt>{{ t('field.sun.sunrise') }}</dt><dd class="mono">{{ time(sun.sunrise) }}</dd></div>
        <div class="strong"><dt>{{ t('field.sun.sunset') }}</dt><dd class="mono">{{ time(sun.sunset) }}</dd></div>
        <div><dt>{{ t('field.sun.dusk') }}</dt><dd class="mono">{{ time(sun.dusk) }}</dd></div>
      </dl>
      <p class="meta">
        {{ t('field.sun.daylight', { h: hours(sun.daylightHours) }) }} · {{ t('field.sun.noon', { time: time(sun.noon) }) }}
      </p>
    </template>
    <p v-else class="meta">{{ t('field.sun.noPosition') }}</p>

    <div class="moon">
      <span class="moon-disc" :style="{ '--lit': `${Math.round(moon.illumination * 100)}%` }" aria-hidden="true"><Moon :size="18" /></span>
      <span class="grow">
        <strong>{{ t(`field.moon.${moon.name}`) }} · {{ Math.round(moon.illumination * 100) }} %</strong>
        <small>{{ t('field.moon.next', { full: day(moon.nextFull), new: day(moon.nextNew) }) }}</small>
      </span>
    </div>

    <p class="note">
      {{ where ? t(`field.sun.source.${where.source}`, { lat: where.lat.toFixed(3), lon: where.lon.toFixed(3) }) : '' }}
      {{ t('field.sun.calc') }}
    </p>
  </AppCard>
</template>

<style scoped>
.grid {
  display: grid;
  /* 2×2: a 1024 px la tarjeta es estrecha y «Anochecer» no cabe en cuatro columnas. */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 0;
}

.grid div {
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.45rem;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.grid dt {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.grid dd {
  margin: 0;
  font-size: 1.05rem;
}

.grid .strong dd {
  font-weight: 700;
  color: var(--tone);
}

.polar {
  font-weight: 700;
}

.meta {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.moon {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--hairline);
}

.moon-disc {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 50%;
  color: #1b1b1b;
  background: conic-gradient(#f3e7c0 var(--lit), #4a4f4c 0);
}

.grow {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.grow small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.note {
  font-size: 0.78rem;
  color: var(--text-faint);
}
</style>
