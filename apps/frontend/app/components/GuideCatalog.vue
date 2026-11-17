<script setup lang="ts">
import { ArrowRight, BookOpen, ChevronRight, Layers, Search, SearchX, X } from '@lucide/vue'
import { filterGuides, groupGuides } from '~/utils/guides'
import type { GuideCategoryLook, GuideEntry, GuideGroup, GuideOverview } from '~/utils/guides'

/**
 * Catálogo de guías con el mismo lenguaje visual que la Biblioteca: categorías en una columna fija (tira desplazable
 * en pantallas estrechas), filtro por título, grupos con su icono y tarjetas. Cada módulo aporta sus destacados y
 * su ayuda mediante slots. La página hace el desplazamiento (como la Biblioteca); la columna se queda fija.
 */
const props = defineProps<{
  items: GuideEntry[]
  title: string
  searchLabel: string
  categoryLooks?: Record<string, GuideCategoryLook>
  overview?: Record<string, GuideOverview>
}>()
const query = defineModel<string>('query', { default: '' })
const category = defineModel<string | null>('category', { default: null })
const t = useT()
const uid = useId()
const groups = computed(() => groupGuides(props.items, props.categoryLooks))
const shown = computed(() => filterGuides(groups.value, query.value, category.value))
const count = computed(() => shown.value.reduce((total, group) => total + group.items.length, 0))
const filtered = computed(() => !!query.value.trim() || category.value !== null)
const title = computed(() => groups.value.find((group) => group.id === category.value)?.label ?? props.title)

function visibleItems(group: GuideGroup): GuideEntry[] {
  const overview = !filtered.value && props.overview?.[group.id]
  if (!overview) return group.items
  const items = new Map(group.items.map((item) => [item.id, item]))
  return overview.ids.flatMap((id) => items.has(id) ? [items.get(id)!] : [])
}

function reset(): void {
  query.value = ''
  category.value = null
}

watch(groups, (value) => {
  if (category.value !== null && !value.some((group) => group.id === category.value)) category.value = null
}, { immediate: true })
</script>

<template>
  <div class="gc">
    <aside class="cats">
      <h2 :id="`${uid}-categories`" class="cap">{{ t('guides.categories') }}</h2>
      <div class="cat-list" role="group" :aria-labelledby="`${uid}-categories`">
        <button type="button" class="cat" :aria-pressed="category === null" @click="category = null">
          <Layers :size="22" aria-hidden="true" />
          <span class="cat-label">{{ t('guides.all') }}</span>
          <span class="cat-n mono">{{ items.length }}</span>
        </button>
        <button
          v-for="group in groups" :key="group.id" type="button" class="cat"
          :aria-pressed="category === group.id" :style="{ '--cat': group.color ?? 'var(--accent)' }"
          @click="category = group.id"
        >
          <component :is="group.icon ?? BookOpen" :size="22" aria-hidden="true" />
          <span class="cat-label">{{ group.label }}</span>
          <span class="cat-n mono">{{ group.items.length }}</span>
        </button>
      </div>
      <div v-if="$slots.sidebar" class="side-extra"><slot name="sidebar" /></div>
    </aside>

    <div class="main">
      <label class="filter">
        <Search :size="20" aria-hidden="true" />
        <input v-model="query" type="search" class="selectable" :placeholder="searchLabel" :aria-label="searchLabel" />
        <button v-if="query" type="button" class="icon-btn" :aria-label="t('guides.clearSearch')" @click="query = ''"><X :size="18" aria-hidden="true" /></button>
      </label>

      <slot v-if="!filtered" name="featured" />

      <header class="heading">
        <h2>{{ title }}</h2>
        <span class="faint small" aria-live="polite" aria-atomic="true">{{ t(filtered ? 'guides.matches' : 'guides.count', { n: count }) }}</span>
        <button v-if="filtered" type="button" class="btn btn-ghost" @click="reset">{{ t('guides.reset') }}</button>
      </header>

      <div v-if="!shown.length" class="empty" role="status">
        <SearchX :size="32" aria-hidden="true" />
        <p>{{ t('guides.noMatch') }}</p>
        <button type="button" class="btn" @click="reset">{{ t('guides.reset') }}</button>
      </div>

      <section v-for="group in shown" :key="group.id" class="group" :style="{ '--cat': group.color ?? 'var(--accent)' }" :aria-label="group.label">
        <h3 class="group-head">
          <span class="group-icon"><component :is="group.icon ?? BookOpen" :size="18" aria-hidden="true" /></span>
          {{ group.label }}
          <small class="mono">{{ group.items.length }}</small>
        </h3>
        <ul class="grid">
          <li v-for="item in visibleItems(group)" :key="item.id">
            <NuxtLink :to="item.href" :aria-label="item.title" class="card">
              <span class="dot" aria-hidden="true" />
              <span class="card-title">{{ !filtered && item.overviewTitle ? item.overviewTitle : item.title }}</span>
              <ChevronRight :size="20" class="chev" aria-hidden="true" />
            </NuxtLink>
          </li>
        </ul>
        <button v-if="visibleItems(group).length < group.items.length" type="button" class="more" @click="category = group.id">
          {{ overview?.[group.id]?.label ?? t('guides.seeAll') }}<ArrowRight :size="18" aria-hidden="true" />
        </button>
      </section>
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
/* Mismas medidas que la Biblioteca (pages/biblioteca/index.vue): columna de categorías, filtro, grupos y tarjetas. */
.gc {
  display: grid;
  grid-template-columns: clamp(12rem, 20vw, 16.5rem) minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}

.cats {
  position: sticky;
  top: 0;
  max-height: calc(100dvh - var(--bar-h) - var(--action-h) - 1.5rem);
  overflow-y: auto;
  padding: 0.7rem 0.55rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-grad);
}

.cap {
  margin: 0 0 0.5rem 0.35rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.cat-list {
  display: grid;
  gap: 0.3rem;
}

.cat {
  --cat: var(--accent);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: var(--touch);
  padding: 0.35rem 0.6rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.98rem;
  font-weight: 700;
  line-height: 1.15;
  text-align: left;
  cursor: pointer;
}

.cat > svg {
  flex: none;
  color: var(--cat);
}

.cat-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cat-n {
  flex: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.cat:active {
  background: var(--surface-3);
}

.cat[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--cat) 60%, var(--border));
  background: linear-gradient(115deg, color-mix(in srgb, var(--cat) 24%, var(--surface)), color-mix(in srgb, var(--cat) 9%, var(--surface)));
}

.cat[aria-pressed='true'] .cat-n {
  color: var(--text);
}

.side-extra {
  margin-top: 0.8rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--hairline);
}

.main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.filter {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  min-height: var(--touch);
  padding: 0 0.3rem 0 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-faint);
}

.filter:focus-within {
  border-color: var(--accent);
}

.filter input {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
}

.filter input::-webkit-search-cancel-button {
  display: none;
}

.icon-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3rem 0.75rem;
}

.heading h2 {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.small {
  font-size: 0.82rem;
}

.btn-ghost {
  min-height: 2.75rem;
  margin-left: auto;
  padding: 0 0.75rem;
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font-size: 0.9rem;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.group + .group {
  margin-top: 0.35rem;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--hairline);
  font-size: 1.08rem;
  line-height: 1.2;
}

.group-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--radius-sm);
  color: var(--cat);
  background: color-mix(in srgb, var(--cat) 15%, transparent);
}

.group-head small {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.grid li {
  display: flex;
  min-width: 0;
}

.card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  min-width: 0;
  min-height: 3.4rem;
  padding: 0.5rem 0.55rem 0.5rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(70% 90% at 100% 100%, color-mix(in srgb, var(--cat) 8%, transparent), transparent 70%),
    var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  transition: background 0.12s, border-color 0.12s, transform 0.08s ease-out;
}

.card:hover {
  border-color: color-mix(in srgb, var(--cat) 45%, var(--border));
}

.card:active {
  background: var(--surface-3);
  border-color: var(--cat);
  transform: scale(0.98);
}

.dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--cat);
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.22;
  overflow-wrap: anywhere;
}

.chev {
  flex: none;
  color: var(--text-faint);
}

.more {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.more:active {
  background: var(--surface-3);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.45rem;
  padding: 1.1rem 1rem;
  border-radius: var(--radius);
  border: 1px dashed var(--border);
  color: var(--text-muted);
}

.empty svg {
  color: var(--text-faint);
}

/* Pantallas estrechas: categorías en tira horizontal, como en la Biblioteca. */
@media (max-width: 820px) {
  .gc {
    grid-template-columns: minmax(0, 1fr);
  }

  .cats {
    position: static;
    max-height: none;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .cap,
  .side-extra {
    display: none;
  }

  .cat-list {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    touch-action: pan-x;
    scrollbar-width: none;
    mask-image: linear-gradient(90deg, #000 90%, transparent);
  }

  .cat {
    flex: none;
    width: auto;
    border-color: var(--border);
    border-radius: 999px;
    background: var(--surface);
    white-space: nowrap;
  }

  .cat-label {
    overflow-wrap: normal;
  }
}
</style>
