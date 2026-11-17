<script setup lang="ts">
import { ArrowLeft, ArrowRight, CloudDownload, Download, Globe2, ListChecks, PartyPopper, Search, Siren, X } from '@lucide/vue'
import type { ContentOverview } from '@survival-os/shared-types'
import { searchCountries } from '~/composables/useRegion'
import { formatBytes } from '~/utils/format'

/**
 * Primera puesta en marcha (ADR 0015): igual en la Pi y en la versión portable. Ofrece descargar
 * todo lo recomendado (marcado por defecto, español primero) y avisa de que el sistema tardará en
 * estar listo al 100 %, mientras tanto se puede usar.
 */
// Pantalla completa, sin barra de estado ni barra de acciones: la bienvenida guía por sí misma.
definePageMeta({ layout: 'bare' })

const t = useT()
const route = useRoute()
const backTo = useBackTo()
const { status } = useDeviceStatus()
const step = ref<'intro' | 'pick' | 'done'>('intro')
const ov = ref<ContentOverview | null>(null)
const catalog = ref<{ start: () => Promise<void>; selectedCount: number; selectedBytes: number; shortfall: number; running: boolean } | null>(null)
const busy = ref(false)
/** Guías de emergencia que trae la app (sin descargar nada). Sin dato, el texto no da cifra. */
const guideCount = ref<number | null>(null)

const region = useRegion()
const regionQuery = ref('')
const regionOpen = ref(false)
const regionResults = computed(() => searchCountries(region.countries.value ?? [], regionQuery.value, 6))

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
  void $fetch<unknown[]>('/api/library/protocols', { timeout: 8000, retry: 0 })
    .then((list) => (guideCount.value = Array.isArray(list) && list.length ? list.length : null))
    .catch(() => undefined)
  ov.value = await $fetch<ContentOverview>('/api/content', { timeout: 10_000, retry: 0 }).catch(() => null)
})

function pickRegion(id: string): void {
  region.choose(id)
  regionOpen.value = false
  regionQuery.value = ''
}

/**
 * Abierta de nuevo (desde Sistema, o con la primera puesta en marcha ya hecha u omitida): botón «Cerrar» arriba a la
 * izquierda y Esc, que vuelven a donde se estaba. La primera vez no se ofrece: la bienvenida guía por sí misma.
 */
const fromSystem = computed(() => route.query.desde === 'sistema')
const reopened = computed(() => fromSystem.value || (!!ov.value && ov.value.setup.state !== 'pending'))
function close(): void {
  backTo(fromSystem.value ? '/sistema' : '/')
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && reopened.value && !regionOpen.value) close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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

/** Sin descargar: la bienvenida queda como saltada y se abren las guías de emergencia que trae la app. */
async function openGuides(): Promise<void> {
  await finish('skipped')
  await navigateTo('/emergencias')
}
</script>

<template>
  <div class="welcome-screen" :class="[`step-${step}`, { reopened }]">
    <button v-if="reopened" type="button" class="btn glass close" :aria-label="t('setup.closeLabel')" @click="close">
      <X :size="22" aria-hidden="true" />{{ t('setup.close') }}
    </button>
    <img class="bg" src="/backgrounds/welcome-topo.webp" alt="" aria-hidden="true" decoding="async" draggable="false" />
    <div class="shade" aria-hidden="true" />

    <!-- 1 · Bienvenida: pantalla completa, sin barras; solo lo esencial. -->
    <div v-if="step === 'intro'" class="page stage">
      <div class="langs" role="group" :aria-label="t('setup.language')">
        <button
          v-for="l in LOCALES" :key="l.code" type="button" class="lang" :lang="l.code"
          :aria-pressed="locale === l.code" @click="setLocale(l.code)"
        >
          {{ l.name }}
        </button>
      </div>

      <section class="hero">
        <header class="intro">
          <img src="/icon-192.png" alt="" class="app-icon" width="84" height="84" />
          <h1>{{ t('setup.title') }}</h1>
          <p class="lead">{{ t('setup.lead') }}</p>
        </header>

        <!-- Dos caminos: preparar el equipo descargando (verde) o usar ya lo que trae (naranja). -->
        <div class="paths">
          <section class="path path-dl" :aria-labelledby="'dl-title'">
            <p class="eyebrow"><CloudDownload :size="16" aria-hidden="true" />{{ t('setup.dl.eyebrow') }}</p>
            <h2 id="dl-title">{{ t('setup.dl.title') }}</h2>
            <p class="path-body">{{ t('setup.dl.body') }}</p>

            <!-- País (detectado sin Internet; se puede cambiar): decide los mapas y las rutas. -->
            <div v-if="!regionOpen" class="region">
              <Globe2 :size="16" aria-hidden="true" />
              <span>{{ t('setup.dl.mapsOf') }} <strong>{{ region.country.value?.name ?? t('setup.regionNone') }}</strong></span>
              <button type="button" class="link-btn" @click="regionOpen = true">{{ t('setup.regionChange') }}</button>
            </div>
            <div v-else class="region-pick">
              <label class="search">
                <Search :size="18" aria-hidden="true" />
                <input v-model="regionQuery" type="search" class="ui-field" :placeholder="t('maps.country.search')" :aria-label="t('maps.country.search')" autocomplete="off" />
              </label>
              <div class="opts">
                <button v-for="c in regionResults" :key="c.id" type="button" class="btn glass" @click="pickRegion(c.id)">{{ c.name }}</button>
                <button type="button" class="btn ghost" @click="regionOpen = false">{{ t('common.cancel') }}</button>
              </div>
            </div>

            <template v-if="!regionOpen">
              <!-- Un toque: todo lo del idioma y el país, ajustado al espacio (ADR 0018). -->
              <DownloadAllCard :online="online" hero no-confirm @started="onStarted" />
              <button type="button" class="btn glass choose" @click="step = 'pick'">
                <ListChecks :size="18" aria-hidden="true" />{{ t('setup.next') }}<ArrowRight :size="16" aria-hidden="true" class="push" />
              </button>
            </template>
          </section>

          <div class="or" aria-hidden="true"><span>{{ t('setup.or') }}</span></div>

          <section class="path path-guides" :aria-labelledby="'guides-title'">
            <p class="eyebrow"><Siren :size="16" aria-hidden="true" />{{ t('setup.guides.eyebrow') }}</p>
            <h2 id="guides-title">{{ t('setup.guides.title') }}</h2>
            <p class="path-body">{{ guideCount ? t('setup.guides.body', { n: guideCount }) : t('setup.guides.bodyNoCount') }}</p>
            <button type="button" class="btn guides-go" @click="openGuides">
              {{ t('setup.guides.go') }}<ArrowRight :size="18" aria-hidden="true" />
            </button>
            <p class="foot">{{ t('setup.laterHint') }}</p>
          </section>
        </div>
      </section>
    </div>

    <!-- 2 · Elegir contenidos: nada marcado; «Seleccionar todo» o lo destacado de lo que interesa -->
    <div v-else-if="step === 'pick'" class="page pick">
      <header class="pick-head">
        <button type="button" class="btn glass" @click="step = 'intro'"><ArrowLeft :size="18" aria-hidden="true" />{{ t('setup.back') }}</button>
        <h1>{{ t('content.title') }}</h1>
      </header>
      <p class="muted">{{ t('content.intro') }}</p>
      <ContentCatalog ref="catalog" mode="wizard" :online="online" :country="region.country.value" @started="onStarted" />
      <div class="sticky-actions">
        <button type="button" class="btn glass" @click="openGuides">{{ t('setup.guides.short') }}</button>
        <button
          type="button" class="btn btn-primary big"
          :disabled="busy || !online || !catalog || catalog.selectedCount === 0 || catalog.shortfall > 0 || catalog.running"
          @click="startDownloads"
        >
          <Download :size="20" aria-hidden="true" />
          {{ catalog ? t('content.download', { n: catalog.selectedCount, size: formatBytes(catalog.selectedBytes) }) : t('setup.start') }}
        </button>
      </div>
    </div>

    <!-- 3 · En marcha -->
    <div v-else class="page stage">
      <section class="hero">
        <span class="done-orb" aria-hidden="true"><PartyPopper :size="40" /></span>
        <h1>{{ t('setup.doneTitle') }}</h1>
        <p class="lead">{{ t('setup.doneBody') }}</p>
        <NuxtLink to="/" class="btn btn-primary hero-go">{{ t('setup.go') }}<ArrowRight :size="20" aria-hidden="true" /></NuxtLink>
        <p class="foot">{{ t('setup.doneHint') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.welcome-screen {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #070a09;
  color: #f3efe4;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  animation: settle 1.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.shade {
  position: absolute;
  inset: 0;
  background: radial-gradient(60% 70% at 50% 50%, rgb(7 10 9 / 0.5), rgb(7 10 9 / 0.88));
}

.step-pick .bg,
.step-pick .shade {
  opacity: 0.35;
}

.page {
  position: relative;
}

/* ------------------------------------------------------------ Bienvenida y «en marcha» */
.stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(0.8rem, 3vh, 1.6rem) 1rem;
}

.langs {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 999px;
  background: rgb(14 20 17 / 0.5);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.lang {
  min-height: 2.2rem;
  padding: 0 0.8rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(243 239 228 / 0.7);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.lang[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-ink);
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(0.8rem, 3vh, 1.6rem);
  width: min(58rem, 100%);
  margin: auto 0;
  padding-block: 0.8rem;
  text-align: center;
  animation: rise 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Presentación: icono, título (lo más grande de la pantalla) y una línea de contexto, discreta. */
.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.app-icon {
  width: clamp(3rem, 10vh, 4.4rem);
  height: auto;
  border-radius: 22%;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.06),
    0 0 50px color-mix(in srgb, var(--accent) 30%, transparent),
    0 12px 32px rgb(0 0 0 / 0.55);
}

h1 {
  margin: 0.2rem 0 0;
  font-size: clamp(1.6rem, 5.2vh, 2.4rem);
  line-height: 1.1;
  letter-spacing: -0.015em;
}

.lead {
  margin: 0;
  max-width: 34rem;
  font-size: 0.95rem;
  line-height: 1.45;
  color: rgb(243 239 228 / 0.62);
}

/* ---------------------------------------------------- Los dos caminos */
.paths {
  --orange: #f0904a;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) auto minmax(0, 1fr);
  align-items: stretch;
  gap: 0.9rem;
  width: 100%;
  text-align: left;
}

.path {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 1rem 1.1rem 1.1rem;
  border-radius: var(--radius-lg);
  border: 1px solid rgb(255 255 255 / 0.12);
  background: rgb(14 20 17 / 0.62);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.35);
}

.path-dl {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background:
    radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 65%),
    rgb(14 20 17 / 0.62);
}

.path-guides {
  border-color: color-mix(in srgb, var(--orange) 45%, transparent);
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--orange) 14%, transparent), transparent 65%),
    rgb(14 20 17 / 0.62);
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.path-guides .eyebrow {
  color: var(--orange);
}

.path h2 {
  margin: 0;
  font-size: 1.2rem;
  line-height: 1.2;
  color: #f3efe4;
}

.path-body {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: rgb(243 239 228 / 0.72);
}

.path-dl :deep(.hero-cta) {
  width: 100%;
}

.choose {
  justify-content: flex-start;
  min-height: 2.9rem;
  gap: 0.55rem;
}

.choose .push {
  margin-left: auto;
  opacity: 0.6;
}

/* Botón naranja: el contraste con el verde dice «esto es otra cosa», sin competir con «Descargarlo todo». */
.guides-go {
  justify-content: space-between;
  gap: 0.6rem;
  min-height: 3.4rem;
  margin-top: auto;
  padding: 0 1.1rem;
  border: 1px solid var(--orange);
  border-radius: 999px;
  background: color-mix(in srgb, var(--orange) 18%, transparent);
  color: #ffd9bd;
  font-size: 1.02rem;
  font-weight: 800;
}

.guides-go:hover,
.guides-go:focus-visible {
  background: var(--orange);
  color: #1c0f05;
}

.or {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: rgb(243 239 228 / 0.45);
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.or span {
  display: grid;
  place-items: center;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.4rem;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 999px;
  background: rgb(14 20 17 / 0.8);
  color: rgb(243 239 228 / 0.7);
}

.or::before,
.or::after {
  content: '';
  flex: 1;
  width: 1px;
  background: rgb(255 255 255 / 0.14);
}

.region {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: rgb(243 239 228 / 0.8);
  font-size: 0.9rem;
}

.region strong {
  color: #f3efe4;
}

.region svg {
  flex: none;
  color: var(--accent);
}

.link-btn {
  min-height: 2.4rem;
  padding: 0 0.3rem;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.region-pick {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.region-pick .search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-left: 0.8rem;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: var(--radius);
  background: rgb(14 20 17 / 0.6);
  color: var(--text-muted);
}

.region-pick input {
  flex: 1;
  border: 0;
  background: transparent;
}

.region-pick .opts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

/* «Cerrar» (bienvenida abierta de nuevo): siempre arriba a la izquierda, por encima del contenido que se desplaza. */
.close {
  position: fixed;
  top: max(0.75rem, env(safe-area-inset-top));
  left: max(0.75rem, env(safe-area-inset-left));
  z-index: 20;
  gap: 0.45rem;
  min-height: 3.2rem;
  padding: 0 1.1rem 0 0.85rem;
  font-size: 1rem;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}

/* Paso de elegir contenidos: su cabecera baja para no quedar debajo de «Cerrar». */
.reopened .pick {
  padding-top: 3.8rem;
}

.glass {
  justify-content: center;
  min-height: 3.2rem;
  border-color: rgb(255 255 255 / 0.14);
  background: rgb(14 20 17 / 0.55);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  color: #f3efe4;
}

.ghost {
  background: transparent;
}

.foot {
  margin: 0.1rem 0 0;
  font-size: 0.76rem;
  line-height: 1.35;
  color: rgb(243 239 228 / 0.5);
}

.done-orb {
  display: grid;
  place-items: center;
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 16%, transparent);
  box-shadow: 0 0 60px color-mix(in srgb, var(--ok) 30%, transparent);
}

.hero-go {
  gap: 0.6rem;
  min-height: 3.6rem;
  padding: 0 2rem;
  border-radius: 999px;
  font-size: 1.1rem;
  text-decoration: none;
}

/* ------------------------------------------------------------ Elegir contenidos */
.pick {
  max-width: 64rem;
  margin: 0 auto;
}

.pick-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 0.5rem 0;
}

.pick-head h1 {
  margin: 0;
  font-size: 1.3rem;
}

.sticky-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.7rem;
  padding: 0.7rem 0;
  background: linear-gradient(transparent, #070a09 35%);
}

.big {
  min-height: 3.4rem;
  padding: 0 1.4rem;
  font-size: 1.05rem;
}

@keyframes settle {
  from {
    opacity: 0;
    transform: scale(1.05);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg,
  .hero {
    animation: none;
  }
}

/* Estrecho (móvil, tablet vertical): un camino debajo del otro, con «o» en horizontal. */
@media (max-width: 760px) {
  /* Móvil: los idiomas bajan para no quedar debajo de «Cerrar». */
  .reopened .stage {
    padding-top: 4.4rem;
  }

  .paths {
    grid-template-columns: minmax(0, 1fr);
  }

  .or {
    flex-direction: row;
  }

  .or::before,
  .or::after {
    width: auto;
    height: 1px;
  }
}

:root[data-contrast='high'] .paths {
  --orange: var(--warn);
}

:root[data-contrast='high'] .bg,
:root[data-contrast='high'] .shade {
  display: none;
}
</style>
