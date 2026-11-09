<script setup lang="ts">
import { Cable, Loader, Network, Radio, Wifi, WifiOff } from '@lucide/vue'
import type { Tone } from '~/utils/alerts'
import type { MeshStatus } from '@survival-os/shared-types'

const t = useT()
const { status } = useDeviceStatus()
const network = computed(() => status.value?.network)
const interfaces = computed(() => (network.value?.state === 'ok' ? network.value.value.interfaces : []))

// ------------------------------------------------------------------ Presentación (solo lo medido)
const net = computed(() => (network.value?.state === 'ok' ? network.value.value : null))
const upCount = computed(() => interfaces.value.filter((i) => i.up).length)
const heroTone = computed<Tone>(() => (!net.value ? 'muted' : net.value.mode === 'local' ? 'info' : 'warn'))
const heroIcon = computed(() => (!network.value ? Loader : net.value?.mode === 'local' ? Wifi : WifiOff))
const heroTitle = computed(() =>
  !network.value ? t('state.loading') : !net.value ? t('state.unavailable') : net.value.mode === 'local' ? t('bar.net.local') : t('bar.net.offline'),
)
const radioLabel = computed(() =>
  !net.value || net.value.wifiRadio === null ? '—' : net.value.wifiRadio === 'enabled' ? t('ui.comms.radioOn') : t('ui.comms.radioOff'),
)
// Malla LoRa: estado del servicio survival-mesh (null si no está instalado o no responde).
const mesh = ref<MeshStatus | null>(null)
onMounted(async () => {
  mesh.value = await ($fetch as (u: string, o: Record<string, unknown>) => Promise<MeshStatus>)('/api/mesh/status', { timeout: 5000, retry: 0 }).catch(() => null)
})
const ifaceIcon = (kind: string) => (kind === 'wifi' ? Wifi : kind === 'ethernet' ? Cable : Network)
</script>

<template>
  <div class="page">
    <PageHeader :title="t('module.comms')" :icon="Radio" />

    <!-- Estado de la red local: no se comprueba Internet. -->
    <section class="hero" :class="`tone-${heroTone}`">
      <span class="orb" aria-hidden="true"><component :is="heroIcon" :size="28" /></span>
      <div class="hero-text">
        <h2>{{ heroTitle }}</h2>
        <ProbeNote v-if="network && network.state !== 'ok'" :probe="network" />
        <p v-else>{{ t('comms.noInternetCheck') }}</p>
      </div>
      <dl class="hero-stats">
        <div>
          <dt>{{ t('ui.comms.activeIfaces') }}</dt>
          <dd class="mono">{{ net ? `${upCount} / ${interfaces.length}` : '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('ui.comms.radio') }}</dt>
          <dd :class="net?.wifiRadio === 'enabled' ? 'tone-ok toned' : ''">{{ radioLabel }}</dd>
        </div>
      </dl>
    </section>

    <!-- Interfaces -->
    <h2 class="ui-sec">{{ t('comms.interfaces') }}</h2>
    <section v-if="!network || net" class="panel">
      <ProbeNote v-if="!network" class="note" :probe="network" />
      <p v-else-if="net && interfaces.length === 0" class="note">{{ t('comms.none') }}</p>
      <ul v-if="interfaces.length" class="list">
        <li v-for="iface in interfaces" :key="iface.name" class="ui-row item" :class="iface.up ? 'tone-ok' : 'tone-muted'">
          <span class="if-icon" aria-hidden="true"><component :is="ifaceIcon(iface.kind)" :size="20" /></span>
          <span class="grow">
            <span class="name mono">{{ iface.name }}</span>
            <span class="meta">
              <template v-if="iface.up">
                <span v-if="iface.connection">{{ iface.connection }} · </span>
                <span class="mono">{{ iface.ipv4.join(', ') || '—' }}</span>
              </template>
              <template v-else>{{ t('comms.disconnected') }}</template>
            </span>
          </span>
          <StatePill :tone="iface.up ? 'ok' : 'muted'" :label="iface.up ? t('ui.comms.connected') : t('comms.disconnected')" />
        </li>
      </ul>
    </section>

    <!-- Radio -->
    <h2 class="ui-sec">{{ t('ui.comms.secRadio') }}</h2>
    <div class="bento">
      <ApCard />

      <!-- Malla LoRa Meshtastic (servicio survival-mesh): estado real o «no disponible». -->
      <AppCard
        :title="t('comms.lora')"
        :icon="Radio"
        :tone="mesh?.connected ? 'ok' : 'muted'"
        :pill="mesh?.connected ? t('mesh.nodesSeen', { n: mesh.nodeCount }) : t('state.unavailable')"
      >
        <p>{{ mesh?.connected ? t('mesh.connected') : mesh?.error ?? t('comms.lora.none') }}</p>
        <NuxtLink to="/malla" class="btn">{{ t('mesh.cta') }}</NuxtLink>
      </AppCard>
    </div>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------ Estado */
.hero {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 14%, transparent), transparent 55%),
    var(--surface-grad);
  animation: fade-in 0.18s ease-out;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 70%, transparent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--tone) 8%, transparent);
}

.hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.hero-text h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.hero-text p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.hero-stats {
  flex: none;
  display: flex;
  margin: 0;
}

.hero-stats div {
  padding: 0.15rem 0 0.15rem 1rem;
  margin-left: 1rem;
  border-left: 1px solid var(--border);
}

.hero-stats dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.hero-stats dd {
  margin: 0.2rem 0 0;
  font-size: 1.05rem;
  color: var(--text);
  white-space: nowrap;
}

.toned {
  color: var(--tone) !important;
  font-weight: 700;
}

/* ------------------------------------------------------------ Interfaces */
.panel {
  padding: 0.35rem 0.9rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-grad);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.item {
  gap: 0.75rem;
  min-height: 3.5rem;
}

.if-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 700;
  font-size: 0.98rem;
}

.meta {
  font-size: 0.82rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.note {
  padding: 0.6rem 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* ------------------------------------------------------------ Radio */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gap);
  align-items: stretch;
}
</style>
