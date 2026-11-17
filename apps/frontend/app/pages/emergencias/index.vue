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
    <PageHeader :title="t('module.emergency')" :icon="LifeBuoy">
      <span class="head-gap" aria-hidden="true" />
      <NuxtLink to="/emergencias/imprimir" class="btn"><Printer :size="20" aria-hidden="true" />{{ t('ui.print.open') }}</NuxtLink>
      <!-- Informativo: el equipo no realiza llamadas. Se ve también si falla la biblioteca. -->
      <div class="phone" role="note" :aria-label="`${t('em.call')}: ${t('em.call.number')}`">
        <Phone :size="20" aria-hidden="true" />
        <span class="phone-label">{{ t('em.call') }}</span>
        <strong class="mono">{{ t('em.call.number') }}</strong>
      </div>
    </PageHeader>

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
        <NuxtLink v-if="pas" :to="`/emergencias/${pas.id}`" class="pas">
          <span class="pas-title">{{ t('em.catalog.pas') }}</span>
          <ol><li>{{ t('em.pas.p') }}</li><li>{{ t('em.pas.a') }}</li><li>{{ t('em.pas.s') }}</li></ol>
          <span class="pas-open">{{ t('em.catalog.pasOpen') }}<ArrowRight :size="16" aria-hidden="true" /></span>
        </NuxtLink>
      </template>
      <template #featured>
        <section v-if="shortcuts.length" class="featured" aria-labelledby="emergency-shortcuts">
          <h2 id="emergency-shortcuts" class="group-head">
            <span class="group-icon"><Siren :size="18" aria-hidden="true" /></span>
            {{ t('em.catalog.shortcuts') }}
            <small>{{ t('em.catalog.shortcutsHint') }}</small>
          </h2>
          <div class="shortcuts">
            <NuxtLink
              v-for="shortcut in shortcuts" :key="shortcut.id" :to="`/emergencias/${shortcut.id}`"
              :aria-label="shortcut.fullTitle" class="shortcut" :class="{ primary: shortcut.id === 'rcp-adulto' }"
            >
              <span class="spine"><component :is="shortcut.icon" :size="22" aria-hidden="true" /></span>
              <strong>{{ shortcut.title }}</strong>
              <ChevronRight :size="20" class="chev" aria-hidden="true" />
            </NuxtLink>
          </div>
        </section>
      </template>
      <template #footer>
        <p class="disclaimer"><ShieldAlert :size="18" aria-hidden="true" /><span>{{ t('em.disclaimer') }}</span></p>
      </template>
    </GuideCatalog>
  </div>
</template>

<style scoped>
/* Mismo lenguaje visual que la Biblioteca: cabecera estándar, tarjetas con lomo de color y textos contenidos. */
.emergency {
  --guide-violet: #b9a3e8;
}

.head-gap {
  flex: 1;
}

.phone {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--touch);
  padding: 0 0.9rem;
  border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 10%, var(--surface-2));
  color: var(--text);
}

.phone > svg,
.phone-label {
  color: var(--danger);
}

.phone-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.phone strong {
  font-size: 1.15rem;
  font-weight: 700;
}

.featured {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.2rem 0.55rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--hairline);
  font-size: 1.08rem;
  line-height: 1.2;
}

.group-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--radius-sm);
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 15%, transparent);
}

.group-head small {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}

.shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  gap: 0.5rem;
}

.shortcut {
  display: flex;
  align-items: stretch;
  gap: 0.75rem;
  min-width: 0;
  min-height: 3.8rem;
  padding: 0.45rem 0.55rem 0.45rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(70% 90% at 100% 100%, color-mix(in srgb, var(--danger) 8%, transparent), transparent 70%),
    var(--surface-grad);
  color: var(--text);
  text-decoration: none;
  transition: background 0.12s, border-color 0.12s, transform 0.08s ease-out;
}

.shortcut:hover {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}

.shortcut:active {
  background: var(--surface-3);
  border-color: var(--danger);
  transform: scale(0.98);
}

.shortcut.primary {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  background: linear-gradient(115deg, color-mix(in srgb, var(--danger) 18%, var(--surface-2)), var(--surface-2));
}

.spine {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.8rem;
  border-radius: 0.6rem 0.35rem 0.35rem 0.6rem;
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 30%, var(--surface-2)), color-mix(in srgb, var(--danger) 14%, var(--surface)));
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--danger) 70%, transparent);
  color: var(--danger);
}

.shortcut strong {
  flex: 1;
  min-width: 0;
  align-self: center;
  font-size: 1.02rem;
  line-height: 1.22;
  overflow-wrap: break-word;
  hyphens: auto;
}

.chev {
  flex: none;
  align-self: center;
  color: var(--text-faint);
}

/* PAS en la columna de categorías: recordatorio breve, mismo tamaño de letra que las categorías. */
.pas {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.6rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--danger) 6%, var(--surface));
  color: var(--text);
  text-decoration: none;
}

.pas-title {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.pas ol {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: pas;
}

.pas li {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.98rem;
  font-weight: 700;
  counter-increment: pas;
}

.pas li::before {
  content: counter(pas);
  display: grid;
  place-items: center;
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  border: 1.5px solid color-mix(in srgb, var(--danger) 70%, transparent);
  border-radius: 50%;
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.pas-open {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.2rem;
  color: var(--accent);
  font-size: 0.88rem;
  font-weight: 700;
}

.disclaimer {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.4rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn) 6%, var(--surface));
  color: var(--text-muted);
  font-size: 0.82rem;
  line-height: 1.3;
}

.disclaimer > svg {
  flex: none;
  color: var(--warn);
}

.emergency-error {
  display: grid;
  justify-items: start;
  gap: 0.7rem;
}

@media (max-width: 640px) {
  .head-gap,
  .phone-label {
    display: none;
  }

  .group-head small {
    flex-basis: 100%;
    margin-left: 0;
  }
}
</style>
