<script setup lang="ts">
import { ArrowLeft, FileText, X } from '@lucide/vue'
import { isViewerPath, styleDocScrollbar } from '~/utils/viewer'

/**
 * Visor integrado (PDF y otros documentos del propio equipo): SIEMPRE dentro de la app, con barra para
 * volver. Nada se abre fuera (en el kiosco no hay barra del navegador: una ventana nueva dejaría al usuario
 * sin salida). Solo rutas locales de lista cerrada: Kiwix y documentos de la biblioteca.
 */
const t = useT()
const route = useRoute()
const router = useRouter()

/** Solo contenido servido por esta misma app (nunca URL externas). */
const src = computed(() => {
  const u = route.query.u
  return typeof u === 'string' && u.length <= 2000 && isViewerPath(u) ? u : null
})
const title = computed(() => (typeof route.query.t === 'string' && route.query.t.trim() ? route.query.t.slice(0, 200) : t('viewer.title')))

/** Páginas HTML locales (no PDF: el visor de PDF del navegador no admite estilos): barra de la app. */
function onLoad(e: Event): void {
  try {
    const doc = (e.target as HTMLIFrameElement).contentDocument
    const win = doc?.defaultView
    if (!doc?.body || !win) return
    const rgb = (win.getComputedStyle(doc.body).backgroundColor.match(/[\d.]+/g) ?? []).map(Number)
    const [r = 255, g = 255, b = 255, a = 1] = rgb
    styleDocScrollbar(doc, a < 0.5 || 0.2126 * r + 0.7152 * g + 0.0722 * b > 140)
  } catch {
    // Documento de otro origen o visor de PDF: se deja como está.
  }
}

function back(): void {
  if (window.history.length > 1) router.back()
  else void router.push('/biblioteca')
}
</script>

<template>
  <div class="viewer">
    <header class="bar">
      <button type="button" class="btn" @click="back">
        <ArrowLeft :size="20" aria-hidden="true" />
        {{ t('viewer.back') }}
      </button>
      <FileText :size="18" class="icon" aria-hidden="true" />
      <span class="title">{{ title }}</span>
      <NuxtLink to="/biblioteca" class="btn icon-only" :aria-label="t('viewer.close')"><X :size="20" aria-hidden="true" /></NuxtLink>
    </header>
    <!-- Solo contenido local (lista cerrada). Sin sandbox: Chromium bloquea su visor de PDF en iframes con sandbox. -->
    <iframe v-if="src" :src="src" :title="title" @load="onLoad" />
    <EmptyState v-else :icon="FileText" :title="t('viewer.invalid')">
      <NuxtLink to="/biblioteca" class="btn btn-primary">{{ t('module.library') }}</NuxtLink>
    </EmptyState>
  </div>
</template>

<style scoped>
.viewer {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem max(0.6rem, calc((100% - var(--content-max)) / 2));
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.icon {
  flex: none;
  color: var(--accent);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.icon-only {
  flex: none;
  min-width: var(--touch);
  justify-content: center;
}

iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
</style>
