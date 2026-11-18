<script setup lang="ts">
import { CircleCheck, Info, RadioTower, TriangleAlert } from '@lucide/vue'
import { MODULES } from '~/utils/modules'
import type { MessageKey } from '~/locales/es'
import type { LibraryStatus } from '@survival-os/shared-types'
import { moduleSummaries, type LibrarySummaryInput } from '~/utils/summaries'

const t = useT()
const { status, alerts } = useDeviceStatus()
const { nav } = useNav()
const mapsCount = ref<number | null>(null)
const library = ref<LibrarySummaryInput | null>(null)

/**
 * Mapas y biblioteca tal como están en la carpeta de datos (también tras cambiarla o tras una descarga): se leen al
 * entrar y cada 15 s, porque el lector de libros arranca unos segundos después que la web.
 */
async function loadContent(): Promise<void> {
  const [maps, lib] = await Promise.all([
    $fetch<unknown[]>('/api/maps', { timeout: 5000, retry: 0 }).catch(() => null),
    $fetch<LibraryStatus>('/api/library/status', { timeout: 8000, retry: 0 }).catch(() => null),
  ])
  mapsCount.value = maps ? maps.length : null
  library.value = lib
    ? { served: lib.kiwix.state === 'ok' ? lib.kiwix.value.books : null, installed: lib.zim.installed.length, docs: lib.docs.count }
    : null
}
let contentTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadContent()
  contentTimer = setInterval(() => void loadContent(), 15_000)
})
onBeforeUnmount(() => contentTimer && clearInterval(contentTimer))

const summaries = computed(() => moduleSummaries(status.value, { nav: nav.value, maps: mapsCount.value, library: library.value }))

const publicView = isPublicView()
/** Columnas en horizontal según el número de módulos: 8 → 4×2, 6 → 3×2, 4 → 2×2 (sin filas cojas). */
const cols = computed(() => {
  const n = tiles.value.length
  return n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4
})

// Primera puesta en marcha (ADR 0015): si aún no se ha hecho ni omitido, se abre la bienvenida.
onMounted(async () => {
  if (publicView) return
  const ov = await $fetch<{ setup: { state: string } }>('/api/content', { timeout: 8000, retry: 0 }).catch(() => null)
  if (ov?.setup.state === 'pending') await navigateTo('/bienvenida')
})

const tiles = computed(() =>
  MODULES.filter((m) => !publicView || PUBLIC_MODULES.has(m.id)).map((m) => {
    // Vista pública: sin estado del equipo; resumen fijo de qué ofrece cada módulo.
    if (publicView) return { ...m, title: t(m.titleKey), summary: t(`ui.public.sum.${m.id}` as MessageKey), tone: 'info' as const }
    const s = summaries.value[m.id]
    return {
      ...m,
      title: t(m.titleKey),
      summary: s ? t(s.key, s.params) : null,
      tone: s?.tone ?? 'muted',
    }
  }),
)

const loading = computed(() => status.value === null && alerts.value.length === 0)
</script>

<template>
  <div class="home">
    <ContentProgress v-if="!publicView" />
    <div class="tiles" :style="{ '--cols': cols }">
      <ModuleTile
        v-for="tile in tiles"
        :key="tile.id"
        :to="tile.path"
        :title="tile.title"
        :icon="tile.icon"
        :summary="tile.summary"
        :tone="tile.tone"
      />
    </div>

    <section v-if="publicView" class="alerts public">
      <p class="alert tone-info">
        <RadioTower :size="18" aria-hidden="true" />
        <span>{{ t('ui.public.banner') }}</span>
      </p>
    </section>
    <section v-else class="alerts" :aria-label="t('home.alerts')">
      <p v-if="loading" class="alert tone-muted">
        <Info :size="18" aria-hidden="true" />
        <span>{{ t('home.loading') }}</span>
      </p>
      <p v-else-if="alerts.length === 0" class="alert tone-ok">
        <CircleCheck :size="18" aria-hidden="true" />
        <span>{{ t('home.alerts.none') }}</span>
      </p>
      <p v-for="alert in alerts" :key="alert.id" class="alert" :class="`tone-${alert.tone}`">
        <component :is="alert.tone === 'info' ? Info : TriangleAlert" :size="18" aria-hidden="true" />
        <span>{{ t(alert.key, alert.params) }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: 0.75rem max(0.875rem, calc((100% - var(--content-max)) / 2)) 0.75rem;
}

/*
 * Horizontal (portátil 16:10/16:9, panel de la Pi, monitor): cuadrícula fija que llena la pantalla
 * sin filas cojas. Vertical o estrecho (móvil, tablet en vertical): 2 columnas y desplazamiento.
 */
.tiles {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--gap);
  min-height: 0;
}

.home > :not(.tiles) {
  flex: none;
}

@media (max-aspect-ratio: 1/1), (max-width: 640px) {
  .home {
    overflow-y: auto;
  }

  /* Llenan el alto disponible (tablet en vertical) y, si no cabe, la página se desplaza. */
  .tiles {
    flex: 1 0 auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(9rem, 1fr);
  }
}

@media (max-width: 340px) {
  .tiles {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(7rem, auto);
  }
}

.alerts {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 6.2rem;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.alert {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.15rem 0;
  font-size: 0.9rem;
  color: var(--text);
}

.alert + .alert {
  border-top: 1px solid var(--hairline);
  padding-top: 0.35rem;
}

/* Icono en pastilla con el tono del aviso. */
.alert svg {
  flex: none;
  box-sizing: content-box;
  padding: 0.2rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}
</style>
