<script setup lang="ts">
import { BookOpen, Bot, Check, FileText, Gamepad2, Map as MapIcon, Route, Star, X } from '@lucide/vue'
import type { Component } from 'vue'
import type { ContentCatalogItem, ContentDetails } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * Ficha «Más información» de un contenido del catálogo, sin Internet: explicación escrita, datos oficiales de
 * Kiwix (artículos, fecha, fotos/vídeos, resumen), editor, capítulos de los manuales y nivel de detalle de los
 * mapas. Solo se enseña lo que hay: un dato que falta no aparece.
 */
const props = defineProps<{
  item: ContentCatalogItem
  details: ContentDetails | null
  loading: boolean
  bytes: number
  selected: boolean
  /** No se puede marcar (instalado o descargando). */
  locked: boolean
  stateText: string | null
  highlightFor: string[]
}>()
const emit = defineEmits<{ close: []; toggle: [] }>()
const t = useT()

const KIND: Record<ContentCatalogItem['kind'], { icon: Component; key: 'zim' | 'doc' | 'maps' | 'routing' | 'llm' | 'games' }> = {
  zim: { icon: BookOpen, key: 'zim' },
  doc: { icon: FileText, key: 'doc' },
  maps: { icon: MapIcon, key: 'maps' },
  routing: { icon: Route, key: 'routing' },
  llm: { icon: Bot, key: 'llm' },
  games: { icon: Gamepad2, key: 'games' },
}
const kind = computed(() => KIND[props.item.kind])
const k = computed(() => props.details?.kiwix ?? null)
const num = (n: number): string => new Intl.NumberFormat(locale.value).format(n)
const date = (iso: string): string => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`))

/** Idioma del contenido: el del catálogo; «Varios» si Kiwix da más de uno. */
const langLabel = computed(() => {
  if (k.value?.language?.includes(',') || props.item.lang === 'mul') return t('content.info.langMany')
  const l = props.item.lang
  return ['es', 'en', 'fr', 'it'].includes(l) ? t(`content.lang.${l}` as 'content.lang.en') : l
})

const facts = computed(() => {
  const rows: { label: string; value: string }[] = [{ label: t('content.info.format'), value: t(`content.info.kind.${kind.value.key}`) }]
  if (props.details?.publisher) rows.push({ label: t('content.info.publisher'), value: props.details.publisher })
  // Mapas, rutas y juegos no tienen idioma propio.
  if (!['maps', 'routing', 'games'].includes(props.item.kind)) rows.push({ label: t('content.info.language'), value: langLabel.value })
  rows.push({ label: t('content.info.size'), value: formatBytes(props.bytes) })
  // Kiwix cuenta «1 artículo» en las colecciones que son un único índice: esa cifra no dice nada.
  if (k.value?.articles && k.value.articles > 1) rows.push({ label: t('content.info.articles'), value: num(k.value.articles) })
  if (k.value?.media && k.value.media > 1) rows.push({ label: t('content.info.media'), value: num(k.value.media) })
  if (k.value && (k.value.pictures != null || k.value.videos != null)) {
    const has = [k.value.pictures && t('content.info.pictures'), k.value.videos && t('content.info.videos')].filter(Boolean).join(' · ')
    rows.push({ label: t('content.info.includes'), value: has || t('content.info.textOnly') })
  }
  if (k.value?.date) rows.push({ label: t('content.info.version'), value: date(k.value.date) })
  if (props.details?.maxZoom) rows.push({ label: t('content.info.detail'), value: t(props.details.maxZoom >= 15 ? 'content.info.zoomStreet' : 'content.info.zoomGeneral') })
  if (props.details?.chapters) rows.push({ label: t('content.info.parts'), value: num(props.details.chapters.length) })
  rows.push({ label: t('content.info.license'), value: props.item.license })
  return rows
})

const showChapters = ref(false)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" :aria-labelledby="`info-${item.id}`">
      <header class="head">
        <img v-if="k?.icon" :src="k.icon" alt="" class="ico img" width="48" height="48" />
        <span v-else class="ico" aria-hidden="true"><component :is="kind.icon" :size="24" /></span>
        <div class="titles">
          <h2 :id="`info-${item.id}`">{{ item.title }}</h2>
          <p class="sub">{{ item.description }}</p>
        </div>
        <button type="button" class="btn icon-btn close" :aria-label="t('common.close')" @click="emit('close')"><X :size="20" /></button>
      </header>

      <div class="body">
        <p v-if="highlightFor.length" class="star-note"><Star :size="14" aria-hidden="true" />{{ t('content.info.highlightFor', { list: highlightFor.join(', ') }) }}</p>

        <p v-if="details?.about" class="about">{{ details.about }}</p>
        <p v-else-if="loading" class="muted">{{ t('state.loading') }}</p>

        <dl class="facts">
          <template v-for="r in facts" :key="r.label">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </template>
        </dl>

        <figure v-if="k?.summary" class="summary">
          <blockquote>«{{ k.summary }}»</blockquote>
          <figcaption>{{ t('content.info.summaryBy') }}</figcaption>
        </figure>

        <section v-if="details?.chapters" class="chapters">
          <button type="button" class="btn small" :aria-expanded="showChapters" @click="showChapters = !showChapters">
            {{ showChapters ? t('content.info.hideChapters') : t('content.info.showChapters', { n: details.chapters.length }) }}
          </button>
          <!-- Sin numeración: los títulos ya traen la suya («10 Primeros auxilios»). -->
          <ul v-if="showChapters">
            <li v-for="(c, n) in details.chapters" :key="n">{{ c }}</li>
          </ul>
        </section>
      </div>

      <footer class="foot">
        <span v-if="stateText" class="ui-chip tone-ok">{{ stateText }}</span>
        <button v-else type="button" class="btn" :class="selected ? 'glass-btn' : 'btn-primary'" :disabled="locked" @click="emit('toggle')">
          <Check v-if="selected" :size="18" aria-hidden="true" />
          {{ selected ? t('content.info.unpick') : t('content.info.pick', { size: formatBytes(bytes) }) }}
        </button>
        <button type="button" class="btn" @click="emit('close')">{{ t('common.close') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgb(0 0 0 / 68%);
  animation: fade-in 0.14s ease-out;
}

.sheet {
  display: flex;
  flex-direction: column;
  width: min(40rem, 100%);
  max-height: 100%;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background:
    radial-gradient(90% 40% at 0% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%),
    var(--surface);
  box-shadow: 0 24px 60px rgb(0 0 0 / 50%);
  animation: pop-in 0.16s ease-out;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  padding: 1rem 1rem 0.6rem 1.1rem;
}

.ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.8rem;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
}

.ico.img {
  padding: 0.3rem;
  object-fit: contain;
  background: #fff;
}

.titles {
  flex: 1;
  min-width: 0;
}

.titles h2 {
  font-size: 1.2rem;
  line-height: 1.25;
}

.sub {
  margin-top: 0.2rem;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.4;
}

.close {
  flex: none;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.3rem 1.1rem 1rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.star-note {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 700;
}

.about {
  font-size: 1rem;
  line-height: 1.55;
}

.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.35rem 1rem;
  margin: 0;
  padding: 0.8rem 0.9rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 0.9rem;
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.summary {
  margin: 0;
  padding-left: 0.8rem;
  border-left: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
}

.summary blockquote {
  margin: 0;
  font-style: italic;
  line-height: 1.45;
}

.summary figcaption {
  margin-top: 0.25rem;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.chapters {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.btn.small {
  min-height: 2.6rem;
  padding: 0 0.9rem;
  font-size: 0.88rem;
}

.chapters ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.88rem;
  line-height: 1.35;
  color: var(--text-muted);
}

.foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1.1rem 1rem;
  border-top: 1px solid var(--border);
}

.foot .btn {
  min-height: 3rem;
}

.glass-btn {
  border-color: var(--accent);
  color: var(--accent);
}

@media (max-width: 520px) {
  .facts {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.05rem;
  }

  .facts dd {
    margin-bottom: 0.4rem;
  }
}
</style>
