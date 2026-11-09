<script setup lang="ts">
import { Bot, Clock, Download, HardDriveDownload, Library, Map as MapIcon, Satellite, Trash2, TriangleAlert, Usb, Wifi, WifiOff, Wrench } from '@lucide/vue'
import type { AssistantStatus, LibraryStatus, MapPackage, UsbFile, UsbScan } from '@survival-os/shared-types'
import { formatBytes, formatClock, formatDate } from '~/utils/format'
import { LLM_MODELS } from '~/utils/llm'

const t = useT()
const router = useRouter()
const { status, refresh: refreshDevice } = useDeviceStatus()
const now = useNow()

const library = ref<LibraryStatus | null>(null)
const maps = ref<MapPackage[]>([])
async function loadData(): Promise<void> {
  ;[library.value, maps.value] = await Promise.all([
    $fetch<LibraryStatus>('/api/library/status', { timeout: 8000, retry: 0 }).catch(() => null),
    $fetch<MapPackage[]>('/api/maps', { timeout: 5000, retry: 0 }).catch(() => []),
  ])
}
onMounted(loadData)

// ---- Asistente (modelo local)
const assistant = ref<AssistantStatus | null>(null)
async function loadAssistant(): Promise<void> {
  assistant.value = await $fetch<AssistantStatus>('/api/library/ask/status', { timeout: 5000, retry: 0 }).catch(() => null)
}
const llmJob = useAdminJob('llm', () => setTimeout(() => void loadAssistant(), 3000))
onMounted(loadAssistant)
const isInstalled = (file: string): boolean => !!assistant.value?.installed.some((m) => m.file === file)

// ---- Red
const wifiJob = useAdminJob('wifi', () => void refreshDevice())
const radio = computed(() => (status.value?.network.state === 'ok' ? status.value.network.value.wifiRadio : null))
const online = computed(() => status.value?.network.state === 'ok' && status.value.network.value.mode === 'local')

// ---- Hora
const timeJob = useAdminJob('set-time', () => void refreshDevice())
const dateInput = ref('')
const timeInput = ref('')
function fillNow(): void {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  timeInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
onMounted(fillNow)
const timeSource = computed(() => (status.value?.time.state === 'ok' ? status.value.time.value.source : null))

// ---- Contenidos
const PRESETS = [
  { id: 'basico', size: '0,3 GB' },
  { id: 'recomendado', size: '18 GB' },
  { id: 'completo', size: '42 GB' },
] as const
const contentJob = useAdminJob('content-fetch', () => void loadData())
const deleteZimJob = useAdminJob('content-delete', () => void loadData())
let libTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  // Progreso de descargas (también las iniciadas fuera de la UI): cada 5 s mientras haya .part.
  libTimer = setInterval(() => {
    if (!document.hidden && (library.value?.zim?.downloads.length || contentJob.running.value)) void loadData()
  }, 5000)
})
onBeforeUnmount(() => libTimer && clearInterval(libTimer))

// ---- USB, mapas, documentos, copias, actualización
const scanJob = useAdminJob('usb-scan')
const scan = computed(() => (scanJob.status.value?.data as UsbScan | null) ?? null)
const filesOf = (kind: UsbFile['kind']): UsbFile[] => scan.value?.files.filter((f) => f.kind === kind) ?? []
const selectedDocs = ref<string[]>([])
const mapImportJob = useAdminJob('maps-import', () => void loadData())
const mapDeleteJob = useAdminJob('maps-delete', () => void loadData())
const docsJob = useAdminJob('docs-import')
const backupJob = useAdminJob('backup')
const updateJob = useAdminJob('update')
const backupMedia = ref('')
const withMaps = ref(false)
const withZim = ref(false)

// ---- GPS en GPIO
const gpsJob = useAdminJob('gps-uart')
const baud = ref(9600)
const usePps = ref(false)
const ppsGpio = ref(18)

// ---- Confirmaciones
type Pending = { title: string; body: string; label: string; run: () => Promise<void> }
const pending = ref<Pending | null>(null)
async function confirm(): Promise<void> {
  const p = pending.value
  pending.value = null
  await p?.run()
}

const key = (f: UsbFile): string => `${f.media}::${f.path}`

// ---- Presentación: secciones con pestañas fijas (solo navegación visual, sin efectos en el equipo).
const SECTIONS = ['net', 'content', 'usb', 'hw'] as const
type SectionId = (typeof SECTIONS)[number]
const pageEl = ref<HTMLElement | null>(null)
const activeSection = ref<SectionId>('net')
function goTo(id: SectionId): void {
  activeSection.value = id
  document.getElementById(`mnt-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
let sectionObserver: IntersectionObserver | undefined
onMounted(() => {
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.sec as SectionId | undefined
        if (e.isIntersecting && id) activeSection.value = id
      }
    },
    { root: pageEl.value, rootMargin: '-25% 0px -65% 0px' },
  )
  for (const id of SECTIONS) {
    const el = document.getElementById(`mnt-${id}`)
    if (el) sectionObserver.observe(el)
  }
})
onBeforeUnmount(() => sectionObserver?.disconnect())

const interfaces = computed(() =>
  status.value?.network.state === 'ok' ? status.value.network.value.interfaces.filter((i) => i.up || i.ipv4.length) : [],
)
const activeModel = computed(() => LLM_MODELS.find((m) => m.file === assistant.value?.active) ?? null)

// ---- Esquema GPIO (pines 1–12; impares a la izquierda). Nombres técnicos del conector, no textos de UI.
type PinRole = 'vcc' | 'v5' | 'gnd' | 'tx' | 'rx' | 'pps' | null
const PINS: { n: number; name: string; role: PinRole }[] = [
  { n: 1, name: '3V3', role: 'vcc' },
  { n: 2, name: '5V', role: 'v5' },
  { n: 3, name: 'GPIO2', role: null },
  { n: 4, name: '5V', role: 'v5' },
  { n: 5, name: 'GPIO3', role: null },
  { n: 6, name: 'GND', role: 'gnd' },
  { n: 7, name: 'GPIO4', role: null },
  { n: 8, name: 'GPIO14', role: 'rx' },
  { n: 9, name: 'GND', role: null },
  { n: 10, name: 'GPIO15', role: 'tx' },
  { n: 11, name: 'GPIO17', role: null },
  { n: 12, name: 'GPIO18', role: 'pps' },
]
const PIN_ROWS = Array.from({ length: PINS.length / 2 }, (_, i) => [PINS[i * 2]!, PINS[i * 2 + 1]!] as const)
const PIN_LEGEND = [
  { role: 'vcc', detail: 'mnt.gps.vcc' },
  { role: 'v5', detail: 'ui.mnt.pin.v5.detail' },
  { role: 'gnd', detail: 'mnt.gps.gnd' },
  { role: 'tx', detail: 'mnt.gps.tx' },
  { role: 'rx', detail: 'mnt.gps.rx' },
  { role: 'pps', detail: 'mnt.gps.pps' },
] as const
</script>

<template>
  <div ref="pageEl" class="page">
    <PageHeader :title="t('mnt.title')" :icon="Wrench">
      <button type="button" class="btn back" @click="router.push('/sistema')">{{ t('mnt.back') }}</button>
    </PageHeader>

    <!-- Resumen: cada baldosa lleva a su sección. -->
    <div class="overview">
      <button type="button" class="ov" :class="`tone-${radio === 'enabled' ? (online ? 'ok' : 'info') : 'muted'}`" @click="goTo('net')">
        <span class="ov-icon"><component :is="radio === 'disabled' ? WifiOff : Wifi" :size="20" aria-hidden="true" /></span>
        <span class="ov-text">
          <small>{{ t('ui.mnt.ov.net') }}</small>
          <strong>{{ radio === 'enabled' ? t('mnt.net.on') : radio === 'disabled' ? t('mnt.net.off') : t('state.unknown') }}</strong>
          <span>{{ online ? t('bar.net.local') : t('bar.net.offline') }}</span>
        </span>
      </button>
      <button type="button" class="ov" :class="`tone-${timeSource === 'unverified' || !timeSource ? 'warn' : 'ok'}`" @click="goTo('net')">
        <span class="ov-icon"><Clock :size="20" aria-hidden="true" /></span>
        <span class="ov-text">
          <small>{{ t('ui.mnt.ov.time') }}</small>
          <strong class="mono">{{ formatClock(now) }}</strong>
          <span>{{ timeSource ? t(`sys.time.source.${timeSource}` as never) : t('state.unavailable') }}</span>
        </span>
      </button>
      <button type="button" class="ov" :class="`tone-${library?.zim?.downloads.length ? 'info' : library?.zim?.installed.length ? 'ok' : 'muted'}`" @click="goTo('content')">
        <span class="ov-icon"><Library :size="20" aria-hidden="true" /></span>
        <span class="ov-text">
          <small>{{ t('ui.mnt.ov.content') }}</small>
          <strong>{{ t('lib.books.count', { n: library?.zim?.installed.length ?? 0 }) }}</strong>
          <span>{{ library?.zim?.downloads.length ? t('ui.mnt.downloading', { n: library?.zim?.downloads.length }) : t('summary.maps.count', { n: maps.length }) }}</span>
        </span>
      </button>
      <button type="button" class="ov" :class="`tone-${assistant?.available ? 'ok' : assistant?.active ? 'info' : 'muted'}`" @click="goTo('content')">
        <span class="ov-icon"><Bot :size="20" aria-hidden="true" /></span>
        <span class="ov-text">
          <small>{{ t('ui.mnt.ov.llm') }}</small>
          <strong>{{ assistant?.available ? t('mnt.llm.on') : assistant?.active ? t('mnt.llm.loading') : t('mnt.llm.off') }}</strong>
          <span>{{ activeModel ? t(`mnt.llm.${activeModel.id}` as never) : '—' }}</span>
        </span>
      </button>
    </div>

    <!-- Pestañas fijas de sección. -->
    <nav class="tabs" :aria-label="t('mnt.title')">
      <button
        v-for="sec in SECTIONS" :key="sec" type="button" class="tab"
        :aria-current="activeSection === sec ? 'true' : undefined" @click="goTo(sec)"
      >
        {{ t(`ui.mnt.sec.${sec}`) }}
      </button>
    </nav>

    <!-- ============================================================ Red y hora -->
    <section id="mnt-net" data-sec="net" class="mnt-sec">
      <h2 class="ui-sec">{{ t('ui.mnt.sec.net') }}</h2>
      <div class="bento">
        <AppCard
          :title="t('mnt.net')" :icon="radio === 'disabled' ? WifiOff : Wifi" :tone="radio === 'enabled' ? 'info' : 'muted'"
          :pill="radio === 'enabled' ? t('mnt.net.on') : radio === 'disabled' ? t('mnt.net.off') : t('state.unknown')"
        >
          <div v-if="interfaces.length" class="ifaces">
            <div v-for="i in interfaces" :key="i.name" class="ui-row iface" :class="`tone-${i.up && i.ipv4.length ? 'ok' : 'muted'}`">
              <span class="dot" aria-hidden="true" />
              <span class="grow">
                <strong class="mono">{{ i.name }}</strong>
                <template v-if="i.connection"> · {{ i.connection }}</template>
              </span>
              <span class="mono muted">{{ i.ipv4[0] ?? t('ui.mnt.noIp') }}</span>
            </div>
          </div>
          <p>{{ t('mnt.net.note') }}</p>
          <button v-if="radio !== 'disabled'" type="button" class="btn" :disabled="wifiJob.running.value" @click="pending = { title: t('mnt.net.offConfirm'), body: t('mnt.net.offBody'), label: t('mnt.net.turnOff'), run: () => wifiJob.start({ state: 'off' }) }">
            <WifiOff :size="18" /> {{ t('mnt.net.turnOff') }}
          </button>
          <button v-else type="button" class="btn btn-primary" :disabled="wifiJob.running.value" @click="wifiJob.start({ state: 'on' })">
            <Wifi :size="18" /> {{ t('mnt.net.turnOn') }}
          </button>
          <JobLog :status="wifiJob.status.value" :error="wifiJob.error.value" :lines="2" />
        </AppCard>

        <AppCard :title="t('mnt.time')" :icon="Clock" :tone="timeSource === 'unverified' ? 'warn' : 'ok'">
          <div class="ui-figure">
            <span class="num mono">{{ formatClock(now) }}</span>
            <span v-if="timeSource" class="ui-chip" :class="`tone-${timeSource === 'unverified' ? 'warn' : 'ok'}`">{{ t(`sys.time.source.${timeSource}` as never) }}</span>
            <span class="cap">{{ formatDate(now) }}</span>
          </div>
          <p>{{ t('mnt.time.note') }}</p>
          <div class="row2">
            <input v-model="dateInput" type="date" class="ui-field grow" />
            <input v-model="timeInput" type="time" class="ui-field" />
          </div>
          <button
            type="button" class="btn" :disabled="!dateInput || !timeInput || timeJob.running.value"
            @click="pending = { title: t('mnt.time.confirm'), body: `${dateInput} ${timeInput}`, label: t('mnt.time.set'), run: () => timeJob.start({ iso: `${dateInput} ${timeInput}` }) }"
          >
            <Clock :size="18" /> {{ t('mnt.time.set') }}
          </button>
          <JobLog :status="timeJob.status.value" :error="timeJob.error.value" :lines="2" />
        </AppCard>
      </div>
    </section>

    <!-- ============================================================ Contenidos -->
    <section id="mnt-content" data-sec="content" class="mnt-sec">
      <h2 class="ui-sec">{{ t('ui.mnt.sec.content') }}</h2>
      <div class="bento">
        <AppCard
          :title="t('mnt.content')" :icon="Library" :tone="library?.zim?.installed.length ? 'ok' : 'muted'"
          :pill="t('lib.books.count', { n: library?.zim?.installed.length ?? 0 })"
        >
          <p v-if="!online" class="notice tone-warn small-notice"><WifiOff :size="16" aria-hidden="true" />{{ t('mnt.content.offline') }}</p>
          <div v-for="p in PRESETS" :key="p.id" class="opt">
            <span class="size mono">{{ p.size }}</span>
            <span class="grow">
              <strong>{{ t(`mnt.preset.${p.id}` as never) }}</strong>
              <small>{{ t(`mnt.preset.${p.id}.desc` as never) }}</small>
            </span>
            <button
              type="button" class="btn icon-btn" :aria-label="t('mnt.content.download')" :disabled="contentJob.running.value || !online"
              @click="pending = { title: t('mnt.content.confirm'), body: t('mnt.content.confirmBody', { size: p.size }), label: t('mnt.content.download'), run: () => contentJob.start({ preset: p.id }) }"
            >
              <Download :size="20" />
            </button>
          </div>
          <div v-for="d in library?.zim?.downloads ?? []" :key="d.file" class="ui-row dl tone-info">
            <Download :size="16" class="dl-icon" aria-hidden="true" />
            <span class="grow mono">{{ d.file }}</span>
            <span class="muted">{{ t('mnt.content.downloading', { size: formatBytes(d.bytes) }) }}</span>
          </div>
          <button v-if="contentJob.running.value" type="button" class="btn btn-danger" @click="contentJob.stop()">{{ t('mnt.content.stop') }}</button>
          <JobLog :status="contentJob.status.value" :error="contentJob.error.value" :lines="3" />
          <template v-if="library?.zim?.installed.length">
            <p class="sub">{{ t('mnt.content.installed') }}</p>
            <div v-for="z in library?.zim?.installed ?? []" :key="z.file" class="ui-row">
              <span class="grow">{{ z.title ?? z.file }} <span class="faint">· {{ formatBytes(z.sizeBytes) }}<template v-if="z.version"> · {{ z.version }}</template><template v-if="z.license"> · {{ z.license }}</template></span></span>
              <button
                type="button" class="btn icon-btn" :aria-label="t('nav.delete')" :disabled="deleteZimJob.running.value"
                @click="pending = { title: t('nav.delete.title'), body: t('nav.delete.body', { name: z.title ?? z.file }), label: t('nav.delete'), run: () => deleteZimJob.start({ file: z.file }) }"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </template>
          <JobLog :status="deleteZimJob.status.value" :error="deleteZimJob.error.value" :lines="2" />
        </AppCard>

        <AppCard
          :title="t('mnt.llm')" :icon="Bot" :tone="assistant?.available ? 'ok' : 'muted'"
          :pill="assistant?.available ? t('mnt.llm.on') : assistant?.active ? t('mnt.llm.loading') : t('mnt.llm.off')"
        >
          <p>{{ t('mnt.llm.note') }}</p>
          <div v-for="m in LLM_MODELS" :key="m.id" class="opt model" :class="{ current: assistant?.active === m.file }">
            <span class="grow">
              <strong>{{ t(`mnt.llm.${m.id}` as never) }}</strong>
              <small>{{ t(`mnt.llm.${m.id}.desc` as never) }}</small>
              <span class="meta">
                <span class="ui-chip">{{ m.size }}</span>
                <span class="ui-chip">{{ m.license }}</span>
                <span v-if="assistant?.active === m.file" class="ui-chip tone-ok">{{ t('mnt.llm.active') }}</span>
                <span v-else-if="isInstalled(m.file)" class="ui-chip tone-info">{{ t('ui.mnt.installed') }}</span>
              </span>
            </span>
            <span class="opt-actions">
              <button
                type="button" class="btn" :class="{ 'btn-primary': isInstalled(m.file) && assistant?.active !== m.file }"
                :disabled="llmJob.running.value || assistant?.active === m.file || (!isInstalled(m.file) && !online)"
                @click="pending = { title: t('mnt.llm.confirm'), body: isInstalled(m.file) ? t('mnt.llm.confirmUse') : t('mnt.llm.confirmBody', { size: m.size }), label: isInstalled(m.file) ? t('mnt.llm.use') : t('mnt.content.download'), run: () => llmJob.start({ action: 'install', model: m.id }) }"
              >
                {{ isInstalled(m.file) ? t('mnt.llm.use') : t('mnt.content.download') }}
              </button>
              <button
                v-if="isInstalled(m.file)" type="button" class="btn icon-btn" :aria-label="t('nav.delete')" :disabled="llmJob.running.value"
                @click="pending = { title: t('nav.delete.title'), body: t('nav.delete.body', { name: m.file }), label: t('nav.delete'), run: () => llmJob.start({ action: 'remove', model: m.id }) }"
              >
                <Trash2 :size="16" />
              </button>
            </span>
          </div>
          <div class="row2">
            <button v-if="assistant?.active" type="button" class="btn grow" :disabled="llmJob.running.value" @click="llmJob.start({ action: 'disable' })">{{ t('mnt.llm.disable') }}</button>
            <NuxtLink v-if="assistant?.available" to="/biblioteca/preguntar" class="btn btn-primary grow">{{ t('ask.title') }}</NuxtLink>
          </div>
          <JobLog :status="llmJob.status.value" :error="llmJob.error.value" :lines="4" />
        </AppCard>

        <!-- Rutas sin conexión (ADR 0010) -->
        <RoutingCard :online="online" />

        <AppCard class="span-all" :title="t('mnt.maps')" :icon="MapIcon" :tone="maps.length ? 'ok' : 'muted'" :pill="t('summary.maps.count', { n: maps.length })">
          <div v-for="m in maps" :key="m.file" class="ui-row">
            <MapIcon :size="16" class="faint" aria-hidden="true" />
            <span class="grow">{{ m.title }} <span class="faint">· {{ formatBytes(m.sizeBytes) }} · {{ t('maps.dataDate', { date: m.dataDate ?? '?' }) }}</span></span>
            <button
              type="button" class="btn icon-btn" :aria-label="t('nav.delete')"
              @click="pending = { title: t('nav.delete.title'), body: t('nav.delete.body', { name: m.title }), label: t('nav.delete'), run: () => mapDeleteJob.start({ file: m.file }) }"
            >
              <Trash2 :size="16" />
            </button>
          </div>
          <p class="faint">{{ t('mnt.maps.note') }}</p>
          <JobLog :status="mapImportJob.status.value" :error="mapImportJob.error.value" :lines="3" />
          <JobLog :status="mapDeleteJob.status.value" :error="mapDeleteJob.error.value" :lines="2" />
        </AppCard>
      </div>
    </section>

    <!-- ============================================================ USB y copias -->
    <section id="mnt-usb" data-sec="usb" class="mnt-sec">
      <h2 class="ui-sec">{{ t('ui.mnt.sec.usb') }}</h2>
      <div class="bento">
        <AppCard :title="t('mnt.usb')" :icon="Usb" :tone="scan?.media.length ? 'info' : 'muted'">
          <button type="button" class="btn btn-primary" :disabled="scanJob.running.value" @click="scanJob.start()">
            <Usb :size="18" /> {{ scanJob.running.value ? t('state.loading') : t('mnt.usb.scan') }}
          </button>
          <template v-if="scan">
            <p v-if="!scan.media.length">{{ t('mnt.usb.none') }}</p>
            <div v-if="scan.media.length" class="media">
              <span v-for="m in scan.media" :key="m.media" class="ui-chip tone-info"><Usb :size="14" aria-hidden="true" />{{ m.media }} · {{ t('vault.free', { free: formatBytes(m.freeBytes) }) }}</span>
            </div>

            <p v-if="filesOf('map').length" class="sub">{{ t('mnt.usb.maps') }}</p>
            <div v-for="f in filesOf('map')" :key="key(f)" class="ui-row">
              <span class="grow mono">{{ f.path }} <span class="faint">· {{ formatBytes(f.sizeBytes) }}</span></span>
              <button type="button" class="btn" :disabled="mapImportJob.running.value" @click="mapImportJob.start({ media: f.media, path: f.path })">{{ t('mnt.usb.import') }}</button>
            </div>

            <p v-if="filesOf('doc').length" class="sub">{{ t('mnt.usb.docs') }}</p>
            <label v-for="f in filesOf('doc')" :key="key(f)" class="ui-row check">
              <input v-model="selectedDocs" type="checkbox" :value="key(f)" />
              <span class="grow mono">{{ f.path }} <span class="faint">· {{ formatBytes(f.sizeBytes) }}</span></span>
            </label>
            <button
              v-if="filesOf('doc').length" type="button" class="btn" :disabled="!selectedDocs.length || docsJob.running.value"
              @click="docsJob.start({ items: selectedDocs.map((k) => ({ media: k.split('::')[0], path: k.split('::')[1] })) })"
            >
              {{ t('mnt.usb.importDocs', { n: selectedDocs.length }) }}
            </button>
            <JobLog :status="docsJob.status.value" :error="docsJob.error.value" :lines="3" />

            <p v-if="filesOf('release').length" class="sub">{{ t('mnt.usb.releases') }}</p>
            <div v-for="f in filesOf('release')" :key="key(f)" class="ui-row">
              <span class="grow mono">{{ f.path }}</span>
              <button
                type="button" class="btn btn-danger" :disabled="updateJob.running.value"
                @click="pending = { title: t('mnt.update.confirm'), body: t('mnt.update.body', { file: f.path }), label: t('mnt.update.go'), run: () => updateJob.start({ media: f.media, path: f.path }) }"
              >
                {{ t('mnt.update.go') }}
              </button>
            </div>
            <JobLog :status="updateJob.status.value" :error="updateJob.error.value" :lines="4" />
          </template>
          <JobLog :status="scanJob.status.value?.state === 'failed' ? scanJob.status.value : null" :error="scanJob.error.value" :lines="3" />
        </AppCard>

        <AppCard :title="t('mnt.backup')" :icon="HardDriveDownload" tone="info">
          <p>{{ t('mnt.backup.note') }}</p>
          <select v-model="backupMedia" class="ui-field">
            <option value="" disabled>{{ scan?.media.length ? t('mnt.backup.choose') : t('mnt.backup.scanFirst') }}</option>
            <option v-for="m in scan?.media ?? []" :key="m.media" :value="m.media">{{ m.media }} ({{ formatBytes(m.freeBytes) }})</option>
          </select>
          <label class="ui-row check"><input v-model="withMaps" type="checkbox" /> {{ t('mnt.backup.maps') }}</label>
          <label class="ui-row check"><input v-model="withZim" type="checkbox" /> {{ t('mnt.backup.zim') }}</label>
          <button
            type="button" class="btn btn-primary" :disabled="!backupMedia || backupJob.running.value"
            @click="backupJob.start({ media: backupMedia, withMaps, withZim })"
          >
            <HardDriveDownload :size="18" /> {{ t('mnt.backup.go') }}
          </button>
          <JobLog :status="backupJob.status.value" :error="backupJob.error.value" :lines="4" />
        </AppCard>
      </div>
    </section>

    <!-- ============================================================ Hardware -->
    <section id="mnt-hw" data-sec="hw" class="mnt-sec">
      <h2 class="ui-sec">{{ t('ui.mnt.sec.hw') }}</h2>
      <AppCard :title="t('mnt.gps')" :icon="Satellite" tone="muted">
        <div class="notice tone-danger"><TriangleAlert :size="18" aria-hidden="true" /><span>{{ t('mnt.gps.voltage') }}</span></div>
        <div class="gps">
          <!-- Esquema de los pines 1–12 del conector GPIO (impares a la izquierda). -->
          <div class="header-map" role="img" :aria-label="t('mnt.gps')">
            <template v-for="r in PIN_ROWS" :key="r[0].n">
              <span class="pin-name left" :class="r[0].role ? `role-${r[0].role}` : ''">{{ r[0].name }}</span>
              <span class="pin" :class="r[0].role ? `role-${r[0].role}` : ''">{{ r[0].n }}</span>
              <span class="pin" :class="r[1].role ? `role-${r[1].role}` : ''">{{ r[1].n }}</span>
              <span class="pin-name" :class="r[1].role ? `role-${r[1].role}` : ''">{{ r[1].name }}</span>
            </template>
          </div>
          <div class="gps-side">
            <ul class="legend">
              <li v-for="l in PIN_LEGEND" :key="l.role" :class="`role-${l.role}`">
                <span class="swatch" aria-hidden="true" />
                <span class="grow"><strong>{{ t(`ui.mnt.pin.${l.role}`) }}</strong><small>{{ t(l.detail) }}</small></span>
              </li>
            </ul>
            <div class="row2">
              <select v-model.number="baud" class="ui-field">
                <option v-for="b in [4800, 9600, 19200, 38400, 57600, 115200]" :key="b" :value="b">{{ t('ui.mnt.baud', { n: b }) }}</option>
              </select>
              <label class="check"><input v-model="usePps" type="checkbox" /> {{ t('ui.mnt.ppsGpio') }} <input v-model.number="ppsGpio" type="number" min="2" max="27" class="ui-field small" :disabled="!usePps" /></label>
            </div>
            <div class="row2">
              <button
                type="button" class="btn btn-primary grow" :disabled="gpsJob.running.value"
                @click="pending = { title: t('mnt.gps.confirm'), body: t('mnt.gps.confirmBody'), label: t('mnt.gps.enable'), run: () => gpsJob.start({ action: 'enable', baud, pps: usePps ? ppsGpio : null }) }"
              >
                <Satellite :size="18" /> {{ t('mnt.gps.enable') }}
              </button>
              <button type="button" class="btn" :disabled="gpsJob.running.value" @click="gpsJob.start({ action: 'disable' })">{{ t('mnt.gps.disable') }}</button>
            </div>
            <JobLog :status="gpsJob.status.value" :error="gpsJob.error.value" :lines="4" />
          </div>
        </div>
      </AppCard>
    </section>

    <ConfirmDialog v-if="pending" :title="pending.title" :message="pending.body" :confirm-label="pending.label" danger @confirm="confirm" @cancel="pending = null" />
  </div>
</template>

<style scoped>
.back {
  margin-left: auto;
  min-height: 2.75rem; /* ≥ 44 px táctil */
}

/* ------------------------------------------------------------ Resumen */
.overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gap);
}

.ov {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 4.2rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--border));
  background:
    linear-gradient(110deg, color-mix(in srgb, var(--tone) 11%, transparent), transparent 60%),
    var(--surface-grad);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.ov:active {
  transform: scale(0.98);
}

.ov-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 15%, transparent);
}

.ov-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.ov-text small {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.ov-text strong {
  font-size: 1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ov-text span {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ------------------------------------------------------------ Pestañas fijas */
.tabs {
  position: sticky;
  /* .page tiene 0,75rem de relleno superior: se compensa para que no asome contenido por encima. */
  top: -0.75rem;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.3rem;
  margin: -0.15rem -0.875rem 0;
  padding: 1.15rem 0.875rem 0.4rem;
  background: linear-gradient(180deg, var(--bg) 80%, transparent);
}

.tab {
  min-height: 2.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.tab[aria-current='true'] {
  color: var(--accent-ink);
  border-color: var(--accent);
  background: var(--accent);
}

.mnt-sec {
  scroll-margin-top: 3.4rem;
}

/* ------------------------------------------------------------ Rejillas */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
  gap: var(--gap);
  align-items: start;
}

.span-all {
  grid-column: 1 / -1;
}

.row2 {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.ui-field.small {
  width: 4.5rem;
}

.icon-btn {
  min-width: var(--touch);
  padding: 0 0.6rem;
}

.sub {
  margin-top: 0.3rem;
  font-size: 0.72rem !important;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint) !important;
}

.faint {
  font-size: 0.8rem;
}

.small-notice {
  padding: 0.45rem 0.7rem;
  font-size: 0.85rem;
  color: var(--text) !important;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--touch);
  cursor: pointer;
}

.check input[type='checkbox'] {
  width: 1.5rem;
  height: 1.5rem;
  accent-color: var(--accent);
}

/* ------------------------------------------------------------ Red */
.ifaces {
  display: flex;
  flex-direction: column;
}

.iface {
  font-size: 0.875rem;
  min-height: 2.75rem; /* ≥ 44 px táctil */
}

.dot {
  flex: none;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
}

/* ------------------------------------------------------------ Opciones (paquetes, modelos) */
.opt {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-3) 35%, transparent);
}

.opt .grow {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.92rem;
}

.opt small {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.size {
  flex: none;
  min-width: 4.4rem;
  padding: 0.35rem 0.4rem;
  border-radius: var(--radius-sm);
  text-align: center;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.model.current {
  border-color: color-mix(in srgb, var(--ok) 60%, var(--border));
  background: color-mix(in srgb, var(--ok) 8%, transparent);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.opt-actions {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.dl {
  font-size: 0.85rem;
}

.dl-icon {
  flex: none;
  color: var(--info);
}

.media {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

/* ------------------------------------------------------------ GPS */
.gps {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1.2rem;
  align-items: start;
}

.header-map {
  display: grid;
  grid-template-columns: 4.6rem 2.1rem 2.1rem 4.6rem;
  gap: 0.3rem 0.35rem;
  align-items: center;
  padding: 0.7rem 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: color-mix(in srgb, #1d3b2b 55%, var(--bg));
}

.pin {
  --role: var(--surface-3);
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-faint);
  background: var(--surface-2);
  border: 2px solid var(--role);
}

.pin[class*='role-'] {
  color: var(--accent-ink);
  background: var(--role);
}

.pin-name {
  --role: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.pin-name.left {
  text-align: right;
}

.pin-name[class*='role-'] {
  color: var(--role);
  font-weight: 700;
}

.role-vcc { --role: var(--warn); }
.role-v5 { --role: var(--danger); }
.role-gnd { --role: #b9b4a6; }
.role-tx { --role: var(--info); }
.role-rx { --role: var(--ok); }
.role-pps { --role: #c7a6e0; }

.gps-side {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.5rem;
  border-bottom: 1px solid var(--hairline);
}

.legend li:last-child {
  border-bottom: none;
}

.legend .grow {
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
}

.legend small {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.swatch {
  flex: none;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  background: var(--role);
}

@media (max-width: 760px) {
  .overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gps {
    grid-template-columns: 1fr;
  }
}
</style>
