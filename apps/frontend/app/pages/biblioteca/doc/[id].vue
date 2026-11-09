<script setup lang="ts">
import { ArrowLeft, Moon, Sun } from '@lucide/vue'
import type { DocSummary } from '@survival-os/shared-types'

/**
 * Documento propio. El HTML generado (Markdown/TXT) se muestra en un iframe
 * `sandbox` sin scripts: aunque el documento sea hostil, no puede ejecutar nada.
 * Los PDF usan el visor integrado de Chromium.
 */
const t = useT()
const route = useRoute()
const router = useRouter()
const night = useState<boolean>('reader:night', () => false)

const id = computed(() => Number(route.params.id))
const doc = ref<(DocSummary & { html: string }) | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    doc.value = await $fetch<DocSummary & { html: string }>(`/api/library/docs/${id.value}`, { timeout: 15000, retry: 0 })
  } catch {
    error.value = t('lib.doc.notFound')
  }
})

const srcdoc = computed(() => {
  if (!doc.value || doc.value.kind === 'pdf') return ''
  const bg = night.value ? '#0f1412' : '#fbfaf6'
  const fg = night.value ? '#ece6d6' : '#1b1f1d'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    body{margin:0;padding:18px 22px 40px;background:${bg};color:${fg};font:18px/1.55 system-ui,sans-serif;max-width:860px}
    h2,h3,h4{line-height:1.25} pre{white-space:pre-wrap;font:16px/1.5 ui-monospace,monospace}
    blockquote{margin:0;padding:8px 14px;border-left:4px solid #e5b85c;background:rgba(229,184,92,.12)}
    a{color:inherit}
    html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:pan-x pan-y;overscroll-behavior:contain}
  </style></head><body>${doc.value.html}</body></html>`
})
</script>

<template>
  <div class="reader">
    <header class="bar">
      <button type="button" class="btn" @click="router.push('/biblioteca')">
        <ArrowLeft :size="20" aria-hidden="true" />
        {{ t('module.library') }}
      </button>
      <span class="title">{{ doc?.title ?? t('state.loading') }}</span>
      <FavoriteButton v-if="doc" :fav-id="`doc:${doc.id}`" :title="doc.title" :href="`/biblioteca/doc/${doc.id}`" />
      <button v-if="doc && doc.kind !== 'pdf'" type="button" class="btn" :aria-pressed="night" @click="night = !night">
        <component :is="night ? Sun : Moon" :size="20" aria-hidden="true" />
        {{ night ? t('lib.reader.day') : t('lib.reader.night') }}
      </button>
    </header>
    <div v-if="error" class="notice tone-danger">{{ error }}</div>
    <iframe v-else-if="doc?.kind === 'pdf'" :src="`/api/library/docs/${doc.id}/raw`" :title="doc.title" />
    <iframe v-else-if="doc" :srcdoc="srcdoc" sandbox="" :title="doc.title" />
  </div>
</template>

<style scoped>
.reader {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
</style>
