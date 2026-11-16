<script setup lang="ts">
/**
 * Buscador de lugares sin conexión (pueblos, barrios, parajes) sobre el índice que el servicio de biblioteca
 * construye a partir de los mapas instalados. Prefiere lo cercano al centro del mapa.
 */
import { Loader, MapPin, Search, TriangleAlert, X } from '@lucide/vue'
import type { PlaceHit, PlaceSearch } from '@survival-os/shared-types'
import { formatDistance } from '~/utils/waypoints'

const props = defineProps<{ near: { lat: number; lon: number } | null }>()
const emit = defineEmits<{ pick: [hit: PlaceHit]; close: [] }>()
const t = useT()

const q = ref('')
const result = ref<PlaceSearch | null>(null)
const loading = ref(false)
const failed = ref(false)
const input = ref<HTMLInputElement | null>(null)
let ctrl: AbortController | null = null
let debounce: ReturnType<typeof setTimeout> | undefined
let poll: ReturnType<typeof setInterval> | undefined

/** Etiqueta del tipo de lugar; los tipos raros caen en «Lugar». */
const DETAILS = ['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'locality', 'isolated_dwelling', 'farm'] as const
function detailLabel(d: string): string {
  return (DETAILS as readonly string[]).includes(d) ? t(`places.detail.${d as (typeof DETAILS)[number]}`) : t('places.detail.other')
}

async function run(): Promise<void> {
  ctrl?.abort()
  const ac = new AbortController()
  ctrl = ac
  const params = new URLSearchParams({ q: q.value.trim(), limit: '25' })
  if (props.near) {
    params.set('lat', props.near.lat.toFixed(5))
    params.set('lon', props.near.lon.toFixed(5))
  }
  loading.value = true
  try {
    result.value = await $fetch<PlaceSearch>(`/api/library/places/search?${params.toString()}`, { signal: ac.signal, timeout: 15_000, retry: 0 })
    failed.value = false
  } catch {
    if (!ac.signal.aborted) failed.value = true
  } finally {
    if (ctrl === ac) loading.value = false
  }
}

watch(q, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => void run(), 250)
})

const state = computed(() => result.value?.status.state ?? null)
const hits = computed(() => (q.value.trim().length >= 2 ? (result.value?.hits ?? []) : []))
const progress = computed(() => Math.round((result.value?.status.progress ?? 0) * 100))

onMounted(() => {
  void run()
  input.value?.focus()
  // Mientras se prepara el índice, se refresca el estado (y los resultados, si ya hay texto).
  poll = setInterval(() => {
    if (state.value === 'building' && !document.hidden) void run()
  }, 2500)
})
onBeforeUnmount(() => {
  ctrl?.abort()
  clearTimeout(debounce)
  clearInterval(poll)
})
</script>

<template>
  <div class="ps-backdrop" @click.self="emit('close')">
    <section class="ps" role="dialog" aria-modal="true" :aria-label="t('places.title')">
      <header class="ps-head">
        <label class="ps-field">
          <Search :size="20" aria-hidden="true" />
          <input
            ref="input"
            v-model="q"
            type="search"
            class="selectable"
            maxlength="80"
            enterkeyhint="search"
            autocomplete="off"
            :placeholder="t('places.placeholder')"
            :aria-label="t('places.title')"
          />
          <Loader v-if="loading" :size="18" class="spin" aria-hidden="true" />
        </label>
        <button type="button" class="btn icon-btn" :aria-label="t('display.close')" @click="emit('close')"><X :size="20" /></button>
      </header>

      <p v-if="state === 'building'" class="ps-note tone-info" role="status">
        <Loader :size="16" class="spin" aria-hidden="true" /><span>{{ t('places.building', { p: progress }) }}</span>
      </p>
      <p v-else-if="state === 'none'" class="ps-note tone-warn"><TriangleAlert :size="16" aria-hidden="true" /><span>{{ t('places.none') }}</span></p>
      <p v-else-if="state === 'error'" class="ps-note tone-warn"><TriangleAlert :size="16" aria-hidden="true" /><span>{{ t('places.error') }}</span></p>
      <p v-else-if="failed" class="ps-note tone-warn"><TriangleAlert :size="16" aria-hidden="true" /><span>{{ t('places.unavailable') }}</span></p>

      <ul v-if="hits.length" class="ps-list">
        <li v-for="(h, i) in hits" :key="`${h.lat},${h.lon},${i}`">
          <button type="button" class="ps-hit" @click="emit('pick', h)">
            <MapPin :size="20" aria-hidden="true" />
            <span class="ps-main">
              <strong>{{ h.name }}</strong>
              <small>
                {{ detailLabel(h.detail) }}<template v-if="h.localName"> · {{ h.localName }}</template>
              </small>
            </span>
            <span v-if="h.distanceM !== null" class="ps-dist mono">{{ formatDistance(h.distanceM) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="q.trim().length >= 2 && !loading && state === 'ready'" class="ps-empty">{{ t('places.noResults') }}</p>
      <p v-else-if="state === 'ready'" class="ps-empty">{{ t('places.hint', { n: (result?.status.count ?? 0).toLocaleString(bcp47()) }) }}</p>
    </section>
  </div>
</template>

<style scoped>
.ps-backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  /* Arriba: el teclado en pantalla aparece abajo. */
  align-items: flex-start;
  justify-content: center;
  background: rgb(0 0 0 / 55%);
  animation: fade-in 0.14s ease-out;
}

.ps {
  width: min(44rem, 100%);
  max-height: 62%;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.75rem 0.85rem 0.85rem;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  border: 1px solid var(--border);
  border-top: none;
  background: var(--surface);
  animation: pop-in 0.16s ease-out;
}

.ps-head {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.ps-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 3.25rem;
  padding: 0 0.85rem;
  border-radius: var(--radius);
  border: 1.5px solid var(--accent);
  background: var(--surface-2);
  color: var(--accent);
}

.ps-field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 1.1rem;
}

.ps-note {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone) 45%, var(--border));
  background: color-mix(in srgb, var(--tone) 10%, var(--surface));
  font-size: 0.88rem;
}

.ps-note svg {
  flex: none;
  color: var(--tone);
}

.ps-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ps-hit {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 3.25rem;
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ps-hit:active {
  background: var(--surface-3);
}

.ps-hit > svg {
  flex: none;
  color: var(--accent);
}

.ps-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ps-main strong,
.ps-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ps-main small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.ps-dist {
  flex: none;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.ps-empty {
  padding: 0.4rem 0.2rem;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
