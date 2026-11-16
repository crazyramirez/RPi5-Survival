<script setup lang="ts">
import { ArrowRight, BookOpen, ChevronRight, Layers, Search, SearchX, X } from '@lucide/vue'
import { filterGuides, groupGuides } from '~/utils/guides'
import type { GuideCategoryLook, GuideEntry, GuideGroup, GuideOverview } from '~/utils/guides'

/** Navegación común; cada módulo aporta sus propios destacados y ayuda mediante slots. */
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
const results = ref<HTMLElement | null>(null)
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

watch([query, category], () => results.value?.scrollTo({ top: 0 }), { flush: 'post' })
watch(groups, (value) => {
  if (category.value !== null && !value.some((group) => group.id === category.value)) category.value = null
}, { immediate: true })
</script>

<template>
  <div class="guide-catalog">
    <aside class="guide-sidebar">
      <h2 :id="`${uid}-categories`" class="guide-cap">{{ t('guides.categories') }}</h2>
      <div class="guide-categories" role="group" :aria-labelledby="`${uid}-categories`">
        <button type="button" class="guide-category" :aria-pressed="category === null" @click="category = null">
          <Layers :size="30" aria-hidden="true" /><span>{{ t('guides.all') }}</span><span class="guide-number">{{ items.length }}</span>
        </button>
        <button
          v-for="group in groups" :key="group.id" type="button" class="guide-category"
          :aria-pressed="category === group.id" :style="{ '--category-color': group.color ?? 'var(--accent)' }"
          @click="category = group.id"
        >
          <component :is="group.icon ?? BookOpen" :size="30" aria-hidden="true" />
          <span>{{ group.label }}</span><span class="guide-number">{{ group.items.length }}</span>
        </button>
      </div>
      <slot name="sidebar" />
    </aside>

    <div class="guide-main">
      <div class="guide-tools">
        <label class="guide-search">
          <Search :size="22" aria-hidden="true" />
          <input v-model="query" type="search" :placeholder="searchLabel" :aria-label="searchLabel" />
          <button v-if="query" type="button" :aria-label="t('guides.clearSearch')" @click="query = ''"><X :size="20" aria-hidden="true" /></button>
        </label>
        <label class="guide-mobile-categories">
          <span class="guide-cap">{{ t('guides.categories') }}</span>
          <select v-model="category" :aria-label="t('guides.categories')">
            <option :value="null">{{ t('guides.all') }} · {{ items.length }}</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.label }} · {{ group.items.length }}</option>
          </select>
        </label>
      </div>

      <div ref="results" class="guide-results" role="region" :aria-label="title" tabindex="0">
        <slot v-if="!filtered" name="featured" />
        <header class="guide-heading">
          <h2>{{ title }}</h2>
          <p aria-live="polite" aria-atomic="true">{{ t(filtered ? 'guides.matches' : 'guides.count', { n: count }) }}</p>
          <button v-if="filtered" type="button" class="guide-reset" @click="reset">{{ t('guides.reset') }}</button>
        </header>

        <div v-if="!shown.length" class="guide-empty" role="status">
          <SearchX :size="32" aria-hidden="true" />
          <p>{{ t('guides.noMatch') }}</p>
          <button type="button" class="btn" @click="reset">{{ t('guides.reset') }}</button>
        </div>
        <section v-for="group in shown" :key="group.id" class="guide-group" :class="{ 'is-overview': !filtered }" :style="{ '--category-color': group.color ?? 'var(--accent)' }">
          <h3><span aria-hidden="true" />{{ group.label }}<small class="mono">{{ group.items.length }}</small></h3>
          <ul class="guide-list">
            <li v-for="item in visibleItems(group)" :key="item.id">
              <NuxtLink :to="item.href" :aria-label="item.title" class="guide-link"><span>{{ !filtered && item.overviewTitle ? item.overviewTitle : item.title }}</span><ChevronRight :size="22" aria-hidden="true" /></NuxtLink>
            </li>
          </ul>
          <button v-if="visibleItems(group).length < group.items.length" type="button" class="guide-more" @click="category = group.id">
            {{ overview?.[group.id]?.label ?? t('guides.seeAll') }}<ArrowRight :size="22" aria-hidden="true" />
          </button>
        </section>
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide-catalog {
  display: grid;
  grid-template-columns: clamp(11rem, 21.875vw, 17rem) minmax(0, 1fr);
  gap: 1rem;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.guide-sidebar {
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 0.7rem 0.7rem 0.9rem;
  border-right: 1px solid var(--border);
}
.guide-cap {
  color: var(--text-muted);
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
}
.guide-categories { display: grid; gap: 0.35rem; margin: 0.65rem 0 1.15rem; }
.guide-category {
  display: flex;
  align-items: center;
  gap: 0;
  min-height: 2.7rem;
  width: 100%;
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--guide-border, var(--border));
  border-radius: var(--radius);
  background: var(--surface-grad);
  text-align: left;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.1;
  cursor: pointer;
}
.guide-category > svg { flex: none; margin-right: 1.2rem; color: var(--category-color, var(--accent)); }
.guide-category > span:not(.guide-number) { flex: 1; margin-right: 0.4rem; overflow-wrap: anywhere; }
.guide-number { flex: none; margin-left: auto; color: var(--text-muted); font-size: 1.1rem; font-weight: 400; }
.guide-category[aria-pressed='true'] {
  border-color: var(--accent);
  background: linear-gradient(115deg, color-mix(in srgb, var(--accent) 37%, var(--surface)), color-mix(in srgb, var(--accent) 22%, var(--surface)));
}
.guide-category:hover, .guide-link:hover { background: var(--surface-2); }
.guide-category[aria-pressed='true']:hover { background: color-mix(in srgb, var(--accent) 30%, var(--surface)); }
.guide-main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  min-width: 0;
  padding: 0.65rem 0.4rem 0 0.1rem;
  container-type: inline-size;
}
.guide-tools { flex: none; margin-right: 1.5rem; }
.guide-search {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-height: 2.7rem;
  padding: 0 1rem;
  border: 1px solid var(--guide-border, var(--border));
  border-radius: 0.65rem;
  background: var(--surface-grad);
  color: var(--text-muted);
  font-size: 1.25rem;
}
.guide-search:focus-within { outline: 2px solid var(--focus); outline-offset: 1px; }
.guide-search > svg { flex: none; width: 1.3rem; height: 1.3rem; }
.guide-search input {
  width: 100%; min-width: 0; min-height: max(var(--touch), 2.6rem);
  padding: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit;
}
.guide-search input::placeholder { color: var(--text-muted); opacity: 1; }
.guide-search input::-webkit-search-cancel-button { display: none; }
.guide-search button {
  display: grid; place-items: center; flex: none; width: var(--touch); min-height: var(--touch);
  margin-right: -0.6rem; border: 0; background: transparent; color: var(--text); cursor: pointer;
}
.guide-mobile-categories { display: none; }
.guide-results {
  min-height: 0; overflow-y: auto; padding: 0 0.9rem 0.5rem 0.4rem;
  scroll-padding: 0.4rem; touch-action: pan-y;
}
.guide-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem 1rem; margin-bottom: 0.45rem; }
.guide-heading h2 { font-size: 1.65rem; line-height: 1.2; overflow-wrap: anywhere; }
.guide-heading p { padding-left: 1.2rem; border-left: 1px solid var(--text-muted); color: var(--text-muted); font-size: 1rem; }
.guide-reset { min-height: var(--touch); padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--accent); cursor: pointer; }
.guide-group + .guide-group { margin-top: 0.45rem; }
.guide-group h3 { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.2rem; font-size: 1.2rem; line-height: 1.2; }
.guide-group h3 > span { flex: none; width: 0.75rem; height: 0.75rem; border-radius: 50%; background: var(--category-color); }
.guide-group h3 small { margin-left: auto; color: var(--text-muted); font-size: 0.8rem; }
.guide-group.is-overview h3 small { display: none; }
.guide-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 1.9rem; margin: 0; padding: 0; list-style: none; }
.guide-list li { min-width: 0; }
.guide-link {
  display: flex; align-items: center; justify-content: space-between; gap: 0.7rem;
  min-height: 44px; padding: 0.3rem 0.6rem; border-top: 1px solid var(--guide-border, var(--border)); color: var(--text);
  font-size: 1.1rem; text-decoration: none; line-height: 1.25; overflow-wrap: anywhere;
}
.guide-link svg { flex: none; color: var(--text-muted); }
.guide-more { display: flex; align-items: center; gap: 0.65rem; min-height: 44px; padding: 0.15rem 0.55rem; border: 0; background: transparent; color: var(--accent); font-size: 1rem; text-align: left; cursor: pointer; }
.guide-more:hover { text-decoration: underline; }
.guide-empty { display: grid; justify-items: start; gap: 0.8rem; padding: 1rem 0; color: var(--text-muted); }
@container (max-width: 35rem) { .guide-list { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 1150px) {
  .guide-catalog { gap: 0.55rem; }
  .guide-sidebar { padding: 0.65rem 0.5rem; }
  .guide-categories { gap: 0.3rem; margin-top: 0.4rem; }
  .guide-category { min-height: var(--touch); padding: 0.45rem 0.5rem; gap: 0.55rem; font-size: 1rem; }
  .guide-category > svg { width: 22px; height: 22px; margin-right: 0; }
  .guide-category > span:not(.guide-number) { margin-right: 0; }
  .guide-number { font-size: 0.85rem; }
  .guide-main { gap: 0.5rem; padding-top: 0.5rem; }
  .guide-tools { margin-right: 0.6rem; }
  .guide-search { font-size: 1rem; padding-inline: 0.75rem; }
  .guide-results { padding-right: 0.6rem; padding-left: 0; }
  .guide-heading { gap: 0.4rem; }
  .guide-heading h2 { font-size: 1.25rem; }
  .guide-heading p { padding-left: 0; border-left: 0; font-size: 0.85rem; }
  .guide-group h3 { font-size: 1.05rem; }
  .guide-link { font-size: 1rem; }
}
@media (max-width: 680px) {
  .guide-catalog { grid-template-columns: minmax(0, 1fr); }
  .guide-sidebar { display: none; }
  .guide-main { padding-left: 0.7rem; padding-right: 0.4rem; }
  .guide-mobile-categories { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.4rem; }
  .guide-mobile-categories select { flex: 1; min-width: 0; min-height: var(--touch); padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); color: var(--text); font: inherit; }
}
</style>
