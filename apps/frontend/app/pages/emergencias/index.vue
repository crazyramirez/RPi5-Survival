<script setup lang="ts">
import {
  ArrowRight, BookOpen, Brain, ChevronRight, CloudSun, Cross, Droplet, FlaskConical, Hand, Heart, HeartPulse,
  LifeBuoy, Phone, Printer, ShieldAlert, Siren,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { MessageKey } from '~/locales/es'
import type { ProtocolSummary } from '@survival-os/shared-types'
import type { GuideCategoryLook, GuideEntry, GuideOverview } from '~/utils/guides'

definePageMeta({ guideCatalog: true })

const t = useT()
const protocols = ref<ProtocolSummary[] | null>(null)
const error = ref(false)
// Recuperar la búsqueda y el tema al volver de una ficha.
const query = useState<string>('emergency:query', () => '')
const category = useState<string | null>('emergency:category', () => null)

async function load(): Promise<void> {
  error.value = false
  try {
    protocols.value = await $fetch<ProtocolSummary[]>('/api/library/protocols', { timeout: 8000, retry: 0 })
  } catch {
    error.value = true
  }
}
onMounted(load)

const byId = computed(() => new Map((protocols.value ?? []).map((protocol) => [protocol.id, protocol])))
const entries = computed<GuideEntry[]>(() => (protocols.value ?? []).map((protocol) => ({
  id: protocol.id,
  title: protocol.title,
  overviewTitle: protocol.id === 'pas-112'
    ? [t('em.pas.p'), t('em.pas.a'), t('em.pas.s')].join(', ')
    : protocol.id === 'convulsiones' ? protocol.title.split(' (')[0] : undefined,
  category: protocol.category,
  href: `/emergencias/${protocol.id}`,
})))

/** Solo esta página conoce el 112 y los accesos sanitarios. El catálogo admite cualquier temática. */
const SHORTCUTS: { id: string; icon: Component }[] = [
  { id: 'rcp-adulto', icon: HeartPulse },
  { id: 'hemorragia', icon: Droplet },
  { id: 'atragantamiento', icon: Hand },
  { id: 'ictus', icon: Brain },
  { id: 'dolor-toracico', icon: Heart },
  { id: 'anafilaxia', icon: Cross },
]
const shortcuts = computed(() => SHORTCUTS.flatMap((shortcut) => {
  const protocol = byId.value.get(shortcut.id)
  return protocol ? [{ ...shortcut, title: t(`em.catalog.shortcut.${shortcut.id}` as MessageKey), fullTitle: protocol.title }] : []
}))
const pas = computed(() => byId.value.get('pas-112'))
const overview = computed<Record<string, GuideOverview>>(() => {
  const value: Record<string, GuideOverview> = {}
  if (pas.value) value[pas.value.category] = {
    ids: ['pas-112', 'quemaduras', 'rcp-ninos-lactantes', 'convulsiones', 'dea', 'fracturas-esguinces', 'posicion-lateral-seguridad', 'heridas'],
    label: t('em.catalog.allFirstAid'),
  }
  const climate = byId.value.get('hipotermia')
  if (climate) value[climate.category] = { ids: ['hipotermia', 'golpe-calor'] }
  return value
})
// Los ids son comunes a los cuatro idiomas. Un tema nuevo usa un libro y el acento neutro.
const categoryLooks = computed<Record<string, GuideCategoryLook>>(() => {
  const looks: Record<string, GuideCategoryLook> = {}
  const representatives: [string, Component, string][] = [
    ['pas-112', Heart, 'var(--danger)'],
    ['hipotermia', CloudSun, 'var(--warn)'],
    ['agua-potable', Droplet, 'var(--info)'],
    ['intoxicaciones', FlaskConical, 'var(--guide-violet)'],
    ['terremoto', Siren, 'var(--warn)'],
  ]
  for (const protocol of protocols.value ?? []) looks[protocol.category] = { icon: BookOpen, color: 'var(--accent)' }
  for (const [id, icon, color] of representatives) {
    const protocol = byId.value.get(id)
    if (protocol) looks[protocol.category] = { icon, color }
  }
  return looks
})
</script>

<template>
  <div class="page emergency">
    <header class="emergency-header">
      <div class="emergency-title"><LifeBuoy :size="48" aria-hidden="true" /><h1>{{ t('module.emergency') }}</h1></div>
      <p class="emergency-subtitle">{{ t('em.catalog.subtitle') }}</p>
      <NuxtLink to="/emergencias/imprimir" class="btn emergency-print"><Printer :size="20" aria-hidden="true" />{{ t('ui.print.open') }}</NuxtLink>
      <!-- Informativo: la Raspberry Pi no realiza llamadas. Se ve también si falla la biblioteca. -->
      <div class="emergency-phone" role="note" :aria-label="`${t('em.call')}: ${t('em.call.number')}`">
        <Phone :size="40" aria-hidden="true" />
        <div><span>{{ t('em.call') }}</span><strong class="mono">{{ t('em.call.number') }}</strong></div>
      </div>
    </header>

    <div v-if="error" class="notice tone-danger emergency-error" role="alert">
      <p>{{ t('lib.serviceDown') }}</p><button type="button" class="btn" @click="load">{{ t('guides.retry') }}</button>
    </div>
    <p v-else-if="!protocols" class="muted" role="status">{{ t('state.loading') }}</p>
    <p v-else-if="!protocols.length" class="muted" role="status">{{ t('em.protocols.none') }}</p>

    <GuideCatalog
      v-else v-model:query="query" v-model:category="category" :items="entries" :category-looks="categoryLooks" :overview="overview"
      :title="t('em.catalog.all')" :search-label="t('ui.em.search')"
    >
      <template #sidebar>
        <NuxtLink v-if="pas" :to="`/emergencias/${pas.id}`" class="emergency-pas">
          <h2>{{ t('em.catalog.pas') }}</h2>
          <ol><li>{{ t('em.pas.p') }}</li><li>{{ t('em.pas.a') }}</li><li>{{ t('em.pas.s') }}</li></ol>
          <span>{{ t('em.catalog.pasOpen') }}<ArrowRight :size="18" aria-hidden="true" /></span>
        </NuxtLink>
      </template>
      <template #featured>
        <section v-if="shortcuts.length" class="emergency-featured" aria-labelledby="emergency-shortcuts">
          <header><h2 id="emergency-shortcuts">{{ t('em.catalog.shortcuts') }}</h2><p>{{ t('em.catalog.shortcutsHint') }}</p></header>
          <div class="emergency-shortcuts">
            <NuxtLink
              v-for="shortcut in shortcuts" :key="shortcut.id" :to="`/emergencias/${shortcut.id}`"
              :aria-label="shortcut.fullTitle" class="emergency-shortcut" :class="{ 'emergency-primary': shortcut.id === 'rcp-adulto' }"
            >
              <component :is="shortcut.icon" :size="42" aria-hidden="true" />
              <strong>{{ shortcut.title }}</strong><ChevronRight :size="26" aria-hidden="true" />
            </NuxtLink>
          </div>
        </section>
      </template>
    </GuideCatalog>
    <p class="emergency-disclaimer"><ShieldAlert :size="22" aria-hidden="true" /><span>{{ t('em.disclaimer') }}</span></p>
  </div>
</template>

<style scoped>
.emergency {
  --guide-violet: #b9a3e8;
  --emergency-accent: color-mix(in srgb, var(--danger) 65%, #ff9485);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0 0 12px;
}
.emergency-header {
  display: flex;
  align-items: center;
  flex: none;
  gap: 1.2rem;
  min-height: 90px;
  padding: 0.3rem 1.1rem;
  border-bottom: 1px solid var(--border);
}
.emergency-title { display: flex; align-items: center; gap: 1.1rem; flex: none; }
.emergency-title > svg { flex: none; color: var(--accent); }
.emergency-title h1 { font-size: 2.25rem; line-height: 1.1; }
.emergency-subtitle { padding-left: 1.2rem; border-left: 1px solid var(--text-muted); color: var(--text-muted); font-size: 1rem; }
.emergency-print { flex: none; min-height: 2.7rem; margin-left: auto; padding: 0 1.1rem; border-color: var(--guide-border); font-size: 1.1rem; }
.emergency-phone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  flex: none;
  min-width: 15.5rem;
  min-height: 3.3rem;
  padding: 0.2rem 0.8rem;
  border: 1px solid var(--emergency-accent);
  border-radius: 0.65rem;
  background: linear-gradient(110deg, color-mix(in srgb, var(--danger) 10%, var(--surface)), var(--surface));
}
.emergency-phone > svg, .emergency-phone span { color: var(--emergency-accent); }
.emergency-phone span { display: block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.015em; }
.emergency-phone strong { display: block; font-size: 1.8rem; font-family: var(--font-ui); font-weight: 700; line-height: 1; }
.emergency-pas {
  display: block;
  padding: 0.75rem 1.1rem 0.5rem;
  border: 1px solid var(--guide-border);
  border-radius: 0.85rem;
  background: var(--surface-grad);
  color: var(--text);
  text-decoration: none;
}
.emergency-pas h2 { font-size: 1.2rem; line-height: 1.2; }
.emergency-pas ol { display: grid; gap: 0.35rem; margin: 0.8rem 0 0.9rem; padding: 0; list-style: none; counter-reset: pas; }
.emergency-pas li { display: flex; align-items: center; gap: 0.75rem; font-size: 1.2rem; counter-increment: pas; }
.emergency-pas li::before {
  content: counter(pas);
  display: grid; place-items: center; flex: none; width: 1.6rem; height: 1.6rem;
  border: 2px solid var(--emergency-accent); border-radius: 50%;
  color: var(--emergency-accent); font-size: 1rem; font-family: var(--font-mono);
}
.emergency-pas > span { display: flex; align-items: center; gap: 0.6rem; min-height: 44px; border-top: 1px solid var(--guide-border); color: var(--accent); font-size: 1rem; }
.emergency-featured { margin-bottom: 0.8rem; }
.emergency-featured header { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem 1.1rem; margin-bottom: 0.55rem; }
.emergency-featured h2 { font-size: 1.65rem; line-height: 1.2; }
.emergency-featured header p { padding-left: 1.1rem; border-left: 1px solid var(--text-muted); color: var(--text-muted); font-size: 1rem; }
.emergency-shortcuts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.65rem; }
.emergency-shortcut {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 4.15rem;
  min-width: 0;
  padding: 0.7rem 1rem;
  border: 1px solid var(--guide-border);
  border-radius: 0.65rem;
  background: var(--surface-grad);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 5%, transparent);
  color: var(--text);
  text-decoration: none;
}
.emergency-shortcut > svg { flex: none; color: var(--emergency-accent); }
.emergency-shortcut > svg:last-child { margin-left: auto; color: var(--text-muted); }
.emergency-shortcut strong { font-size: clamp(1rem, 1.82vw, 1.4rem); line-height: 1.15; overflow-wrap: anywhere; }
.emergency-primary { border: 2px solid var(--emergency-accent); background: linear-gradient(110deg, color-mix(in srgb, var(--emergency-accent) 28%, var(--surface)), color-mix(in srgb, var(--danger) 17%, var(--surface))); }
.emergency-shortcut:hover { border-color: var(--emergency-accent); background: color-mix(in srgb, var(--danger) 16%, var(--surface)); }
.emergency-disclaimer {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  gap: 0.7rem;
  min-height: 44px;
  margin: 20px 18px 0;
  padding: 0.35rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--warn) 72%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn) 9%, var(--surface));
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.25;
}
.emergency-disclaimer > svg { flex: none; color: var(--warn); }
.emergency-error { display: grid; justify-items: start; align-content: start; flex: 1; min-height: 0; overflow-y: auto; gap: 0.7rem; margin: 0.75rem; }
.emergency > p.muted { flex: 1; margin: 0.75rem; }
@media (max-width: 1300px) {
  .emergency-subtitle { display: none; }
}
@media (max-width: 1150px), (max-height: 700px) {
  .emergency { padding-bottom: 0.3rem; }
  .emergency-header { min-height: 60px; padding: 0.4rem 0.7rem; gap: 0.6rem; }
  .emergency-title { gap: 0.55rem; }
  .emergency-title > svg { width: 28px; height: 28px; }
  .emergency-title h1 { font-size: 1.5rem; }
  .emergency-print { min-height: var(--touch); padding-inline: 0.85rem; font-size: 1rem; }
  .emergency-phone { min-width: 0; min-height: var(--touch); padding: 0.3rem 0.65rem; gap: 0.55rem; }
  .emergency-phone > svg { width: 26px; height: 26px; }
  .emergency-phone span { display: none; }
  .emergency-phone strong { font-size: 1.7rem; }
  .emergency-featured { margin-bottom: 0.75rem; }
  .emergency-featured header { gap: 0.3rem; margin-bottom: 0.45rem; }
  .emergency-featured h2 { font-size: 1.25rem; }
  .emergency-featured header p { padding-left: 0; border-left: 0; font-size: 0.8rem; }
  .emergency-shortcuts { gap: 0.5rem; }
  .emergency-shortcut { min-height: 4.5rem; padding: 0.55rem; gap: 0.5rem; }
  .emergency-shortcut > svg { width: 26px; height: 26px; }
  .emergency-shortcut > svg:last-child { width: 18px; height: 18px; }
  .emergency-shortcut strong { font-size: 1rem; }
  .emergency-disclaimer { min-height: 0; margin: 0.45rem 0.65rem 0; padding: 0.3rem 0.55rem; gap: 0.45rem; font-size: 0.75rem; }
  .emergency-disclaimer > svg { width: 16px; height: 16px; }
  .emergency-pas { padding: 0.75rem; }
  .emergency-pas h2, .emergency-pas li { font-size: 1rem; }
}
@container (max-width: 39rem) {
  .emergency-shortcut { flex-wrap: wrap; gap: 0.35rem; }
  .emergency-shortcut strong { order: 1; width: 100%; }
}
@container (max-width: 32rem) {
  .emergency-shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .emergency-header { flex-wrap: wrap; gap: 0.5rem; }
  .emergency-title h1 { font-size: 1.35rem; }
  .emergency-print { order: 2; flex: 1 0 100%; }
  .emergency-phone { margin-left: auto; }
  .emergency-disclaimer { font-size: 0.7rem; }
}
</style>
