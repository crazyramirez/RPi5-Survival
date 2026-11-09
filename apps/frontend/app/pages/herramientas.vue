<script setup lang="ts">
import { ArrowRightLeft, Calculator, Compass, Hand, Keyboard, MousePointer2, Usb, Wrench } from '@lucide/vue'
import type { InputDeviceInfo } from '@survival-os/shared-types'
import { parseDecimalDegrees, toDms } from '~/utils/coords'

const t = useT()
const { status } = useDeviceStatus()
const serial = computed(() => status.value?.serial)
const input = computed(() => status.value?.input)

const latText = ref('')
const lonText = ref('')
const lat = computed(() => (latText.value.trim() ? parseDecimalDegrees(latText.value, 'lat') : null))
const lon = computed(() => (lonText.value.trim() ? parseDecimalDegrees(lonText.value, 'lon') : null))
const latInvalid = computed(() => latText.value.trim() !== '' && lat.value === null)
const lonInvalid = computed(() => lonText.value.trim() !== '' && lon.value === null)

const kindLabel = (kind: InputDeviceInfo['kind']): string => t(`tools.input.kind.${kind}`)

// ------------------------------------------------------------------ Presentación
const KIND_ICON = { touchscreen: Hand, keyboard: Keyboard, pointer: MousePointer2, other: Usb } as const
const ports = computed(() => (serial.value?.state === 'ok' ? serial.value.value.usbPorts : []))
const devices = computed(() => (input.value?.state === 'ok' ? input.value.value : []))
</script>

<template>
  <div class="page">
    <PageHeader :title="t('module.tools')" :icon="Wrench" />

    <!-- Herramienta principal: conversor de coordenadas. -->
    <section class="feature tone-info">
      <header class="feature-head">
        <span class="orb" aria-hidden="true"><Calculator :size="24" /></span>
        <div>
          <h2>{{ t('tools.coords') }}</h2>
          <p>{{ t('ui.tools.coordsHint') }}</p>
        </div>
      </header>
      <div class="converter">
        <div class="fields">
          <label class="field">
            <span>{{ t('tools.coords.lat') }}</span>
            <input v-model="latText" class="ui-field mono selectable" :class="{ bad: latInvalid }" inputmode="decimal" placeholder="40.4168" />
            <small v-if="latInvalid" class="invalid">{{ t('tools.coords.invalid') }} (±90)</small>
          </label>
          <label class="field">
            <span>{{ t('tools.coords.lon') }}</span>
            <input v-model="lonText" class="ui-field mono selectable" :class="{ bad: lonInvalid }" inputmode="decimal" placeholder="-3.7038" />
            <small v-if="lonInvalid" class="invalid">{{ t('tools.coords.invalid') }} (±180)</small>
          </label>
        </div>
        <ArrowRightLeft :size="22" class="arrow" aria-hidden="true" />
        <div class="result" :class="{ ready: lat !== null || lon !== null }">
          <span class="result-cap">{{ t('tools.coords.result') }}</span>
          <p class="dms mono">
            <span class="axis">{{ t('nav.lat') }}</span>
            <span class="selectable">{{ lat !== null ? toDms(lat, 'lat') : '—' }}</span>
          </p>
          <p class="dms mono">
            <span class="axis">{{ t('nav.lon') }}</span>
            <span class="selectable">{{ lon !== null ? toDms(lon, 'lon') : '—' }}</span>
          </p>
        </div>
      </div>
    </section>

    <!-- Hardware conectado -->
    <h2 class="ui-sec">{{ t('ui.tools.secHardware') }}</h2>
    <div class="bento">
      <AppCard
        :title="t('tools.serial')"
        :icon="Usb"
        :tone="serial?.state === 'ok' && serial.value.usbPorts.length ? 'info' : 'muted'"
        :pill="serial?.state === 'ok' ? String(ports.length) : undefined"
      >
        <ProbeNote :probe="serial" />
        <template v-if="serial?.state === 'ok'">
          <p v-if="ports.length === 0">{{ t('tools.serial.none') }}</p>
          <ul v-else class="list">
            <li v-for="port in ports" :key="port" class="ui-row item tone-info">
              <span class="dot" aria-hidden="true" />
              <span class="grow">
                <span class="meta">{{ t('tools.serial.port') }}</span>
                <span class="name mono">{{ port }}</span>
              </span>
            </li>
          </ul>
          <p class="note">{{ t('tools.serial.note') }}</p>
        </template>
      </AppCard>

      <AppCard
        :title="t('tools.input')"
        :icon="Keyboard"
        :tone="devices.length ? 'info' : 'muted'"
        :pill="input?.state === 'ok' ? String(devices.length) : undefined"
      >
        <ProbeNote :probe="input" />
        <ul v-if="devices.length" class="list">
          <li v-for="dev in devices" :key="`${dev.vendorId}:${dev.productId}:${dev.name}`" class="ui-row item">
            <span class="kind-icon" aria-hidden="true"><component :is="KIND_ICON[dev.kind] ?? Usb" :size="18" /></span>
            <span class="grow">
              <span class="name">{{ dev.name }}</span>
              <span class="meta mono">{{ dev.vendorId }}:{{ dev.productId }}</span>
            </span>
            <span class="ui-chip">{{ kindLabel(dev.kind) }}</span>
          </li>
        </ul>
      </AppCard>

      <Esp32Card />

      <AppCard :title="t('tools.compass')" :icon="Compass" tone="muted" :pill="t('state.unavailable')">
        <p>{{ t('tools.compass.none') }}</p>
      </AppCard>
    </div>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------ Conversor */
.feature {
  padding: 0.85rem 1rem 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 14%, transparent), transparent 55%),
    var(--surface-grad);
  animation: fade-in 0.18s ease-out;
}

.feature-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 0.75rem;
}

.feature-head h2 {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.feature-head p {
  color: var(--text-muted);
  font-size: 0.88rem;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.9rem;
  height: 2.9rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 16%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--tone) 70%, transparent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--tone) 8%, transparent);
}

.converter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.9rem;
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.field input {
  width: 100%;
  min-height: 3.25rem;
  font-size: 1.2rem;
  font-weight: 400;
  letter-spacing: 0;
}

.field input.bad {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
}

.invalid {
  color: var(--danger);
  font-size: 0.8rem;
  font-weight: 400;
  letter-spacing: 0;
}

.arrow {
  color: var(--tone);
  opacity: 0.8;
}

.result {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.6rem 0.85rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  transition: border-color 0.12s;
}

.result.ready {
  border-color: color-mix(in srgb, var(--tone) 55%, var(--border));
}

.result-cap {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.dms {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
}

.dms .axis {
  flex: none;
  width: 4.8rem;
  font-family: var(--font-ui);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* ------------------------------------------------------------ Hardware */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gap);
  align-items: stretch;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.item {
  gap: 0.6rem;
}

.dot {
  flex: none;
  width: 0.55rem;
  height: 0.55rem;
  margin: 0 0.2rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
}

.kind-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 700;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 0.76rem;
  color: var(--text-faint);
}

.note {
  color: var(--text-faint) !important;
  font-size: 0.82rem !important;
}
</style>
