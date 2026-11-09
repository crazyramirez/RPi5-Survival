<script setup lang="ts">
import { ArrowLeft, Printer } from '@lucide/vue'
import type { ProtocolDetail, ProtocolSummary } from '@survival-os/shared-types'
import '~/assets/css/print-guide.css'
import { formatDate } from '~/utils/format'

/**
 * Guía de emergencia en papel (Fase 7/8): todos los protocolos con su fuente y fecha de revisión.
 * En el kiosco, «Imprimir» abre el diálogo de Chromium, que permite «Guardar como PDF» en una memoria USB.
 * El mismo marcado y CSS los usa scripts/build-emergency-guide.mjs para generar el PDF en el PC.
 */
const t = useT()
const router = useRouter()
const size = ref<'a4' | 'a5'>('a5')
const protocols = ref<ProtocolDetail[] | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    const list = await $fetch<ProtocolSummary[]>('/api/library/protocols', { timeout: 8000, retry: 0 })
    protocols.value = await Promise.all(
      list.map((p) => $fetch<ProtocolDetail>(`/api/library/protocols/${p.id}`, { timeout: 8000, retry: 0 })),
    )
  } catch {
    failed.value = true
  }
})

/** Agrupados por categoría (en el orden en que aparecen) y numerados de forma continua. */
const groups = computed(() => {
  const map = new Map<string, ProtocolDetail[]>()
  for (const p of protocols.value ?? []) map.set(p.category, [...(map.get(p.category) ?? []), p])
  let n = 0
  return [...map.entries()].map(([category, items]) => ({ category, items: items.map((p) => ({ ...p, n: ++n })) }))
})
const ordered = computed(() => groups.value.flatMap((g) => g.items.map((p) => ({ ...p, category: g.category }))))
const today = formatDate(new Date())

useHead({
  style: [{ key: 'guide-page-size', innerHTML: computed(() => `@page { size: ${size.value.toUpperCase()} portrait; margin: 12mm 12mm 14mm; }`) }],
})

function print(): void {
  window.print()
}
</script>

<template>
  <div class="page print-page">
    <PageHeader :title="t('ui.print.title')" :icon="Printer" class="no-print">
      <div class="tools">
        <button type="button" class="btn" @click="router.push('/emergencias')"><ArrowLeft :size="18" /> {{ t('module.emergency') }}</button>
        <div class="seg" role="group" :aria-label="t('ui.print.size')">
          <button type="button" class="btn" :aria-pressed="size === 'a5'" @click="size = 'a5'">A5</button>
          <button type="button" class="btn" :aria-pressed="size === 'a4'" @click="size = 'a4'">A4</button>
        </div>
        <button type="button" class="btn btn-primary" :disabled="!protocols?.length" @click="print"><Printer :size="18" /> {{ t('ui.print.go') }}</button>
      </div>
    </PageHeader>
    <p class="hint no-print">{{ t('ui.print.hint') }}</p>
    <p v-if="failed" class="notice tone-danger no-print">{{ t('ui.print.failed') }}</p>
    <p v-else-if="!protocols" class="muted no-print">{{ t('state.loading') }}</p>

    <div v-if="protocols?.length" class="preview" :class="size">
      <div class="guide" :class="size">
        <!-- Portada -->
        <section class="sheet cover">
          <div>
            <div class="brand">{{ t('app.name') }}</div>
            <h1>{{ t('ui.print.cover') }}</h1>
            <p class="lead">{{ t('ui.print.lead') }}</p>
            <div class="call">
              <span class="num">112</span>
              <p><strong>{{ t('ui.print.callTitle') }}</strong>{{ t('ui.print.callBody') }}</p>
            </div>
            <p class="disclaimer">{{ t('em.disclaimer') }}</p>
          </div>
          <dl class="meta">
            <div><dt>{{ t('ui.print.generated') }}</dt><dd>{{ today }}</dd></div>
            <div><dt>{{ t('ui.em.count') }}</dt><dd>{{ ordered.length }}</dd></div>
            <div><dt>{{ t('ui.em.categories') }}</dt><dd>{{ groups.length }}</dd></div>
          </dl>
        </section>

        <!-- Índice -->
        <section class="sheet toc">
          <h2 class="section">{{ t('ui.print.toc') }}</h2>
          <template v-for="g in groups" :key="g.category">
            <p class="toc-cat">{{ g.category }}</p>
            <ol>
              <li v-for="p in g.items" :key="p.id"><span class="n">{{ p.n }}</span><span>{{ p.title }}</span></li>
            </ol>
          </template>
        </section>

        <!-- Protocolos -->
        <section v-for="p in ordered" :key="p.id" class="sheet proto">
          <header class="p-head">
            <span class="p-num">{{ p.n }}</span>
            <div>
              <div class="p-cat">{{ p.category }}</div>
              <h3>{{ p.title }}</h3>
            </div>
            <span class="p-112">112</span>
          </header>
          <!-- HTML del renderizador seguro del servicio (contenido versionado de la release). -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="content" v-html="p.html" />
          <footer class="p-foot">
            <b>{{ t('ui.print.source') }}</b> {{ p.sources }} · <b>{{ t('ui.print.reviewed') }}</b> {{ p.reviewed }}
          </footer>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.seg {
  display: flex;
  gap: 0.3rem;
}

.seg .btn[aria-pressed='true'] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}

.hint {
  margin: -0.2rem 0 0.8rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

/* Vista previa: hojas blancas sobre el fondo oscuro de la app. */
.preview {
  display: flex;
  justify-content: center;
  padding-bottom: 1rem;
}

.preview .guide {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(210mm, 100%);
}

.preview .guide.a5 {
  width: min(148mm, 100%);
}

.preview .sheet {
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 40%), 0 6px 18px rgb(0 0 0 / 35%);
}
</style>
