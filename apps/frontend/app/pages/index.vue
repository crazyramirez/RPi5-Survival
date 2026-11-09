<script setup lang="ts">
import { CircleCheck, Info, RadioTower, TriangleAlert } from '@lucide/vue'
import { MODULES } from '~/utils/modules'
import type { MessageKey } from '~/locales/es'
import { moduleSummaries } from '~/utils/summaries'

const t = useT()
const { status, alerts } = useDeviceStatus()
const { nav } = useNav()
const mapsCount = ref<number | null>(null)
onMounted(async () => {
  try {
    mapsCount.value = (await $fetch<unknown[]>('/api/maps', { timeout: 5000, retry: 0 })).length
  } catch {
    mapsCount.value = null
  }
})

const summaries = computed(() => moduleSummaries(status.value, { nav: nav.value, maps: mapsCount.value }))

const publicView = isPublicView()

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
    <div class="tiles">
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
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--gap);
  padding: 0.75rem 0.875rem 0.75rem;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--gap);
  min-height: 0;
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
