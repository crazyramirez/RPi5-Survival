<script setup lang="ts">
import { Backpack, BookOpen, CalendarCheck, Clock3, CookingPot, FileText, FlaskConical, GitBranch, ListOrdered, TriangleAlert } from '@lucide/vue'
import type { Component } from 'vue'
import { buildGuideDocument, guideTitleParts } from '~/utils/guide-reader'
import type { GuideSectionStyle } from '~/utils/guide-reader'

/** `html` debe venir del renderizador seguro de library. Este componente no reescribe el documento. */
const props = defineProps<{
  title: string
  html: string
  category?: string
  reviewed?: string
  sources?: string
  sectionStyles?: GuideSectionStyle[]
  tone?: 'danger' | 'info' | 'warn' | 'neutral'
  reviewStatus?: string
  note?: string
  translationNote?: string
}>()
const t = useT()
const document = computed(() => buildGuideDocument(props.html))
const heading = computed(() => guideTitleParts(props.title))
const scroller = ref<HTMLElement | null>(null)
const active = ref('')
const icons: Record<GuideSectionStyle, Component> = {
  prose: FileText, steps: ListOrdered, condition: GitBranch, method: FlaskConical,
  inventory: Backpack, phase: Clock3, recipe: CookingPot, warning: TriangleAlert,
}
const styles = computed(() => props.sectionStyles?.length === document.value.sections.length ? props.sectionStyles : [])
const sections = computed(() => document.value.sections.map((section, index) => ({ ...section, style: styles.value[index] ?? 'prose' })))
const navigation = computed(() => [
  ...sections.value.map((section) => ({ id: section.id, label: section.title, level: section.level, icon: icons[section.style] })),
  ...(props.sources ? [{ id: 'guide-sources', label: t('reader.sources'), level: 0, icon: BookOpen }] : []),
])
const useTabs = computed(() => navigation.value.length <= 4 && navigation.value.every((item) => item.label.length <= 20))

function jump(id: string): void {
  const pane = scroller.value
  const target = pane?.querySelector<HTMLElement>(`[id="${id}"]`)
  if (!pane || !target) return
  active.value = id
  pane.scrollTo({ top: pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8 })
  target.focus({ preventScroll: true })
}

let frame = 0
function onScroll(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const pane = scroller.value
    if (!pane) return
    const top = pane.getBoundingClientRect().top + 70
    let current = navigation.value[0]?.id ?? ''
    for (const item of navigation.value) {
      const target = pane.querySelector(`[id="${item.id}"]`)
      if (target && target.getBoundingClientRect().top <= top) current = item.id
    }
    active.value = current
  })
}
watch(() => props.html, async () => {
  active.value = navigation.value[0]?.id ?? ''
  await nextTick()
  scroller.value?.scrollTo({ top: 0 })
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="guide-reader" :class="`reader-tone-${tone ?? 'neutral'}`">
    <header class="reader-toolbar">
      <slot name="back" />
      <span class="reader-caption">{{ t('reader.caption') }}</span>
      <span class="reader-current-title" :title="title">{{ heading.title }}</span>
      <div class="reader-actions"><slot name="actions" /></div>
    </header>

    <div class="reader-workspace">
      <aside class="reader-sidebar">
        <h2 class="reader-cap">{{ t('reader.contents') }}</h2>
        <nav :aria-label="t('reader.contents')" class="reader-index">
          <button
            v-for="item in navigation" :key="item.id" type="button" :aria-current="active === item.id ? 'location' : undefined"
            :class="{ nested: item.level > 0 }" @click="jump(item.id)"
          >
            <component :is="item.icon" :size="24" aria-hidden="true" /><span>{{ item.label }}</span>
          </button>
        </nav>
        <section class="reader-about">
          <h2>{{ t('reader.about') }}</h2>
          <p v-if="category" class="reader-category"><BookOpen :size="20" aria-hidden="true" /><span>{{ category }}</span></p>
          <p v-if="reviewed"><CalendarCheck :size="20" aria-hidden="true" /><span>{{ t('em.reviewed', { date: reviewed }) }}</span></p>
          <p v-if="reviewStatus" class="reader-review"><TriangleAlert :size="20" aria-hidden="true" /><span>{{ reviewStatus }}</span></p>
          <p v-if="sources" class="reader-source-summary"><BookOpen :size="20" aria-hidden="true" /><span>{{ sources }}</span></p>
        </section>
      </aside>

      <div class="reader-main">
        <nav v-if="navigation.length" class="reader-mobile-index" :aria-label="t('reader.contents')">
          <div v-if="useTabs" class="reader-tabs">
            <button v-for="item in navigation" :key="item.id" type="button" :aria-current="active === item.id ? 'location' : undefined" @click="jump(item.id)">{{ item.label }}</button>
          </div>
          <label v-else class="reader-section-select"><span>{{ t('reader.sections') }}</span>
            <select :value="active" @change="jump(($event.target as HTMLSelectElement).value)">
              <option v-for="item in navigation" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
        </nav>

        <div ref="scroller" class="reader-scroll" tabindex="0" :aria-label="title" @scroll.passive="onScroll">
          <article class="reader-document protocol">
            <header class="reader-heading" :aria-label="title">
              <h1>{{ heading.title }}</h1>
              <p v-if="heading.subtitle" class="reader-subtitle">{{ heading.subtitle }}</p>
              <div class="reader-compact-meta tags">
                <span v-if="category">{{ category }}</span>
                <span v-if="reviewed">{{ t('em.reviewed', { date: reviewed }) }}</span>
                <span v-if="reviewStatus" class="reader-review">{{ reviewStatus }}</span>
              </div>
            </header>
            <p v-if="translationNote" class="reader-translation">{{ translationNote }}</p>
            <!-- El mismo HTML escapado y autorizado que ya entregaba library. -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="document.introHtml" class="reader-intro" v-html="document.introHtml" />

            <section v-for="section in sections" :key="section.id" class="reader-section" :class="[`section--${section.style}`, { 'section--nested': section.level > 0 }]" :aria-labelledby="section.id">
              <component :is="`h${Math.min(4, section.level + 2)}`" :id="section.id" class="reader-section-title" tabindex="-1" :data-level="section.level">
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span v-html="section.headingHtml" />
              </component>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="reader-body" v-html="section.html" />
            </section>

            <section v-if="sources" class="reader-sources" aria-labelledby="guide-sources">
              <h2 id="guide-sources" tabindex="-1"><BookOpen :size="24" aria-hidden="true" />{{ t('reader.sources') }}</h2>
              <p>{{ sources }}</p>
            </section>
            <p v-if="note" class="reader-note"><TriangleAlert :size="20" aria-hidden="true" /><span>{{ note }}</span></p>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guide-reader {
  --reader-accent: var(--accent);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--bg);
}
.reader-tone-danger { --reader-accent: var(--danger); }
.reader-tone-info { --reader-accent: var(--info); }
.reader-tone-warn { --reader-accent: var(--warn); }
.reader-toolbar { display: flex; align-items: center; flex: none; gap: 1rem; min-height: 3.6rem; padding: 0.5rem 1.1rem; border-bottom: 1px solid var(--border); }
.reader-caption { padding-left: 1rem; border-left: 1px solid var(--text-muted); color: var(--text-muted); }
.reader-current-title { display: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.reader-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 0.65rem; margin-left: auto; }
.reader-workspace { display: grid; grid-template-columns: clamp(13rem, 21.2vw, 17rem) minmax(0, 1fr); flex: 1; min-height: 0; }
.reader-sidebar { overflow-y: auto; min-height: 0; padding: 1rem; border-right: 1px solid var(--border); }
.reader-cap { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.09em; color: var(--text-muted); text-transform: uppercase; }
.reader-index { display: grid; gap: 0.3rem; margin: 0.5rem 0 1.2rem; }
.reader-index button { display: flex; align-items: center; gap: 0.6rem; min-height: var(--touch); padding: 0.35rem 0.6rem; border: 1px solid transparent; border-radius: var(--radius); background: transparent; color: var(--text); font: inherit; font-size: 0.98rem; font-weight: 700; line-height: 1.15; text-align: left; cursor: var(--cursor-point); }
.reader-index button:active { background: var(--surface-3); }
.reader-index button svg { flex: none; color: var(--text-muted); }
.reader-index button span { overflow-wrap: anywhere; }
.reader-index button.nested { margin-left: 0.8rem; font-size: 0.9rem; }
.reader-index button[aria-current='location'], .reader-tabs button[aria-current='location'] { border-color: color-mix(in srgb, var(--reader-accent) 60%, var(--border)); background: linear-gradient(115deg, color-mix(in srgb, var(--reader-accent) 24%, var(--surface)), color-mix(in srgb, var(--reader-accent) 9%, var(--surface))); }
.reader-about { padding: 0.85rem; border: 1px solid var(--guide-border, var(--border)); border-radius: var(--radius-lg); background: var(--surface-grad); }
.reader-about h2 { margin-bottom: 0.75rem; font-size: 1.05rem; }
.reader-about p { display: flex; align-items: flex-start; gap: 0.65rem; margin-top: 0.7rem; font-size: 0.9rem; overflow-wrap: anywhere; }
.reader-about p svg { flex: none; color: var(--text-muted); }
.reader-source-summary { padding-top: 0.75rem; border-top: 1px solid var(--border); color: var(--text-muted); }
.reader-review { color: var(--warn); }
.reader-about .reader-review { padding: 0.55rem; border: 1px solid var(--warn); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--warn) 8%, transparent); }
.reader-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.reader-mobile-index { display: none; }
.reader-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 0.9rem 1.4rem 1.4rem; scroll-padding-top: 0.5rem; touch-action: pan-y; }
.reader-document { width: 100%; max-width: 65rem; margin-inline: auto; }
.reader-heading { margin-bottom: 0.8rem; padding-left: 1rem; border-left: 3px solid var(--reader-accent); }
.reader-heading h1 { font-size: clamp(1.35rem, 2.1vw, 1.7rem); line-height: 1.15; overflow-wrap: anywhere; }
.reader-subtitle { margin-top: 0.2rem; font-size: 0.95rem; color: var(--text-muted); }
.reader-compact-meta { display: none; }
.reader-translation { margin-bottom: 0.8rem; padding: 0.7rem; border-left: 3px solid var(--info); background: color-mix(in srgb, var(--info) 8%, var(--surface)); color: var(--text-muted); }
.reader-intro { margin-bottom: 1.2rem; }
.reader-intro :deep(blockquote) { margin: 0; padding: 0.65rem 0.85rem; border: 1px solid var(--warn); border-radius: var(--radius); background: color-mix(in srgb, var(--warn) 9%, var(--surface)); font-size: 1rem; line-height: 1.45; }
.reader-section { margin: 0 0 1.1rem; }
.reader-section > .reader-section-title { margin-bottom: 0.6rem; font-size: 1.2rem; line-height: 1.25; overflow-wrap: anywhere; scroll-margin-top: 0.5rem; }
.section--nested { margin-left: 0.8rem; }
.section--nested > .reader-section-title { font-size: 1.08rem; }
.reader-body { font-size: 1.12rem; line-height: 1.55; overflow-wrap: anywhere; }
.reader-body :deep(p) { margin: 0.5rem 0; }
.reader-body :deep(ul), .reader-body :deep(ol) { margin: 0.5rem 0; padding-left: 1.5rem; }
.reader-body :deep(li) { padding: 0.3rem 0 0.3rem 0.2rem; }
.reader-body :deep(li::marker) { color: var(--reader-accent); }
.reader-body :deep(strong) { color: var(--text); font-weight: 700; }
.reader-body :deep(a) { color: var(--info); }
.reader-body :deep(blockquote) { margin: 0.7rem 0; padding: 0.7rem; border-left: 3px solid var(--warn); background: color-mix(in srgb, var(--warn) 9%, var(--surface)); }
.section--steps .reader-body :deep(ol) { counter-reset: guide-step; display: grid; gap: 0.65rem; list-style: none; padding: 0; margin: 0; }
.section--steps .reader-body :deep(ol > li) { counter-increment: guide-step; position: relative; min-height: 4.5rem; padding: 0.9rem 1rem 0.9rem 4.6rem; border: 1px solid var(--guide-border, var(--border)); border-radius: var(--radius); background: var(--surface-grad); }
.section--steps .reader-body :deep(ol > li::before) { content: counter(guide-step); position: absolute; left: 0.8rem; top: 0.8rem; display: grid; place-items: center; width: 2.4rem; height: 2.4rem; border: 1.5px solid color-mix(in srgb, var(--reader-accent) 70%, transparent); border-radius: 50%; background: color-mix(in srgb, var(--reader-accent) 10%, transparent); color: var(--reader-accent); font: 700 1.05rem var(--font-mono); }
.section--condition, .section--method, .section--inventory, .section--phase, .section--recipe, .section--warning { padding: 0.85rem 1rem; border: 1px solid var(--guide-border, var(--border)); border-radius: var(--radius); background: var(--surface-grad); }
.section--condition { border-left: 3px solid var(--reader-accent); }
.section--method > .reader-section-title { color: var(--info); }
.section--inventory > .reader-section-title { color: var(--accent); }
.section--phase { border-top: 3px solid var(--reader-accent); }
.section--recipe { border-left: 3px solid var(--info); }
.section--warning { border-color: color-mix(in srgb, var(--warn) 65%, var(--border)); background: color-mix(in srgb, var(--warn) 7%, var(--surface)); }
.section--warning > .reader-section-title { color: var(--warn); }
.reader-body :deep(.table) { max-width: 100%; overflow-x: auto; }
.reader-body :deep(table) { width: 100%; border-collapse: collapse; }
.reader-body :deep(th), .reader-body :deep(td) { padding: 0.6rem; border: 1px solid var(--border); text-align: left; }
.reader-body :deep(th) { background: var(--surface-2); }
.reader-body :deep(pre) { overflow-x: auto; padding: 0.75rem; border-radius: var(--radius-sm); background: var(--surface-2); }
.reader-body :deep(code) { font-family: var(--font-mono); font-size: 0.9em; }
.reader-sources { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); }
.reader-sources h2 { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.55rem; font-size: 1.08rem; }
.reader-sources p { font-size: 0.95rem; line-height: 1.5; overflow-wrap: anywhere; }
.reader-note { display: flex; align-items: flex-start; gap: 0.6rem; margin-top: 1rem; padding: 0.75rem; border: 1px solid var(--warn); border-radius: var(--radius); background: color-mix(in srgb, var(--warn) 8%, var(--surface)); font-size: 0.9rem; line-height: 1.45; }
.reader-note svg { flex: none; color: var(--warn); }
@media (max-width: 1150px) {
  .reader-toolbar { min-height: 60px; padding: 0.35rem 0.65rem; gap: 0.55rem; }
  .reader-caption { display: none; }
  .reader-current-title { display: block; }
  .reader-actions { gap: 0.45rem; }
  .reader-workspace { grid-template-columns: minmax(0, 1fr); }
  .reader-sidebar { display: none; }
  .reader-mobile-index { display: block; flex: none; padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--border); background: var(--surface); }
  .reader-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 0.5rem; }
  .reader-tabs button { min-width: 0; min-height: var(--touch); padding: 0.4rem; border: 1px solid var(--border); border-radius: var(--radius); background: transparent; color: var(--text); font-weight: 700; cursor: var(--cursor-point); overflow-wrap: anywhere; }
  .reader-section-select { display: flex; align-items: center; gap: 0.8rem; }
  .reader-section-select > span { color: var(--text-muted); font-weight: 700; }
  .reader-section-select select { flex: 1; min-width: 0; min-height: var(--touch); padding: 0.4rem 0.6rem; border: 1px solid var(--guide-border, var(--border)); border-radius: var(--radius); background: var(--surface-2); color: var(--text); font: inherit; }
  .reader-scroll { padding: 0.75rem; }
  .reader-heading h1 { font-size: 1.35rem; }
  .reader-subtitle { font-size: 0.92rem; }
  .reader-compact-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem 0.8rem; margin-top: 0.4rem; color: var(--text-muted); font-size: 0.8rem; }
  .reader-section > .reader-section-title { font-size: 1.12rem; }
  .reader-body { font-size: 1.08rem; }
}
@media (max-width: 600px) {
  .reader-toolbar { flex-wrap: wrap; }
  .reader-current-title { display: none; }
  .reader-actions { gap: 0.35rem; }
  .reader-actions :deep(.btn) { min-width: var(--touch); padding-inline: 0.6rem; }
  .reader-actions :deep(.fav span) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .reader-section-select { gap: 0.5rem; }
  .reader-heading h1 { font-size: 1.45rem; }
  .reader-body { font-size: 1.1rem; }
  .section--steps .reader-body :deep(ol > li) { padding: 0.75rem 0.7rem 0.75rem 3.8rem; }
  .section--steps .reader-body :deep(ol > li::before) { left: 0.55rem; width: 2.35rem; height: 2.35rem; }
}
</style>
