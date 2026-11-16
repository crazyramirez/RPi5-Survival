<script setup lang="ts">
import { ArrowLeft, ArrowRight, Download, Globe2, ListChecks, PartyPopper, Search } from '@lucide/vue'
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
const { status } = useDeviceStatus()
const step = ref<'intro' | 'pick' | 'done'>('intro')
const ov = ref<ContentOverview | null>(null)
const catalog = ref<{ start: () => Promise<void>; selectedCount: number; selectedBytes: number; shortfall: number; running: boolean } | null>(null)
const busy = ref(false)

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
  <div class="welcome-screen" :class="`step-${step}`">
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
        <img src="/icon-192.png" alt="" class="app-icon" width="84" height="84" />
        <h1>{{ t('setup.title') }}</h1>
        <p class="lead">{{ t('setup.lead') }}</p>

        <!-- País (detectado sin Internet; se puede cambiar): mapas y rutas. -->
        <div v-if="!regionOpen" class="region">
          <Globe2 :size="18" aria-hidden="true" />
          <span>{{ region.country.value?.name ?? t('setup.regionNone') }}</span>
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
          <div class="secondary">
            <button type="button" class="btn glass" @click="step = 'pick'"><ListChecks :size="18" aria-hidden="true" />{{ t('setup.next') }}</button>
            <button type="button" class="btn glass" @click="later">{{ t('setup.later') }}<ArrowRight :size="18" aria-hidden="true" /></button>
          </div>
          <p class="foot">{{ t('setup.laterHint') }}</p>
        </template>
      </section>
    </div>

    <!-- 2 · Elegir contenidos (todo marcado por defecto) -->
    <div v-else-if="step === 'pick'" class="page pick">
      <header class="pick-head">
        <button type="button" class="btn glass" @click="step = 'intro'"><ArrowLeft :size="18" aria-hidden="true" />{{ t('setup.back') }}</button>
        <h1>{{ t('content.title') }}</h1>
      </header>
      <p class="muted">{{ t('content.intro') }}</p>
      <ContentCatalog ref="catalog" mode="wizard" :online="online" :country="region.country.value" @started="onStarted" />
      <div class="sticky-actions">
        <button type="button" class="btn glass" @click="later">{{ t('setup.later') }}</button>
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
  min-height: 2.4rem;
  padding: 0 0.95rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(243 239 228 / 0.7);
  font: inherit;
  font-size: 0.9rem;
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
  gap: 0.75rem;
  width: min(32rem, 100%);
  margin: auto 0;
  padding-block: 1rem;
  text-align: center;
  animation: rise 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.app-icon {
  width: clamp(3.6rem, 12vh, 5.2rem);
  height: auto;
  border-radius: 22%;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.06),
    0 0 60px color-mix(in srgb, var(--accent) 35%, transparent),
    0 12px 32px rgb(0 0 0 / 0.55);
}

h1 {
  margin: 0.2rem 0 0;
  font-size: clamp(1.5rem, 4.6vh, 2.1rem);
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.lead {
  margin: 0;
  max-width: 28rem;
  font-size: 1rem;
  line-height: 1.45;
  color: rgb(243 239 228 / 0.75);
}

.region {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.2rem 0 0.4rem;
  color: rgb(243 239 228 / 0.85);
  font-weight: 700;
}

.region svg {
  color: var(--accent);
}

.link-btn {
  min-height: 2.75rem;
  padding: 0 0.4rem;
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

/* Dos botones secundarios que ocupan el ancho del contenedor a partes iguales. */
.secondary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  width: 100%;
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
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
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

@media (max-width: 420px) {
  .secondary {
    grid-template-columns: minmax(0, 1fr);
  }
}

:root[data-contrast='high'] .bg,
:root[data-contrast='high'] .shade {
  display: none;
}
</style>
