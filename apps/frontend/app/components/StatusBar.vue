<script setup lang="ts">
import { BatteryWarning, Battery, Clock, HardDrive, PlugZap, Satellite, Thermometer, Wifi, WifiOff, TriangleAlert } from '@lucide/vue'
import type { MessageKey } from '~/locales/es'
import { formatAge, formatBytes, formatClock, formatDate, formatNumber } from '~/utils/format'
import { TEMP_CRITICAL_C, TEMP_WARN_C } from '~/utils/alerts'

const t = useT()
const now = useNow()
const { status, apiDown } = useDeviceStatus()
const { nav } = useNav()

const timeSource = computed(() => {
  const time = status.value?.time
  if (!time || time.state !== 'ok') return { key: 'bar.time.unverified' as MessageKey, tone: 'warn' }
  const src = time.value.source
  return { key: `bar.time.${src}` as MessageKey, tone: src === 'unverified' ? 'warn' : 'ok' }
})

const gnss = computed(() => {
  const n = nav.value
  if (n?.simulated) return { text: `${t('bar.gnss')} ${t('bar.gnss.simulated')}`, tone: 'danger' }
  const g = n?.gnss
  // Sin GNSS propio con fijación: respaldo del nodo LoRa (con su antigüedad), nunca presentado como fijación.
  const fb = n?.fallback
  const noFix = !g || g.state !== 'ok' || g.value.fix === 'none'
  if (noFix && fb?.state === 'ok') {
    const age = fb.value.ageSeconds
    return { text: `${t('bar.gnss')}: ${age === null ? t('bar.gnss.loraNoTime') : t('bar.gnss.lora', { age: formatAge(age) })}`, tone: 'warn' }
  }
  if (!g || g.state !== 'ok') return { text: `${t('bar.gnss')}: ${n?.devices.length ? t('bar.gnss.nofix') : t('bar.gnss.none')}`, tone: n?.devices.length ? 'warn' : 'muted' }
  const fix = g.value.fix
  return { text: `${t('bar.gnss')} ${fix === 'none' ? t('bar.gnss.nofix') : fix.toUpperCase()}`, tone: fix === 'none' ? 'warn' : 'ok' }
})

const network = computed(() => {
  const n = status.value?.network
  if (!n || n.state !== 'ok' || n.value.mode === 'offline') return { text: t('bar.net.offline'), online: false }
  return { text: t('bar.net.local'), online: true }
})

const temp = computed(() => {
  const c = status.value?.cpu
  if (!c || c.state !== 'ok' || c.value.temperatureC === null) return null
  const v = c.value.temperatureC
  return { text: `${formatNumber(v, 0)} °C`, tone: v >= TEMP_CRITICAL_C ? 'danger' : v >= TEMP_WARN_C ? 'warn' : 'ok' }
})

const disk = computed(() => {
  const s = status.value?.storage
  if (!s || s.state !== 'ok') return null
  const root = s.value.find((m) => m.mount === '/') ?? s.value[0]
  return root ? t('bar.disk.free', { value: formatBytes(root.availableBytes) }) : null
})

/** Vista pública (móvil en el punto de acceso): solo reloj; el estado del equipo no se expone. */
const publicView = isPublicView()

/** Batería y red de la UPS: solo lo medido (medidor I²C y GPIO6); sin lectura → «no disponible». */
const power = computed(() => {
  const b = status.value?.battery
  const m = status.value?.mains
  const pct = b?.state === 'ok' ? `${b.value.percent} %` : null
  const mains = m?.state === 'ok' ? m.value.present : null
  if (mains === false) {
    return { text: pct ? t('bar.battery.noMains', { value: pct }) : t('bar.mains.off'), tone: 'warn', icon: Battery }
  }
  if (pct) return { text: t(mains ? 'bar.battery.mains' : 'bar.battery', { value: pct }), tone: 'ok', icon: mains ? PlugZap : Battery }
  if (mains) return { text: t('bar.mains.on'), tone: 'ok', icon: PlugZap }
  return { text: t('bar.battery.unavailable'), tone: 'muted', icon: BatteryWarning }
})
</script>

<template>
  <header class="bar" role="status" aria-live="polite">
    <div class="item clock">
      <Clock :size="18" aria-hidden="true" />
      <span class="mono strong">{{ formatClock(now) }}</span>
      <span class="date statusbar-date">{{ formatDate(now) }}</span>
      <span v-if="!publicView" class="tag" :class="`tone-${timeSource.tone}`">{{ t(timeSource.key) }}</span>
    </div>

    <template v-if="publicView">
      <div class="spacer" />
      <span class="tag tone-info">{{ t('ui.public.tag') }}</span>
    </template>
    <template v-else>
      <div v-if="apiDown" class="item tone-danger api-down">
        <TriangleAlert :size="18" aria-hidden="true" />
        <span>{{ t('bar.api.down') }}</span>
      </div>

      <div class="spacer" />

      <div class="item" :class="`tone-${gnss.tone}`">
        <Satellite :size="18" aria-hidden="true" />
        <span>{{ gnss.text }}</span>
      </div>

      <div class="item" :class="network.online ? 'tone-info' : 'tone-muted'">
        <component :is="network.online ? Wifi : WifiOff" :size="18" aria-hidden="true" />
        <span>{{ network.text }}</span>
      </div>

      <div class="item" :class="temp ? `tone-${temp.tone}` : 'tone-muted'">
        <Thermometer :size="18" aria-hidden="true" />
        <span class="mono">{{ temp?.text ?? '—' }}</span>
      </div>

      <div class="item tone-muted">
        <HardDrive :size="18" aria-hidden="true" />
        <span>{{ disk ?? '—' }}</span>
      </div>

      <div class="item" :class="`tone-${power.tone}`">
        <component :is="power.icon" :size="18" aria-hidden="true" />
        <span>{{ power.text }}</span>
      </div>
    </template>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  height: var(--bar-h);
  padding: 0 0.75rem;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 60%, var(--bg)), var(--surface));
  border-bottom: 1px solid var(--border);
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
}

.item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
}

.item svg {
  color: var(--tone, var(--text-muted));
  flex: none;
}

.clock {
  color: var(--text);
}

.strong {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.date {
  color: var(--text-muted);
}


.tag {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent);
  background: color-mix(in srgb, var(--tone) 10%, transparent);
  color: var(--tone);
  font-size: 0.75rem;
  font-weight: 700;
}

.api-down {
  color: var(--danger);
  font-weight: 700;
}

.spacer {
  flex: 1;
}
</style>
