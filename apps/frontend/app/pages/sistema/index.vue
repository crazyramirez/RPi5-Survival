<script setup lang="ts">
import {
  Activity,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Info,
  HardDrive,
  Layers,
  Loader,
  MemoryStick,
  Monitor,
  MonitorOff,
  Power,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Server,
  ShieldCheck,
  Thermometer,
  TriangleAlert,
  Unplug,
  Wrench,
  Zap,
} from '@lucide/vue'
import type { HealthReport } from '@survival-os/shared-types'
import type { MessageKey } from '~/locales/es'
import type { Tone } from '~/utils/alerts'
import { DISK_CRITICAL_RATIO, DISK_WARN_RATIO, TEMP_CRITICAL_C, TEMP_WARN_C } from '~/utils/alerts'
import { formatAge, formatBytes, formatDuration, formatNumber } from '~/utils/format'

/** Escala del medidor térmico (°C). Solo para dibujar: los umbrales reales son TEMP_WARN_C / TEMP_CRITICAL_C. */
const TEMP_SCALE_MAX_C = 90

const t = useT()
const config = useRuntimeConfig()
const { status, lastOkAt, apiDown, alerts, ageSeconds, history } = useDeviceStatus()
// Lo que esta plataforma no permite nunca no se muestra (utils/platform.ts); lo transitorio sigue como «no disponible».
const caps = usePlatformCaps()

// Tendencias medidas (memoria del navegador, últimos 15 min de sondeo).
const trend = computed(() => ({
  temp: history.value.map((h) => h.tempC),
  load: history.value.map((h) => (h.load == null ? null : h.load * 100)),
  mem: history.value.map((h) => (h.mem == null ? null : h.mem * 100)),
}))
const trendSpan = computed(() => {
  const h = history.value
  if (h.length < 2) return ''
  return t('sys.trend.span', { m: Math.max(1, Math.round((h[h.length - 1]!.at - h[0]!.at) / 60000)) })
})
const s = computed(() => status.value)

const health = ref<HealthReport | null>(null)
const healthError = ref(false)
async function loadHealth(): Promise<void> {
  try {
    // 503 = degradado, pero el cuerpo sigue siendo un informe válido.
    health.value = await $fetch<HealthReport>('/api/health', { timeout: 5000, retry: 0, ignoreResponseError: true })
    healthError.value = false
  } catch {
    healthError.value = true
  }
}
onMounted(loadHealth)
watch(lastOkAt, loadHealth)

// ------------------------------------------------------------------ Estado global

type KeyProbe = 'cpu' | 'memory' | 'storage' | 'power' | 'time' | 'display' | 'input' | 'services'
/** Medidas clave que esta plataforma puede dar: las imposibles no cuentan como «sin dato». */
const keyProbes = computed<KeyProbe[]>(() => {
  const c = caps.value
  const list: KeyProbe[] = ['memory', 'storage', 'time']
  if (c.cpuProbe === 'yes') list.push('cpu')
  if (c.piHardware) list.push('power')
  if (c.displayProbe) list.push('display')
  if (c.inputProbe) list.push('input')
  if (c.systemd) list.push('services')
  return list
})

const hero = computed(() => {
  const list = alerts.value
  if (s.value === null && !apiDown.value) {
    return { tone: 'muted' as Tone, icon: Loader, title: t('sys.hero.loading'), sub: null as string | null, more: 0 }
  }
  if (list.length === 0) {
    // "En orden" solo afirma lo medido: si faltan medidas clave se dice cuántas.
    const missing = s.value ? keyProbes.value.filter((k) => s.value![k].state !== 'ok').length : 0
    return {
      tone: (missing ? 'info' : 'ok') as Tone,
      icon: ShieldCheck,
      title: t('sys.hero.ok'),
      sub: missing ? t('sys.hero.okPartial', { n: missing }) : t('sys.hero.okSub'),
      more: 0,
    }
  }
  const top = list[0]!
  return {
    tone: top.tone,
    icon: apiDown.value ? Unplug : top.tone === 'info' ? Info : TriangleAlert,
    title: list.length === 1 ? t('sys.hero.issue1') : t('sys.hero.issues', { n: list.length }),
    sub: t(top.key, top.params),
    more: list.length - 1,
  }
})

const lastRead = computed(() =>
  ageSeconds.value === null ? t('sys.hero.never') : t('sys.hero.ago', { s: Math.max(0, Math.round(ageSeconds.value)) }),
)

const deviceApiLabel = computed(() => {
  if (healthError.value) return t('sys.services.noResponse')
  const c = health.value?.components.deviceApi
  if (!c) return null
  return c.state === 'ok' ? t('sys.services.okLatency', { ms: c.latencyMs ?? '?' }) : (c.detail ?? t('sys.services.down'))
})
const deviceApiTone = computed<Tone | undefined>(() =>
  healthError.value || (health.value && health.value.components.deviceApi?.state !== 'ok')
    ? 'danger'
    : health.value
      ? 'ok'
      : undefined,
)

// ------------------------------------------------------------------ Medidores

const cpu = computed(() => (s.value?.cpu.state === 'ok' ? s.value.cpu.value : null))
// Temperatura y carga: siempre en Linux; en Android solo si el fabricante deja leerlas; nunca en Windows/macOS.
const showTemp = computed(() => caps.value.cpuProbe === 'yes' || (caps.value.cpuProbe === 'maybe' && cpu.value?.temperatureC != null))
const showLoad = computed(() => caps.value.cpuProbe === 'yes' || (caps.value.cpuProbe === 'maybe' && cpu.value !== null))
const gaugeCount = computed(() => 2 + Number(showTemp.value) + Number(showLoad.value))
const tempTone = computed<Tone | undefined>(() => {
  const c = cpu.value?.temperatureC
  if (c == null) return undefined
  return c >= TEMP_CRITICAL_C ? 'danger' : c >= TEMP_WARN_C ? 'warn' : 'ok'
})
const fanSub = computed(() => {
  const f = s.value?.fan
  if (!f) return null
  // Ventilador PWM: solo la Pi tiene uno que se pueda leer.
  if (f.state !== 'ok') return caps.value.piHardware ? t('sys.g.noFan') : null
  return f.value.pwm != null
    ? t('sys.g.fanPwm', { rpm: f.value.rpm, pwm: Math.round((f.value.pwm / 255) * 100) })
    : t('sys.g.fan', { rpm: f.value.rpm })
})

const loadRatio = computed(() => (cpu.value && cpu.value.cores > 0 ? cpu.value.load1 / cpu.value.cores : null))
const loadTone = computed<Tone>(() => ((loadRatio.value ?? 0) >= 1 ? 'danger' : (loadRatio.value ?? 0) >= 0.8 ? 'warn' : 'ok'))

const mem = computed(() => (s.value?.memory.state === 'ok' ? s.value.memory.value : null))
const memRatio = computed(() => (mem.value ? usageRatio(mem.value.totalBytes, mem.value.availableBytes) : null))
const memTone = computed<Tone>(() => ((memRatio.value ?? 0) >= 0.95 ? 'danger' : (memRatio.value ?? 0) >= 0.9 ? 'warn' : 'ok'))

const mounts = computed(() => (s.value?.storage.state === 'ok' ? s.value.storage.value : []))
const rootMount = computed(() => mounts.value.find((m) => m.mount === '/') ?? mounts.value[0] ?? null)

function usageRatio(total: number, avail: number): number {
  return total > 0 ? Math.min(1, Math.max(0, (total - avail) / total)) : 0
}
function diskTone(total: number, avail: number): Tone {
  if (total <= 0) return 'muted'
  const free = avail / total
  return free < DISK_CRITICAL_RATIO ? 'danger' : free < DISK_WARN_RATIO ? 'warn' : 'ok'
}
const pct = (r: number | null): string | null => (r == null ? null : formatNumber(r * 100, 0))

// ------------------------------------------------------------------ Hardware

const power = computed(() => (s.value?.power.state === 'ok' ? s.value.power.value : null))
const throttleIssues = computed(() => {
  const th = power.value?.throttle
  if (!th) return null
  const issues: { text: string; tone: Tone }[] = []
  if (th.underVoltageNow) issues.push({ text: t('sys.power.uvNow'), tone: 'danger' })
  else if (th.underVoltageOccurred) issues.push({ text: t('sys.power.uvPast'), tone: 'warn' })
  if (th.throttledNow) issues.push({ text: t('sys.power.thrNow'), tone: 'warn' })
  else if (th.throttledOccurred) issues.push({ text: t('sys.power.thrPast'), tone: 'warn' })
  if (th.armFreqCappedNow || th.armFreqCappedOccurred) issues.push({ text: t('sys.power.capped'), tone: 'warn' })
  if (th.softTempLimitNow || th.softTempLimitOccurred) issues.push({ text: t('sys.power.softTemp'), tone: 'warn' })
  return issues
})
const powerTone = computed<Tone>(() => {
  if (!power.value) return 'muted'
  const list = throttleIssues.value ?? []
  return list.some((i) => i.tone === 'danger') ? 'danger' : list.length ? 'warn' : 'ok'
})

const time = computed(() => (s.value?.time.state === 'ok' ? s.value.time.value : null))
// Comprobar la hora sin red ya (tarea root `time-sync`, ADR 0011). El resultado solo se muestra tras pulsar.
const timeCheck = useAdminJob('time-sync')
const timeChecked = ref(false)
function checkTimeNow(): void {
  timeChecked.value = true
  void timeCheck.start()
}
const timeCheckText = computed(() => {
  if (!timeChecked.value) return null
  if (timeCheck.running.value) return t('sys.time.checking')
  if (timeCheck.error.value) return timeCheck.error.value
  const d = timeCheck.status.value?.data as
    | { source?: string | null; node?: string | null; lastStep?: { at: string; deltaS: number } | null; checkedAt?: string; loraReason?: string | null; loraSamples?: number | null }
    | null
    | undefined
  if (!d) return timeCheck.status.value?.result === 'success' ? null : t('sys.time.checkFailed')
  if (d.source === 'ntp') return t('sys.time.check.ntp')
  if (d.source === 'gnss' || d.source === 'lora') {
    const src = t(`bar.time.${d.source}` as MessageKey)
    const stepped = d.lastStep && d.checkedAt && d.lastStep.at === d.checkedAt
    return stepped
      ? t('sys.time.check.stepped', { src, d: formatDuration(Math.abs(d.lastStep!.deltaS)), dir: d.lastStep!.deltaS > 0 ? t('sys.time.forward') : t('sys.time.back') })
      : t('sys.time.check.ok', { src })
  }
  if (d.loraReason === 'samples') return t('sys.time.check.samples', { n: d.loraSamples ?? 0 })
  if (d.loraReason === 'noPrivate') return t('sys.time.check.noPrivate')
  return t('sys.time.check.none')
})

function timeAgo(iso: string): string {
  return t('sys.time.ago', { age: formatAge(Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))) })
}
const rtc = computed(() => (s.value?.rtc.state === 'ok' ? s.value.rtc.value : null))
const timeTone = computed<Tone>(() => (!time.value ? 'muted' : time.value.source === 'unverified' ? 'warn' : 'ok'))

const connectedDisplays = computed(() =>
  s.value?.display.state === 'ok' ? s.value.display.value.filter((d) => d.connected) : [],
)
const touch = computed(() =>
  s.value?.input.state === 'ok' ? s.value.input.value.filter((d) => d.kind === 'touchscreen') : [],
)
const displayTone = computed<Tone>(() => {
  if (s.value?.display.state !== 'ok') return 'muted'
  if (!connectedDisplays.value.length) return 'warn'
  return s.value?.input.state === 'ok' && !touch.value.length ? 'warn' : 'ok'
})

// ------------------------------------------------------------------ Software

const sd = computed(() => (s.value?.sdHealth?.state === 'ok' ? s.value.sdHealth.value : null))
const sdCounters = computed(() =>
  sd.value
    ? [
        { key: 'sys.sd.data' as MessageKey, n: sd.value.dataTimeouts, bad: 'warn' as Tone },
        { key: 'sys.sd.cmd' as MessageKey, n: sd.value.commandTimeouts, bad: 'warn' as Tone },
        { key: 'sys.sd.req' as MessageKey, n: sd.value.requestTimeouts, bad: 'danger' as Tone },
        { key: 'sys.sd.crc' as MessageKey, n: sd.value.crcErrors, bad: 'danger' as Tone },
      ]
    : [],
)
const storageTone = computed<Tone>(() => {
  if (s.value?.storage.state !== 'ok') return 'muted'
  const tones = [...mounts.value.map((m) => diskTone(m.totalBytes, m.availableBytes)), ...sdCounters.value.map((c) => (c.n > 0 ? c.bad : 'ok'))]
  return tones.includes('danger') ? 'danger' : tones.includes('warn') ? 'warn' : 'ok'
})

const services = computed(() =>
  s.value?.services.state === 'ok' ? s.value.services.value.filter((u) => u.active !== 'not-found') : [],
)
const activeCount = computed(() => services.value.filter((u) => u.active === 'active').length)
const servicesTone = computed<Tone>(() => {
  if (!services.value.length) return 'muted'
  if (services.value.some((u) => u.active === 'failed')) return 'danger'
  return activeCount.value === services.value.length ? 'ok' : 'warn'
})
function unitTone(active: string): Tone {
  return active === 'active' ? 'ok' : active === 'failed' ? 'danger' : active === 'activating' ? 'info' : 'warn'
}
const UNIT_STATES = new Set(['active', 'inactive', 'failed', 'activating', 'deactivating'])
function unitLabel(active: string): string {
  return UNIT_STATES.has(active) ? t(`sys.unit.${active}` as MessageKey) : active
}
/** Todas las unidades propias empiezan por "survival-": se omite para que quepa el nombre útil. */
const unitName = (u: string): string => u.replace(/^survival-/, '').replace(/\.service$/, '')

// ------------------------------------------------------------------ Control

type PowerAction = 'poweroff' | 'reboot'
const pending = ref<PowerAction | null>(null)
const busy = ref(false)
const actionMessage = ref<{ tone: Tone; text: string } | null>(null)

async function confirmPower(): Promise<void> {
  if (!pending.value) return
  busy.value = true
  try {
    await postAction('/api/system/power', { action: pending.value, confirm: true })
    actionMessage.value = { tone: 'warn', text: t(pending.value === 'poweroff' ? 'sys.power.shuttingDown' : 'sys.power.rebooting') }
  } catch (err) {
    actionMessage.value = { tone: 'danger', text: actionErrorMessage(err) }
  } finally {
    busy.value = false
    pending.value = null
  }
}

const appRestartPending = ref(false)
const portable = usePortable()
const quitPending = ref(false)
async function doQuit(): Promise<void> {
  quitPending.value = false
  try {
    await quitPortable()
    actionMessage.value = { tone: 'info', text: t('portable.closing') }
  } catch (err) {
    actionMessage.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}
// Memoria USB (portable, ADR 0019): «Expulsar» solo si se ejecuta desde una.
const { usb, load: loadUsb, eject } = usePortableUsb()
const ejectPending = ref(false)
onMounted(() => {
  if (portable) void loadUsb()
})
async function doEject(): Promise<void> {
  ejectPending.value = false
  try {
    await eject()
    actionMessage.value = { tone: 'info', text: t('usb.ejecting') }
  } catch (err) {
    actionMessage.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}
const desktopPending = ref(false)

async function exitToDesktop(): Promise<void> {
  desktopPending.value = false
  try {
    await postAction('/api/system/desktop')
  } catch (err) {
    actionMessage.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}
const appRestart = useAdminJob('restart-app')

function reloadUi(): void {
  window.location.reload()
}

async function confirmAppRestart(): Promise<void> {
  appRestartPending.value = false
  actionMessage.value = { tone: 'info', text: t('sys.app.restarting') }
  await appRestart.start()
}

async function displayOff(): Promise<void> {
  try {
    await postAction('/api/system/display')
  } catch (err) {
    actionMessage.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :title="t('module.system')" :icon="Cpu">
    </PageHeader>

    <!-- Accesos rápidos bien visibles: Mantenimiento (naranja, lo más buscado) y volver a la bienvenida. -->
    <nav class="quick" :aria-label="t('sys.quick')">
      <NuxtLink to="/sistema/mantenimiento" class="quick-card maint">
        <span class="q-ico" aria-hidden="true"><Wrench :size="26" /></span>
        <span class="q-text">
          <strong>{{ t('mnt.title') }}</strong>
          <small>{{ t('sys.mnt.hint') }}</small>
        </span>
        <ChevronRight :size="22" class="q-go" aria-hidden="true" />
      </NuxtLink>
      <NuxtLink to="/bienvenida" class="quick-card welcome">
        <span class="q-ico" aria-hidden="true"><Compass :size="24" /></span>
        <span class="q-text">
          <strong>{{ t('sys.welcome') }}</strong>
          <small>{{ t('sys.welcome.hint') }}</small>
        </span>
        <ChevronRight :size="22" class="q-go" aria-hidden="true" />
      </NuxtLink>
    </nav>

    <!-- Estado global: derivado solo de alertas sobre datos medidos. -->
    <section class="hero" :class="`tone-${hero.tone}`">
      <span class="orb" aria-hidden="true"><component :is="hero.icon" :size="28" /></span>
      <div class="hero-text">
        <h2>{{ hero.title }}</h2>
        <p v-if="hero.sub">
          {{ hero.sub }}
          <span v-if="hero.more" class="more">{{ t('sys.hero.more', { n: hero.more }) }}</span>
        </p>
        <p class="hero-id mono">
          {{ s?.platform.model ?? s?.platform.os ?? '—' }}<template v-if="caps.hostname && s?.platform.hostname"> · {{ s.platform.hostname }}</template>
        </p>
      </div>
      <dl class="hero-stats">
        <div>
          <dt>{{ t('sys.uptime') }}</dt>
          <dd class="mono">{{ s?.uptime.state === 'ok' ? formatDuration(s.uptime.value.seconds) : '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('sys.services.device') }}</dt>
          <dd class="mono" :class="deviceApiTone ? `tone-${deviceApiTone} toned` : ''">{{ deviceApiLabel ?? '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('sys.hero.lastRead') }}</dt>
          <dd class="mono" :class="apiDown ? 'tone-danger toned' : ''">{{ lastRead }}</dd>
        </div>
      </dl>
    </section>

    <!-- Recursos: solo los medidores que esta plataforma puede dar; la rejilla se ajusta a cuántos son. -->
    <div class="gauges" :class="`n-${gaugeCount}`">
      <SysGauge
        v-if="showTemp"
        :label="t('sys.g.temp')" :icon="Thermometer"
        :ratio="cpu?.temperatureC != null ? cpu.temperatureC / TEMP_SCALE_MAX_C : null"
        :value="cpu?.temperatureC != null ? formatNumber(cpu.temperatureC, 1) : null" unit="°C"
        :tone="tempTone" :marks="[TEMP_WARN_C / TEMP_SCALE_MAX_C, TEMP_CRITICAL_C / TEMP_SCALE_MAX_C]"
        :sub="cpu ? fanSub : (s?.cpu.state !== 'ok' ? translateServer(s?.cpu.reason) : null)"
      />
      <SysGauge
        v-if="showLoad"
        :label="t('sys.g.load')" :icon="Activity"
        :ratio="loadRatio" :value="cpu ? formatNumber(cpu.load1, 2) : null"
        :unit="cpu ? t('sys.g.loadUnit', { n: cpu.cores }) : undefined" :tone="loadTone"
        :sub="cpu ? t('sys.g.loadSub', { l5: formatNumber(cpu.load5, 2), l15: formatNumber(cpu.load15, 2) }) : (s?.cpu.state !== 'ok' ? translateServer(s?.cpu.reason) : null)"
      />
      <SysGauge
        :label="t('sys.memory')" :icon="MemoryStick"
        :ratio="memRatio" :value="pct(memRatio)" :unit="t('sys.g.used')" :tone="memTone"
        :sub="mem ? t('sys.memory.of', { avail: formatBytes(mem.availableBytes), total: formatBytes(mem.totalBytes) }) : (s?.memory.state !== 'ok' ? translateServer(s?.memory.reason) : null)"
      />
      <SysGauge
        :label="rootMount && rootMount.mount.length <= 12 ? t('sys.g.disk', { mount: rootMount.mount }) : t('sys.storage')" :icon="HardDrive"
        :ratio="rootMount ? usageRatio(rootMount.totalBytes, rootMount.availableBytes) : null"
        :value="rootMount ? pct(usageRatio(rootMount.totalBytes, rootMount.availableBytes)) : null"
        :unit="t('sys.g.used')"
        :tone="rootMount ? diskTone(rootMount.totalBytes, rootMount.availableBytes) : undefined"
        :sub="rootMount ? t('sys.storage.free', { free: formatBytes(rootMount.availableBytes), total: formatBytes(rootMount.totalBytes) }) : (s?.storage.state !== 'ok' ? translateServer(s?.storage.reason) : null)"
      />
    </div>

    <!-- Tendencias -->
    <div class="trends" :class="`n-${gaugeCount - 1}`">
      <SysSparkline
        v-if="showTemp"
        :label="t('sys.g.temp')" :values="trend.temp" :min="30" :max="90" :mark="TEMP_WARN_C"
        :value="cpu?.temperatureC != null ? formatNumber(cpu.temperatureC, 1) : null" unit="°C" :tone="tempTone" :span="trendSpan"
      />
      <SysSparkline
        v-if="showLoad"
        :label="t('sys.g.load')" :values="trend.load" :min="0" :max="100" :mark="80"
        :value="pct(loadRatio)" unit="%" :tone="loadTone" :span="trendSpan"
      />
      <SysSparkline
        :label="t('sys.memory')" :values="trend.mem" :min="0" :max="100" :mark="90"
        :value="pct(memRatio)" unit="%" :tone="memTone" :span="trendSpan"
      />
    </div>

    <!-- Hardware -->
    <h2 class="sec">{{ t('sys.sec.hardware') }}</h2>
    <div class="bento">
      <section class="panel" :class="`tone-${powerTone}`">
        <header class="ph">
          <span class="ph-icon"><Zap :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.power') }}</h3>
          <StatePill v-if="power" :tone="powerTone" :label="throttleIssues?.length ? t('sys.review') : t('state.ok')" />
        </header>
        <!-- Tensión y limitación (vcgencmd): solo en la Pi. Fuera de ella el panel es la batería y el cargador. -->
        <ProbeNote v-if="caps.piHardware" :probe="s?.power" />
        <template v-if="power">
          <p class="figure">
            <span class="num mono">{{ power.inputVoltageV != null ? formatNumber(power.inputVoltageV, 2) : '—' }}</span>
            <span class="unit">V</span>
            <span class="cap">{{ t('sys.power.input') }}</span>
          </p>
          <KvRow :label="t('sys.power.supply')" :value="power.supplyMaxCurrentMa != null ? `${formatNumber(power.supplyMaxCurrentMa / 1000, 1)} A` : null" mono />
          <div v-if="throttleIssues" class="chips">
            <span v-if="!throttleIssues.length" class="chip tone-ok">{{ t('sys.power.clean') }}</span>
            <span v-for="i in throttleIssues" :key="i.text" class="chip" :class="`tone-${i.tone}`">{{ i.text }}</span>
          </div>
        </template>
        <KvRow
          :label="t('sys.mains')"
          :value="s?.mains?.state === 'ok' ? t(s.mains.value.present ? 'sys.mains.on' : 'sys.mains.off') : t('state.unavailable')"
          :tone="s?.mains?.state === 'ok' && !s.mains.value.present ? 'warn' : undefined"
        />
        <ProbeNote v-if="s?.mains && s.mains.state !== 'ok'" :probe="s.mains" />
        <KvRow :label="t('sys.battery')" :value="s?.battery.state === 'ok' ? `${s.battery.value.percent} %` : t('state.unavailable')" />
        <KvRow
          v-if="s?.battery.state === 'ok' && s.battery.value.voltageV != null"
          :label="t('sys.battery.voltage')"
          :value="`${formatNumber(s.battery.value.voltageV, 2)} V`"
          mono
        />
        <ProbeNote v-if="s?.battery.state !== 'ok'" :probe="s?.battery" />
      </section>

      <section class="panel" :class="`tone-${timeTone}`">
        <header class="ph">
          <span class="ph-icon"><Clock :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.time') }}</h3>
          <StatePill v-if="time" :tone="timeTone" :label="time.source === 'unverified' ? t('sys.review') : t('state.ok')" />
        </header>
        <ProbeNote :probe="s?.time" />
        <template v-if="time">
          <p class="figure">
            <span class="num sm">{{ t(`sys.time.source.${time.source}` as MessageKey) }}</span>
            <span class="cap">{{ t('sys.time.source') }}</span>
          </p>
          <KvRow :label="t('sys.time.tz')" :value="time.timezone" mono />
          <KvRow v-if="time.verifiedAt && time.source !== 'ntp'" :label="t('sys.time.verified')" :value="timeAgo(time.verifiedAt)" />
          <KvRow
            v-if="time.lastStep"
            :label="t('sys.time.lastStep')"
            :value="t('sys.time.lastStepValue', { d: formatDuration(Math.abs(time.lastStep.deltaS)), dir: time.lastStep.deltaS > 0 ? t('sys.time.forward') : t('sys.time.back'), src: t(`bar.time.${time.lastStep.source}` as MessageKey), when: timeAgo(time.lastStep.at) })"
          />
          <button v-if="caps.clockControl" type="button" class="btn time-check" :disabled="timeCheck.running.value" @click="checkTimeNow">
            <RefreshCw :size="18" aria-hidden="true" :class="{ spin: timeCheck.running.value }" /> {{ t('sys.time.checkNow') }}
          </button>
          <p v-if="timeCheckText" class="time-check-msg" role="status">{{ timeCheckText }}</p>
        </template>
        <KvRow
          v-if="rtc"
          :label="t('sys.time.rtc')"
          :value="!rtc.present ? t('sys.time.rtc.none') : rtc.hasBattery === null ? t('state.unknown') : rtc.hasBattery ? t('sys.time.rtc.yes', { v: formatNumber(rtc.batteryVoltageV ?? 0, 2) }) : t('sys.time.rtc.no')"
          :tone="rtc.hasBattery === false ? 'warn' : undefined"
        />
      </section>

      <!-- Pantallas (DRM) y táctil: Android, Windows y macOS no los exponen a las apps. -->
      <section v-if="caps.displayProbe" class="panel" :class="`tone-${displayTone}`">
        <header class="ph">
          <span class="ph-icon"><Monitor :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.display') }}</h3>
        </header>
        <ProbeNote :probe="s?.display" />
        <template v-for="d in connectedDisplays" :key="d.name">
          <p class="figure">
            <span class="num sm mono">{{ d.modes[0] ?? '—' }}</span>
            <span class="cap">{{ t('sys.display.native') }}</span>
          </p>
          <KvRow :label="t('sys.display.output')" :value="d.name" mono />
        </template>
        <KvRow
          :label="t('sys.display.touch')"
          :value="s?.input.state === 'ok' ? (touch.length ? touch.map((d) => d.name).join(', ') : t('sys.display.touch.none')) : null"
          :tone="s?.input.state === 'ok' ? (touch.length ? 'ok' : 'warn') : undefined"
        />
      </section>
    </div>

    <!-- Almacenamiento y software -->
    <h2 class="sec">{{ t('sys.sec.software') }}</h2>
    <div class="bento">
      <section class="panel" :class="`tone-${storageTone}`">
        <header class="ph">
          <span class="ph-icon"><HardDrive :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.storage') }}</h3>
        </header>
        <ProbeNote :probe="s?.storage" />
        <div v-for="m in mounts" :key="m.mount" class="mount" :class="`tone-${diskTone(m.totalBytes, m.availableBytes)}`">
          <div class="mount-row">
            <span class="mono">{{ m.mount }}</span>
            <span class="muted">{{ t('sys.storage.free', { free: formatBytes(m.availableBytes), total: formatBytes(m.totalBytes) }) }}</span>
          </div>
          <div class="meter" role="meter" :aria-label="m.mount" :aria-valuenow="Math.round(usageRatio(m.totalBytes, m.availableBytes) * 100)" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ width: `${usageRatio(m.totalBytes, m.availableBytes) * 100}%` }" />
          </div>
        </div>
        <template v-if="sd">
          <p class="cap-line">{{ t('sys.sd') }}</p>
          <div class="counters">
            <div v-for="c in sdCounters" :key="c.key" class="counter" :class="`tone-${c.n > 0 ? c.bad : 'ok'}`">
              <span class="mono">{{ c.n }}</span>
              <small>{{ t(c.key) }}</small>
            </div>
          </div>
        </template>
      </section>

      <!-- Unidades systemd: solo en la instalación de sistema (la portable y Android lanzan sus servicios). -->
      <section v-if="caps.systemd" class="panel" :class="`tone-${servicesTone}`">
        <header class="ph">
          <span class="ph-icon"><Layers :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.services') }}</h3>
          <StatePill v-if="services.length" :tone="servicesTone" :label="t('sys.services.count', { ok: activeCount, n: services.length })" />
        </header>
        <ProbeNote :probe="s?.services" />
        <p v-if="s?.services.state === 'ok' && services.length === 0" class="muted small">{{ t('sys.services.none') }}</p>
        <ul v-if="services.length" class="units">
          <li v-for="u in services" :key="u.unit" :class="`tone-${unitTone(u.active)}`">
            <span class="dot" aria-hidden="true" />
            <span class="unit-name mono">{{ unitName(u.unit) }}</span>
            <span class="unit-state">{{ unitLabel(u.active) }}<small class="mono"> · {{ u.sub }}</small></span>
          </li>
        </ul>
      </section>

      <section class="panel tone-info">
        <header class="ph">
          <span class="ph-icon"><Server :size="18" aria-hidden="true" /></span>
          <h3>{{ t('sys.platform') }}</h3>
        </header>
        <KvRow :label="t('sys.model')" :value="s?.platform.model ?? s?.platform.os ?? null" />
        <KvRow v-if="caps.hostname" :label="t('sys.hostname')" :value="s?.platform.hostname ?? null" mono />
        <KvRow :label="t('sys.kernel')" :value="s?.platform.kernel ?? null" mono />
        <KvRow :label="t('sys.services.web')" :value="`v${config.public.version}`" tone="ok" mono />
        <KvRow :label="t('sys.services.device')" :value="deviceApiLabel" :tone="deviceApiTone" />
      </section>
    </div>

    <!-- Control -->
    <h2 class="sec">{{ t('sys.sec.control') }}</h2>
    <!-- Versión portable: no se apaga ni se toca el equipo anfitrión; solo recargar o cerrar la app. -->
    <section v-if="portable" class="control">
      <div class="ctl-row">
        <span class="ctl-group">{{ t('sys.ctl.app') }}</span>
        <button type="button" class="ctl" @click="reloadUi">
          <RefreshCw :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.app.reload') }}</strong><small>{{ t('sys.ctl.reload.hint') }}</small></span>
        </button>
        <button type="button" class="ctl ctl-danger tone-danger" @click="quitPending = true">
          <Power :size="24" aria-hidden="true" />
          <span><strong>{{ t('portable.quit') }}</strong><small>{{ t(caps.android ? 'android.quitHint' : 'portable.quitHint') }}</small></span>
        </button>
        <!-- Desde una memoria USB (ADR 0019): cerrar y expulsarla con seguridad. -->
        <button v-if="!caps.android && usb?.volume.removable" type="button" class="ctl ctl-danger tone-danger" @click="ejectPending = true">
          <Unplug :size="24" aria-hidden="true" />
          <span><strong>{{ t('usb.eject') }}</strong><small>{{ t('usb.ejectHint') }}</small></span>
        </button>
      </div>
      <p v-if="actionMessage" :class="`tone-${actionMessage.tone} action-msg`" role="status">{{ actionMessage.text }}</p>
    </section>
    <section v-else class="control">
      <p class="control-note"><Info :size="18" aria-hidden="true" />{{ t('sys.shutdown.note') }}</p>
      <div class="ctl-row">
        <span class="ctl-group">{{ t('sys.ctl.app') }}</span>
        <button type="button" class="ctl" @click="desktopPending = true">
          <Monitor :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.app.desktop') }}</strong><small>{{ t('sys.ctl.desktop.hint') }}</small></span>
        </button>
        <button type="button" class="ctl" @click="reloadUi">
          <RefreshCw :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.app.reload') }}</strong><small>{{ t('sys.ctl.reload.hint') }}</small></span>
        </button>
        <button type="button" class="ctl" @click="appRestartPending = true">
          <RotateCw :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.app.restart') }}</strong><small>{{ t('sys.ctl.restart.hint') }}</small></span>
        </button>
      </div>
      <div class="ctl-row">
        <span class="ctl-group">{{ t('sys.ctl.device') }}</span>
        <button type="button" class="ctl" @click="displayOff">
          <MonitorOff :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.ctl.displayOff') }}</strong><small>{{ t('sys.ctl.displayOff.hint') }}</small></span>
        </button>
        <button type="button" class="ctl tone-warn" @click="pending = 'reboot'">
          <RotateCcw :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.power.reboot') }}</strong><small>{{ t('sys.ctl.reboot.hint') }}</small></span>
        </button>
        <button type="button" class="ctl ctl-danger tone-danger" @click="pending = 'poweroff'">
          <Power :size="24" aria-hidden="true" />
          <span><strong>{{ t('sys.shutdown.button') }}</strong><small>{{ t('sys.ctl.poweroff.hint') }}</small></span>
        </button>
      </div>
      <p v-if="actionMessage" :class="`tone-${actionMessage.tone} action-msg`" role="status">{{ actionMessage.text }}</p>
    </section>

    <ConfirmDialog
      v-if="ejectPending"
      :title="t('usb.ejectTitle')"
      :message="t('usb.ejectBody')"
      :confirm-label="t('usb.eject')"
      danger
      @confirm="doEject"
      @cancel="ejectPending = false"
    />
    <ConfirmDialog
      v-if="quitPending"
      :title="t('portable.quitTitle')"
      :message="t('portable.quitBody')"
      :confirm-label="t('portable.quit')"
      danger
      @confirm="doQuit"
      @cancel="quitPending = false"
    />
    <ConfirmDialog
      v-if="desktopPending"
      :title="t('sys.app.desktopConfirm')"
      :message="t('sys.app.desktopBody')"
      :confirm-label="t('sys.app.desktop')"
      @confirm="exitToDesktop"
      @cancel="desktopPending = false"
    />
    <ConfirmDialog
      v-if="appRestartPending"
      :title="t('sys.app.confirm')"
      :message="t('sys.app.confirmBody')"
      :confirm-label="t('sys.app.restart')"
      @confirm="confirmAppRestart"
      @cancel="appRestartPending = false"
    />
    <ConfirmDialog
      v-if="pending"
      :title="t(pending === 'poweroff' ? 'sys.power.confirmOff.title' : 'sys.power.confirmReboot.title')"
      :message="t(pending === 'poweroff' ? 'sys.power.confirmOff.body' : 'sys.power.confirmReboot.body')"
      :confirm-label="t(pending === 'poweroff' ? 'sys.shutdown.button' : 'sys.power.reboot')"
      danger
      :busy="busy"
      @confirm="confirmPower"
      @cancel="pending = null"
    />
  </div>
</template>

<style scoped>
.time-check {
  margin-top: 0.6rem;
  width: 100%;
}

.time-check-msg {
  margin: 0.45rem 0 0;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.time-check .spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------------------ Cabecera */
.quick {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--gap);
  margin-bottom: var(--gap);
}

.quick-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-height: 3.75rem; /* ≥ 48 px táctil */
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  text-decoration: none;
  color: var(--text);
  transition: filter 0.15s;
}

.quick-card:active {
  filter: brightness(1.1);
}

.q-ico {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: var(--radius);
}

.q-text {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.q-text strong {
  font-size: 1.1rem;
}

.q-text small {
  font-size: 0.85rem;
  line-height: 1.3;
}

.q-go {
  flex: none;
}

/* Mantenimiento: naranja sólido con texto oscuro (contraste ≥ 7:1). */
.maint {
  border-color: var(--maint);
  background: var(--maint);
  color: var(--maint-ink);
}

.maint .q-ico {
  background: color-mix(in srgb, var(--maint-ink) 14%, transparent);
}

.maint small {
  color: color-mix(in srgb, var(--maint-ink) 82%, transparent);
}

.welcome {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--surface-grad);
}

.welcome .q-ico {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.welcome small {
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .quick {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ------------------------------------------------------------ Estado global */
.hero {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 1rem;
  margin-bottom: var(--gap);
  border-radius: calc(var(--radius) + 4px);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, var(--border));
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 14%, transparent), transparent 55%),
    linear-gradient(180deg, var(--surface-2), var(--surface));
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
  gap: 0.15rem;
}

.hero-text h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.hero-text p {
  color: var(--text-muted);
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-text .hero-id {
  color: var(--text-faint);
  font-size: 0.78rem;
}

.more {
  margin-left: 0.35rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text-muted);
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
  font-size: 0.95rem;
  color: var(--text);
  white-space: nowrap;
}

.toned {
  color: var(--tone) !important;
  font-weight: 700;
}

/* ------------------------------------------------------------ Medidores */
.trends {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap);
  margin-top: var(--gap);
}

.trends.n-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.trends.n-1 {
  grid-template-columns: minmax(0, 1fr);
}

/* 4 medidores en la Pi; 3 o 2 donde la plataforma no da temperatura o carga (Android, Windows, macOS). */
.gauges {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gap);
}

.gauges.n-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.gauges.n-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* ------------------------------------------------------------ Secciones */
.sec {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.05rem 0 0.55rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.sec::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border), transparent);
}

.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gap);
  align-items: stretch;
}

.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.75rem 0.9rem 0.85rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-2), var(--surface) 70%);
  overflow: hidden;
}

/* Filo superior con el tono del panel. */
.panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(90deg, var(--tone), transparent 80%);
  opacity: 0.85;
}

.ph {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.ph h3 {
  flex: 1;
  font-size: 1rem;
  font-weight: 700;
}

.ph-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}

.figure {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.1rem 0 0.2rem;
}

.figure .num {
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--text);
}

.figure .num.sm {
  font-size: 1.35rem;
}

.figure .unit {
  font-size: 1rem;
  color: var(--text-muted);
}

.figure .cap {
  flex-basis: 100%;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  line-height: 1.25;
  color: var(--tone);
  border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  background: color-mix(in srgb, var(--tone) 10%, transparent);
}

.small {
  font-size: 0.875rem;
}

/* Almacenamiento */
.mount {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mount-row {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.875rem;
}

/* Rutas largas (Android: /storage/emulated/0/Android/data/…) se cortan en vez de ensanchar la tarjeta. */
.mount-row .mono {
  min-width: 0;
  overflow-wrap: anywhere;
}

.meter {
  height: 0.5rem;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 65%, var(--surface-3)), var(--tone));
  transition: width 0.5s ease-out;
}

.cap-line {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.counters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.35rem;
}

.counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.35rem 0.2rem;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--tone) 8%, var(--surface-3));
}

.counter span {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--tone);
}

.counter small {
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* Servicios */
.units {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.units li {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.2rem;
  border-bottom: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
  font-size: 0.875rem;
}

.units li:last-child {
  border-bottom: none;
}

.dot {
  flex: none;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
}

.unit-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unit-state {
  flex: none;
  color: var(--tone);
  font-weight: 700;
}

.unit-state small {
  color: var(--text-faint);
  font-weight: 400;
}

/* ------------------------------------------------------------ Control */
.control {
  padding: 0.8rem 0.9rem 0.9rem;
  border-radius: calc(var(--radius) + 4px);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
}

.control-note {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin-bottom: 0.7rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.control-note svg {
  flex: none;
  margin-top: 0.05rem;
  color: var(--info);
}

/* Cada grupo en una fila: los botones se reparten el ancho a partes iguales (2 o 3, según el equipo). */
.ctl-row {
  display: flex;
  gap: var(--gap);
  align-items: stretch;
}

.ctl-row + .ctl-row {
  margin-top: var(--gap);
}

.ctl-row > .ctl {
  flex: 1 1 0;
  min-width: 0;
}

.ctl-group {
  align-self: center;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.ctl {
  --tone: var(--accent);
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 4rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  text-align: left;
  cursor: pointer;
}

.ctl svg {
  flex: none;
  color: var(--tone);
}

.ctl span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ctl strong {
  font-size: 0.95rem;
  line-height: 1.2;
}

.ctl small {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.25;
}

.ctl:active {
  background: var(--surface-3);
  border-color: var(--tone);
}

/* El --tone por defecto de .ctl (acento) ganaría a .tone-*: se reasigna aquí. */
.ctl.tone-warn {
  --tone: var(--warn);
}

.ctl.tone-danger {
  --tone: var(--danger);
}

.ctl-danger {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  background: color-mix(in srgb, var(--danger) 16%, var(--surface-2));
}

.ctl-danger:active {
  background: color-mix(in srgb, var(--danger) 28%, var(--surface-2));
}

.action-msg {
  margin-top: 0.7rem;
  color: var(--tone);
  font-weight: 700;
}

/* Móvil y ventanas estrechas: la cabecera de estado se apila (los datos bajan a su propia fila). */
@media (max-width: 640px) {
  .hero {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .hero-text {
    flex: 1 1 12rem;
  }

  .hero-text p {
    white-space: normal;
  }

  .hero-stats {
    flex: 1 1 100%;
    padding-top: 0.5rem;
    border-top: 1px solid var(--hairline);
  }

  .hero-stats div:first-child {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }

  .gauges,
  .gauges.n-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* Número impar de medidores: el último ocupa la fila entera (sin hueco). */
  .gauges > :last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .trends,
  .trends.n-2 {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Estrecho: etiqueta del grupo arriba y botones uno por fila. */
  .ctl-row {
    flex-direction: column;
  }

  .ctl-group {
    writing-mode: horizontal-tb;
    transform: none;
    align-self: flex-start;
  }
}
</style>
