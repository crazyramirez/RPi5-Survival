<script setup lang="ts">
import { BookOpen, ChevronRight, Droplets, FlaskConical, HeartPulse, LifeBuoy, Phone, Printer, Search, ShieldAlert, Siren, ThermometerSun, X } from '@lucide/vue'
import type { Component } from 'vue'
import type { ProtocolSummary } from '@survival-os/shared-types'
import type { Tone } from '~/utils/alerts'

const t = useT()
const protocols = ref<ProtocolSummary[] | null>(null)
const error = ref(false)

onMounted(async () => {
  try {
    protocols.value = await $fetch<ProtocolSummary[]>('/api/library/protocols', { timeout: 8000, retry: 0 })
  } catch {
    error.value = true
  }
})

const groups = computed(() => {
  const map = new Map<string, ProtocolSummary[]>()
  for (const p of protocols.value ?? []) map.set(p.category, [...(map.get(p.category) ?? []), p])
  return [...map.entries()]
})

// ---- Filtro local (sin red): texto sin tildes ni mayúsculas + categoría.
const query = ref('')
const cat = ref<string | null>(null)
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const shown = computed(() => {
  const q = fold(query.value.trim())
  return groups.value
    .filter(([c]) => !cat.value || c === cat.value)
    .map(([c, items]) => [c, q ? items.filter((p) => fold(`${p.title} ${c}`).includes(q)) : items] as const)
    .filter(([, items]) => items.length)
})

// ------------------------------------------------------------------ Presentación
/**
 * Icono y color por categoría, solo para orientarse visualmente: los protocolos no
 * declaran gravedad, así que el tono identifica el tema, no la urgencia.
 */
function categoryLook(category: string): { icon: Component; tone: Tone } {
  const c = category.toLowerCase()
  if (c.includes('auxilio') || c.includes('sanit') || c.includes('médic')) return { icon: HeartPulse, tone: 'danger' }
  if (c.includes('clima') || c.includes('calor') || c.includes('frío')) return { icon: ThermometerSun, tone: 'warn' }
  if (c.includes('agua')) return { icon: Droplets, tone: 'info' }
  if (c.includes('intoxica') || c.includes('picadura')) return { icon: FlaskConical, tone: 'info' }
  if (c.includes('desastre') || c.includes('entorno')) return { icon: Siren, tone: 'warn' }
  return { icon: BookOpen, tone: 'ok' }
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('module.emergency')" :icon="LifeBuoy" :phase="3">
      <NuxtLink to="/emergencias/imprimir" class="btn print-btn"><Printer :size="18" aria-hidden="true" /> {{ t('ui.print.open') }}</NuxtLink>
    </PageHeader>

    <!-- Lo primero: el número de emergencias. -->
    <section class="hero tone-danger">
      <span class="orb" aria-hidden="true"><Phone :size="28" /></span>
      <div class="hero-text">
        <span class="hero-cap">{{ t('em.call') }}</span>
        <p class="number mono">{{ t('em.call.number') }}</p>
        <p class="hero-note">{{ t('em.call.note') }}</p>
      </div>
      <dl v-if="protocols" class="hero-stats">
        <div>
          <dt>{{ t('ui.em.count') }}</dt>
          <dd class="mono">{{ protocols.length }}</dd>
        </div>
        <div>
          <dt>{{ t('ui.em.categories') }}</dt>
          <dd class="mono">{{ groups.length }}</dd>
        </div>
      </dl>
    </section>

    <div class="notice tone-warn disclaimer">
      <ShieldAlert :size="18" aria-hidden="true" />
      <span>{{ t('em.disclaimer') }}</span>
    </div>

    <div v-if="error" class="notice tone-danger">{{ t('lib.serviceDown') }}</div>
    <p v-else-if="!protocols" class="muted">{{ t('state.loading') }}</p>
    <p v-else-if="!protocols.length" class="muted">{{ t('em.protocols.none') }}</p>

    <div v-if="protocols?.length" class="filters">
      <label class="search">
        <Search :size="18" aria-hidden="true" />
        <input v-model="query" type="search" class="search-input" :placeholder="t('ui.em.search')" :aria-label="t('ui.em.search')" />
        <button v-if="query" type="button" class="clear" :aria-label="t('common.cancel')" @click="query = ''"><X :size="18" /></button>
      </label>
      <div class="chips" role="group" :aria-label="t('ui.em.categories')">
        <button type="button" class="chip" :aria-pressed="cat === null" @click="cat = null">{{ t('ui.em.all') }}</button>
        <button
          v-for="[c, items] in groups" :key="c" type="button" class="chip" :class="`tone-${categoryLook(c).tone}`"
          :aria-pressed="cat === c" @click="cat = cat === c ? null : c"
        >
          <component :is="categoryLook(c).icon" :size="16" aria-hidden="true" />{{ c }}<span class="mono n">{{ items.length }}</span>
        </button>
      </div>
    </div>
    <p v-if="protocols?.length && !shown.length" class="muted">{{ t('ui.em.noMatch') }}</p>

    <section v-for="[category, items] in shown" :key="category" class="group">
      <h2 class="ui-sec">{{ category }}<span class="sec-count mono">{{ items.length }}</span></h2>
      <div class="list">
        <NuxtLink v-for="p in items" :key="p.id" :to="`/emergencias/${p.id}`" class="item" :class="`tone-${categoryLook(category).tone}`">
          <span class="item-icon" aria-hidden="true"><component :is="categoryLook(category).icon" :size="22" /></span>
          <span class="item-text">
            <span class="item-title">{{ p.title }}</span>
            <span class="item-meta">{{ t('em.reviewed', { date: p.reviewed }) }}</span>
          </span>
          <ChevronRight :size="22" class="chev" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------ 112 */
.hero {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 50%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 18%, transparent), transparent 60%),
    var(--surface-grad);
  animation: fade-in 0.18s ease-out;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.6rem;
  height: 3.6rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 70%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--tone) 9%, transparent);
}

.hero-text {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 1rem;
  align-items: center;
}

.hero-cap {
  grid-column: 1 / -1;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tone);
}

.number {
  font-size: 2.6rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.05;
  color: var(--text);
}

.hero-note {
  max-width: 20rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.3;
}

.hero-stats {
  flex: none;
  display: flex;
  margin: 0;
}

.hero-stats div {
  padding: 0.15rem 0 0.15rem 1rem;
  margin-left: 1rem;
  border-left: 1px solid var(--border);
}

.hero-stats dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.hero-stats dd {
  margin: 0.2rem 0 0;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--text);
}

.disclaimer {
  margin-top: var(--gap);
  font-size: 0.88rem;
}

/* ------------------------------------------------------------ Protocolos */
.group {
  margin-top: 0.9rem;
}

.sec-count {
  padding: 0 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.7rem;
  letter-spacing: 0;
  color: var(--text-muted);
}

.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: var(--gap);
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-height: 4.25rem;
  padding: 0.6rem 0.7rem 0.6rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  overflow: hidden;
  transition: transform 0.08s ease-out;
}

/* Filo lateral con el color del tema. */
.item::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, var(--tone), color-mix(in srgb, var(--tone) 20%, transparent));
}

.item:active {
  transform: scale(0.97);
  background: var(--surface-3);
  border-color: color-mix(in srgb, var(--tone) 55%, var(--border));
}

.item-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: var(--radius);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.item-title {
  font-weight: 700;
  font-size: 1rem;
  line-height: 1.25;
}

.item-meta {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.chev {
  flex: none;
  color: var(--text-faint);
}

.print-btn {
  margin-left: auto;
  min-height: 2.75rem; /* ≥ 44 px táctil */
}

/* ------------------------------------------------------------ Filtros */
.filters {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.2rem 0 0.4rem;
}

.search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 3rem;
  padding: 0 0.4rem 0 0.8rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  color: var(--text-muted);
}

.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.search-input {
  flex: 1;
  min-width: 0;
  min-height: 2.9rem;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 1.05rem;
  outline: none;
}

.clear {
  display: grid;
  place-items: center;
  width: var(--touch);
  height: var(--touch);
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chips {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  touch-action: pan-x;
  scrollbar-width: none;
}

.chip {
  --tone: var(--accent);
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--touch);
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.chip.tone-danger { --tone: var(--danger); }
.chip.tone-warn { --tone: var(--warn); }
.chip.tone-info { --tone: var(--info); }
.chip.tone-ok { --tone: var(--ok); }

.chip svg {
  color: var(--tone);
}

.chip .n {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.chip[aria-pressed='true'] {
  border-color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  color: var(--text);
}

/* ------------------------------------------------------------ Móvil (vista pública) */
@media (max-width: 640px) {
  .hero {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .orb {
    width: 3rem;
    height: 3rem;
  }

  .hero-stats {
    flex-basis: 100%;
    padding-top: 0.5rem;
    border-top: 1px solid var(--hairline);
  }

  .hero-stats div:first-child {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }
}
</style>
