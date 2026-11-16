<script setup lang="ts">
import { ArrowLeft, Compass, Download, PartyPopper } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'
import { formatBytes } from '~/utils/format'

/**
 * Primera puesta en marcha (ADR 0015): igual en la Pi y en la versión portable. Ofrece descargar
 * todo lo recomendado (marcado por defecto, español primero) y avisa de que el sistema tardará en
 * estar listo al 100 %, mientras tanto se puede usar.
 */
const t = useT()
const { status } = useDeviceStatus()
const step = ref<'intro' | 'pick' | 'done'>('intro')
const ov = ref<ContentOverview | null>(null)
const catalog = ref<{ start: () => Promise<void>; selectedCount: number; selectedBytes: number; shortfall: number; running: boolean } | null>(null)
const busy = ref(false)

onMounted(async () => {
  ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => null)
})

/** Con red local hay salida probable a Internet; sin ella, las descargas no pueden empezar. */
const online = computed(() => status.value?.network.state === 'ok' && status.value.network.value.mode === 'local')

async function finish(state: 'completed' | 'skipped', selection: string[] = []): Promise<void> {
  await postAction('/api/content/setup', { state, selection }).catch(() => undefined)
}

async function startDownloads(): Promise<void> {
  if (!catalog.value) return
  busy.value = true
  try {
    await catalog.value.start()
  } finally {
    busy.value = false
  }
}

async function onStarted(items: string[]): Promise<void> {
  await finish('completed', items)
  step.value = 'done'
}

async function later(): Promise<void> {
  await finish('skipped')
  await navigateTo('/')
}
</script>

<template>
  <div class="page wizard">
    <!-- 1 · Bienvenida -->
    <section v-if="step === 'intro'" class="hero-card">
      <span class="orb" aria-hidden="true"><Compass :size="40" /></span>
      <h1>{{ t('setup.title') }}</h1>
      <p class="lead">{{ t('setup.lead') }}</p>
      <p>{{ t('setup.default') }}</p>
      <p v-if="ov" class="faint mono">{{ t('setup.where', { platform: ov.platform, free: ov.freeBytes != null ? formatBytes(ov.freeBytes) : '—' }) }}</p>
      <p v-if="!online" class="notice tone-warn">{{ t('setup.offline') }}</p>
      <div class="actions">
        <button type="button" class="btn" @click="later">{{ t('setup.later') }}</button>
        <button type="button" class="btn btn-primary big" @click="step = 'pick'">{{ t('setup.next') }}</button>
      </div>
      <p class="faint small">{{ t('setup.laterHint') }}</p>
    </section>

    <!-- 2 · Elegir contenidos (todo marcado por defecto) -->
    <template v-else-if="step === 'pick'">
      <header class="pick-head">
        <button type="button" class="btn" @click="step = 'intro'"><ArrowLeft :size="18" aria-hidden="true" />{{ t('setup.back') }}</button>
        <h1>{{ t('content.title') }}</h1>
      </header>
      <p class="muted">{{ t('content.intro') }}</p>
      <ContentCatalog ref="catalog" mode="wizard" :online="online" @started="onStarted" />
      <div class="sticky-actions">
        <button type="button" class="btn" @click="later">{{ t('setup.later') }}</button>
        <button
          type="button" class="btn btn-primary big"
          :disabled="busy || !online || !catalog || catalog.selectedCount === 0 || catalog.shortfall > 0 || catalog.running"
          @click="startDownloads"
        >
          <Download :size="20" aria-hidden="true" />
          {{ catalog ? t('content.download', { n: catalog.selectedCount, size: formatBytes(catalog.selectedBytes) }) : t('setup.start') }}
        </button>
      </div>
    </template>

    <!-- 3 · En marcha -->
    <section v-else class="hero-card">
      <span class="orb tone-ok" aria-hidden="true"><PartyPopper :size="40" /></span>
      <h1>{{ t('setup.doneTitle') }}</h1>
      <p class="lead">{{ t('setup.doneBody') }}</p>
      <p class="faint">{{ t('setup.doneHint') }}</p>
      <div class="actions">
        <NuxtLink to="/" class="btn btn-primary big">{{ t('setup.go') }}</NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wizard {
  max-width: 64rem;
  margin: 0 auto;
}

.hero-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  margin-top: 1.5rem;
  padding: 2rem 1.5rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface-grad);
  text-align: center;
}

.orb {
  display: grid;
  place-items: center;
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--accent) 70%, transparent);
}

.orb.tone-ok {
  color: var(--ok);
}

h1 {
  font-size: 1.6rem;
}

.lead {
  max-width: 44rem;
  font-size: 1.05rem;
  line-height: 1.5;
}

.actions,
.sticky-actions {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.5rem;
}

.sticky-actions {
  position: sticky;
  bottom: 0;
  justify-content: flex-end;
  padding: 0.7rem 0;
  background: linear-gradient(transparent, var(--bg) 35%);
}

.big {
  min-height: 3.4rem;
  padding: 0 1.4rem;
  font-size: 1.05rem;
}

.pick-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 0.5rem 0;
}

.pick-head h1 {
  font-size: 1.3rem;
}

.small {
  font-size: 0.85rem;
}
</style>
