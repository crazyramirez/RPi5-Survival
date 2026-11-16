<script setup lang="ts">
import { ArrowLeft, Compass, Download, Globe2, Languages, ListChecks, PartyPopper, Search } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'
import { searchCountries } from '~/composables/useRegion'
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

const region = useRegion()
const regionQuery = ref('')
const regionOpen = ref(false)
const regionResults = computed(() => searchCountries(region.countries.value ?? [], regionQuery.value, 6))
const DETECTED_BY = { position: 'maps.country.byPosition', lora: 'maps.country.byLora', timezone: 'maps.country.byTimezone', language: 'maps.country.byLanguage' } as const

onMounted(async () => {
  await region.load()
  // Primera vez: el idioma del equipo (navegador y zona horaria), una sola vez y solo si nadie lo eligió.
  try {
    if (!localStorage.getItem('survival-os:locale') && !sessionStorage.getItem('survival-os:lang-auto')) {
      sessionStorage.setItem('survival-os:lang-auto', '1')
      const lang = region.suggestedLanguage()
      if (lang !== locale.value) {
        setLocale(lang)
        return
      }
    }
  } catch {
    // sin almacenamiento: se queda el idioma actual
  }
  ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => null)
})

function pickRegion(id: string): void {
  region.choose(id)
  regionOpen.value = false
  regionQuery.value = ''
}

/** Con red local hay salida probable a Internet; sin ella, las descargas no pueden empezar. */
const online = computed(() => status.value?.network.state === 'ok' && status.value.network.value.mode === 'local')

let finished = false
async function finish(state: 'completed' | 'skipped', selection: string[] = []): Promise<void> {
  finished = true
  await postAction('/api/content/setup', { state, selection }).catch(() => undefined)
}

/**
 * Salir de la bienvenida por otro camino (Inicio, otro módulo) cuenta como «Más tarde»: si no, Inicio la vuelve a
 * abrir sola. Solo si aún estaba pendiente: abierta de nuevo desde Sistema, salir no cambia nada.
 */
onBeforeRouteLeave(async () => {
  if (finished) return
  const state = ov.value?.setup.state ?? (await $fetch<ContentOverview>('/api/content', { timeout: 5000, retry: 0 }).catch(() => null))?.setup.state
  if (state === 'pending') await finish('skipped')
})

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
  <div class="page wizard" :class="{ centered: step === 'intro' }">
    <!-- 1 · Bienvenida: una sola tarjeta que cabe sin desplazar en el panel de 1024×600. -->
    <section v-if="step === 'intro'" class="welcome">
      <div class="col intro-col">
        <!-- Lo primero, el idioma: cada uno con su nombre en su idioma. -->
        <div class="langs" role="group" :aria-label="t('setup.language')">
          <Languages :size="18" class="langs-icon" aria-hidden="true" />
          <button
            v-for="l in LOCALES" :key="l.code" type="button" class="lang" :lang="l.code"
            :aria-pressed="locale === l.code" @click="setLocale(l.code)"
          >
            {{ l.name }}
          </button>
        </div>
        <div class="brand">
          <span class="orb" aria-hidden="true"><Compass :size="30" /></span>
          <h1>{{ t('setup.title') }}</h1>
        </div>
        <p class="lead">{{ t('setup.lead') }}</p>
        <p class="muted small">{{ t('setup.default') }}</p>
        <p v-if="ov" class="faint mono small">{{ t('setup.where', { platform: ov.platform, free: ov.freeBytes != null ? formatBytes(ov.freeBytes) : '—' }) }}</p>
      </div>

      <div class="col action-col">
        <!-- País (detectado sin Internet; se puede cambiar): mapas, rutas y contenidos por defecto. -->
        <div class="region">
          <Globe2 :size="20" class="accent" aria-hidden="true" />
          <span class="grow">
            <small>{{ t('setup.region') }}</small>
            <strong>{{ region.country.value?.name ?? t('setup.regionNone') }}</strong>
            <small v-if="region.detection.value && region.detection.value.country.id === region.country.value?.id">{{ t(DETECTED_BY[region.detection.value.by]) }}</small>
          </span>
          <button type="button" class="btn small" :aria-expanded="regionOpen" @click="regionOpen = !regionOpen">{{ regionOpen ? t('common.cancel') : t('setup.regionChange') }}</button>
        </div>

        <!-- Mientras se elige país, el selector ocupa el sitio de la descarga (nunca hace falta desplazar). -->
        <div v-if="regionOpen" class="region-pick">
          <label class="search">
            <Search :size="18" aria-hidden="true" />
            <input v-model="regionQuery" type="search" class="ui-field" :placeholder="t('maps.country.search')" :aria-label="t('maps.country.search')" autocomplete="off" />
          </label>
          <div class="opts">
            <button v-for="c in regionResults" :key="c.id" type="button" class="btn small" @click="pickRegion(c.id)">{{ c.name }}</button>
          </div>
        </div>
        <template v-else>
          <p v-if="!online" class="notice tone-warn small">{{ t('setup.offline') }}</p>
          <!-- Un clic: todo lo del idioma y el país, ajustado al espacio (ADR 0018). -->
          <DownloadAllCard :online="online" compact no-confirm @started="onStarted" />
        </template>

        <div class="actions">
          <button type="button" class="btn" @click="step = 'pick'"><ListChecks :size="18" aria-hidden="true" />{{ t('setup.next') }}</button>
          <button type="button" class="btn" :title="t('setup.laterHint')" @click="later">{{ t('setup.later') }}</button>
        </div>
      </div>
    </section>

    <!-- 2 · Elegir contenidos (todo marcado por defecto) -->
    <template v-else-if="step === 'pick'">
      <header class="pick-head">
        <button type="button" class="btn" @click="step = 'intro'"><ArrowLeft :size="18" aria-hidden="true" />{{ t('setup.back') }}</button>
        <h1>{{ t('content.title') }}</h1>
      </header>
      <p class="muted">{{ t('content.intro') }}</p>
      <ContentCatalog ref="catalog" mode="wizard" :online="online" :country="region.country.value" @started="onStarted" />
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

.region {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: min(36rem, 100%);
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
}

.region .grow {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.region small {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.accent {
  color: var(--accent);
  flex: none;
}

.region-pick {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
  width: min(36rem, 100%);
}

.region-pick .search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding-left: 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
}

.region-pick input {
  flex: 1;
  border: 0;
  background: transparent;
}

.one-click {
  width: 100%;
  text-align: left;
}

.langs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.25rem;
  border: 1px solid var(--hairline);
  border-radius: 999px;
  background: var(--surface);
}

.langs-icon {
  margin: 0 0.3rem 0 0.5rem;
  color: var(--accent);
}

.lang {
  min-height: 2.5rem;
  padding: 0 0.95rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.lang[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-ink);
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

/* ------------------------------------------------------------ Bienvenida (una tarjeta, sin desplazar) */
.wizard.centered {
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 1.1rem 1.6rem;
  width: 100%;
  padding: 1.2rem 1.3rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  background:
    radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%),
    var(--surface-grad);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.35);
  animation: pop-in 0.18s ease-out;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
}

.intro-col {
  justify-content: center;
}

.action-col {
  justify-content: center;
  padding-left: 1.4rem;
  border-left: 1px solid var(--hairline);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.brand .orb {
  width: 3.4rem;
  height: 3.4rem;
  flex: none;
}

.brand h1 {
  font-size: 1.5rem;
  line-height: 1.15;
}

.welcome .lead {
  font-size: 1rem;
  line-height: 1.45;
}

.small {
  font-size: 0.85rem;
}

.welcome .langs {
  align-self: flex-start;
}

.welcome .region {
  width: 100%;
}

.welcome .actions {
  justify-content: flex-start;
  margin-top: 0;
}

.region-pick {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.region-pick .opts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

/* Pantallas estrechas (móvil): una columna; aquí sí se desplaza. */
@media (max-width: 52rem) {
  .wizard.centered {
    display: block;
  }

  .welcome {
    grid-template-columns: 1fr;
  }

  .action-col {
    padding-left: 0;
    border-left: 0;
    border-top: 1px solid var(--hairline);
    padding-top: 1rem;
  }
}
</style>
