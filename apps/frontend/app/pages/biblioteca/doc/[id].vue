<script setup lang="ts">
import { ArrowLeft, Moon, Sun } from '@lucide/vue'
import type { DocSummary } from '@survival-os/shared-types'

/**
 * Documento propio. El HTML generado (Markdown/TXT) se muestra en un iframe
 * `sandbox` sin scripts: aunque el documento sea hostil, no puede ejecutar nada.
 * Los PDF usan el visor propio (PdfViewer: pdf.js local, con los estilos de la app).
 */
const t = useT()
const route = useRoute()
const backTo = useBackTo()
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

/** Tamaño de letra (variable --fs del documento): se cambia sin recargar, conservando por dónde se lee. */
const { pct: fontPct } = useReaderFont()
const textFrame = ref<HTMLIFrameElement | null>(null)
function applyFont(): void {
  try {
    textFrame.value?.contentDocument?.documentElement.style.setProperty('--fs', String(fontPct.value / 100))
  } catch {
    // documento aún no cargado
  }
}
watch(fontPct, applyFont)

const srcdoc = computed(() => {
  if (!doc.value || doc.value.kind === 'pdf') return ''
  // Paleta del documento (día / noche) con el acento de la app.
  const c = night.value
    ? { bg: '#0f1412', fg: '#ece6d6', muted: '#a9b0a8', line: '#2a332e', soft: '#18201c', head: '#1d2622', accent: '#8cbf96' }
    : { bg: '#fbfaf6', fg: '#1b1f1d', muted: '#5b625d', line: '#e3e0d6', soft: '#f3f1ea', head: '#ebe8de', accent: '#3d7a4c' }
  // Ancho completo de la pantalla: márgenes y cuerpo de letra crecen con ella (Pi 1024 px → monitor 4K).
  return `<!doctype html><html lang="${locale.value}"><head><meta charset="utf-8"><style>
    html{background:${c.bg}}
    body{margin:0;padding:clamp(14px,2.2vw,40px) clamp(16px,3.5vw,72px) 48px;background:${c.bg};color:${c.fg};
      font:calc(clamp(17px,0.45vw + 13px,22px) * var(--fs,1))/1.6 system-ui,'Segoe UI',sans-serif;overflow-wrap:break-word}
    h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em;letter-spacing:-.01em}
    h2{font-size:1.45em;padding-bottom:.3em;border-bottom:2px solid ${c.accent}}
    h2:first-child{margin-top:0}
    h3{font-size:1.2em;color:${c.accent}} h4{font-size:1.05em}
    p,ul,ol{margin:.6em 0} li{margin:.25em 0} li::marker{color:${c.accent}}
    strong{font-weight:700}
    a{color:${c.accent};text-underline-offset:2px}
    code{font:.88em/1.5 ui-monospace,'Cascadia Mono',monospace;background:${c.soft};border:1px solid ${c.line};border-radius:5px;padding:.08em .35em}
    pre{margin:1em 0;padding:12px 16px;background:${c.soft};border:1px solid ${c.line};border-radius:10px;overflow-x:auto}
    pre code{background:none;border:0;padding:0;white-space:pre-wrap}
    blockquote{margin:1em 0;padding:10px 16px;border-left:4px solid #e5b85c;border-radius:0 10px 10px 0;background:rgba(229,184,92,.12)}
    .table{margin:1em 0;overflow-x:auto;border:1px solid ${c.line};border-radius:10px}
    table{width:100%;border-collapse:collapse;font-size:.92em}
    th,td{padding:10px 14px;text-align:left;vertical-align:top;border-bottom:1px solid ${c.line}}
    th{background:${c.head};font-weight:700;white-space:nowrap}
    tbody tr:nth-child(even) td{background:${c.soft}}
    tbody tr:last-child td{border-bottom:0}
    img{max-width:100%;height:auto;border-radius:8px}
    hr{border:0;border-top:1px solid ${c.line};margin:1.6em 0}
    ::selection{background:${c.accent};color:${c.bg}}
    html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:pan-x pan-y;overscroll-behavior:contain}
    pre,pre *{-webkit-user-select:text;user-select:text}
  </style></head><body>${doc.value.html}</body></html>`
})
</script>

<template>
  <div class="reader reading-host">
    <header class="bar reading-hide">
      <button type="button" class="btn" @click="backTo('/biblioteca')">
        <ArrowLeft :size="20" aria-hidden="true" />
        {{ t('module.library') }}
      </button>
      <span class="title">{{ doc?.title ?? t('state.loading') }}</span>
      <FavoriteButton v-if="doc" :fav-id="`doc:${doc.id}`" :title="doc.title" :href="`/biblioteca/doc/${doc.id}`" />
      <button v-if="doc && doc.kind !== 'pdf'" type="button" class="btn" :aria-pressed="night" @click="night = !night">
        <component :is="night ? Sun : Moon" :size="20" aria-hidden="true" />
        {{ night ? t('lib.reader.day') : t('lib.reader.night') }}
      </button>
      <ReaderFontControl v-if="doc && doc.kind !== 'pdf'" />
      <ReadingModeButton v-if="doc" />
    </header>
    <div v-if="error" class="notice tone-danger">{{ error }}</div>
    <PdfViewer v-else-if="doc?.kind === 'pdf'" :src="`/api/library/docs/${doc.id}/raw`" />
    <!-- Sin scripts (sandbox): aunque sea hostil no ejecuta nada. allow-same-origin solo deja a la app ajustar la letra. -->
    <iframe v-else-if="doc" ref="textFrame" :srcdoc="srcdoc" sandbox="allow-same-origin" :title="doc.title" @load="applyFont" />
    <ReaderFontControl v-if="doc && doc.kind !== 'pdf'" floating />
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
