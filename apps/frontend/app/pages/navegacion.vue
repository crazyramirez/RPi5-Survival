<script setup lang="ts">
import {
  Circle,
  Compass,
  Download,
  FileUp,
  Flag,
  Loader,
  LocateFixed,
  LocateOff,
  MapPin,
  Navigation,
  RadioTower,
  Route,
  Satellite,
  Square,
  Target,
  Trash2,
  Unplug,
} from '@lucide/vue'
import type { TrackSummary, Waypoint } from '@survival-os/shared-types'
import type { Tone } from '~/utils/alerts'
import { toDms } from '~/utils/coords'
import { formatAge, formatDate, formatNumber } from '~/utils/format'
import { bearingDeg, cardinal, distanceM, formatDistance, WAYPOINT_COLORS } from '~/utils/waypoints'

const t = useT()
const { nav, navDown, refreshNav } = useNav()
const gnss = computed(() => nav.value?.gnss)
const fallback = computed(() => (nav.value?.fallback?.state === 'ok' ? nav.value.fallback.value : null))
const g = computed(() => (gnss.value?.state === 'ok' ? gnss.value.value : null))
const hasPos = computed(() => !!g.value && g.value.fix !== 'none' && g.value.latitude !== null && g.value.longitude !== null)

const waypoints = ref<Waypoint[]>([])
const tracks = ref<TrackSummary[]>([])
const targetId = useState<string | null>('nav:target', () => null)
const message = ref<{ tone: 'ok' | 'danger'; text: string } | null>(null)
const pendingDelete = ref<{ kind: 'wp' | 'track'; id: string; name: string } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const fixLabel = computed(() => (!g.value ? '—' : g.value.fix === 'none' ? t('nav.fix.none') : g.value.fix.toUpperCase()))

const target = computed(() => waypoints.value.find((w) => w.id === targetId.value) ?? null)
const toTarget = computed(() => {
  if (!target.value || !hasPos.value || !g.value) return null
  const d = distanceM(g.value.latitude!, g.value.longitude!, target.value.latitude, target.value.longitude)
  const b = bearingDeg(g.value.latitude!, g.value.longitude!, target.value.latitude, target.value.longitude)
  return { d, b }
})

const sortedWaypoints = computed(() => {
  if (!hasPos.value || !g.value) return waypoints.value
  const { latitude: la, longitude: lo } = g.value
  return [...waypoints.value].sort((a, b) => distanceM(la!, lo!, a.latitude, a.longitude) - distanceM(la!, lo!, b.latitude, b.longitude))
})

async function load(): Promise<void> {
  try {
    ;[waypoints.value, tracks.value] = await Promise.all([
      $fetch<Waypoint[]>('/api/nav/waypoints', { timeout: 5000, retry: 0 }),
      $fetch<TrackSummary[]>('/api/nav/tracks', { timeout: 5000, retry: 0 }),
    ])
  } catch {
    // navDown ya refleja el estado del servicio
  }
}

async function toggleRecording(): Promise<void> {
  try {
    await postAction(nav.value?.recording ? '/api/nav/tracks/stop' : '/api/nav/tracks/start')
    await refreshNav()
    await load()
  } catch (err) {
    message.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}

async function saveHere(): Promise<void> {
  try {
    await postAction('/api/nav/waypoints', { here: true, name: `Posición ${new Date().toLocaleString('es-ES')}`, kind: 'personal' })
    await load()
    message.value = { tone: 'ok', text: t('nav.saved') }
  } catch (err) {
    message.value = { tone: 'danger', text: actionErrorMessage(err) }
  }
}

async function confirmDelete(): Promise<void> {
  const p = pendingDelete.value
  if (!p) return
  try {
    await ($fetch as (u: string, o: Record<string, unknown>) => Promise<unknown>)(p.kind === 'wp' ? `/api/nav/waypoints/${p.id}` : `/api/nav/tracks/${p.id}`, {
      method: 'DELETE',
      headers: { 'x-survival-action': '1' },
      retry: 0,
    })
    if (p.kind === 'wp' && targetId.value === p.id) targetId.value = null
    await load()
  } catch (err) {
    message.value = { tone: 'danger', text: actionErrorMessage(err) }
  } finally {
    pendingDelete.value = null
  }
}

async function importGpx(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    message.value = { tone: 'danger', text: t('nav.gpx.tooBig') }
    return
  }
  try {
    const r = await ($fetch as (u: string, o: Record<string, unknown>) => Promise<{ waypoints: number; tracks: number; rejected: number }>)('/api/nav/gpx/import', {
      method: 'POST',
      body: await file.text(),
      headers: { 'x-survival-action': '1', 'content-type': 'application/gpx+xml' },
      timeout: 60_000,
      retry: 0,
    })
    message.value = { tone: 'ok', text: t('nav.gpx.imported', { w: r.waypoints, t: r.tracks, r: r.rejected }) }
    await load()
  } catch (err) {
    message.value = { tone: 'danger', text: actionErrorMessage(err) }
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => !document.hidden && void refreshNav(), 3000)
})
onBeforeUnmount(() => timer && clearInterval(timer))

// ------------------------------------------------------------------ Presentación (solo deriva de lo medido)

const fixTone = computed<Tone>(() => (navDown.value ? 'danger' : !g.value ? 'muted' : g.value.fix === 'none' ? 'warn' : 'ok'))
const heroIcon = computed(() => (navDown.value ? Unplug : !gnss.value ? Loader : hasPos.value ? LocateFixed : g.value ? Satellite : LocateOff))
const heroTitle = computed(() => {
  if (navDown.value) return t('ui.nav.heroDown')
  if (!gnss.value) return t('state.loading')
  if (!g.value) return t('ui.nav.heroNoGnss')
  if (g.value.fix === 'none') return t('nav.fix.none')
  return t('ui.nav.heroFix', { fix: fixLabel.value })
})
const dms = computed(() =>
  hasPos.value && g.value ? { lat: toDms(g.value.latitude!, 'lat'), lon: toDms(g.value.longitude!, 'lon') } : { lat: null, lon: null },
)
const wpDistance = (w: Waypoint): string | null =>
  hasPos.value && g.value ? formatDistance(distanceM(g.value.latitude!, g.value.longitude!, w.latitude, w.longitude)) : null
const trackDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatDate(d)
}

/** Rosa de los vientos estática: marcas cada 30° y letras de los cardinales (de la utilidad, sin literales). */
const TICKS = Array.from({ length: 12 }, (_, i) => i * 30)
const CARDINALS = [
  { deg: 0, x: 60, y: 22 },
  { deg: 90, x: 98, y: 60 },
  { deg: 180, x: 60, y: 98 },
  { deg: 270, x: 22, y: 60 },
].map((c) => ({ ...c, label: cardinal(c.deg) }))

/** Ángulo acumulado: gira por el camino corto (359° → 1° no da la vuelta entera). Null si no hay medida. */
function useUnwrapped(src: () => number | null) {
  const out = ref<number | null>(null)
  watch(
    src,
    (v) => {
      if (v == null) out.value = null
      else if (out.value == null) out.value = v
      else out.value += ((((v - out.value) % 360) + 540) % 360) - 180
    },
    { immediate: true },
  )
  return out
}
const needleRot = useUnwrapped(() => g.value?.courseDeg ?? null)
const targetRot = useUnwrapped(() => toTarget.value?.b ?? null)
</script>

<template>
  <div class="page">
    <PageHeader :title="t('module.navigation')" :icon="Compass" :phase="4" />
    <div v-if="nav?.simulated" class="notice tone-danger banner">{{ t('maps.simulated') }}</div>
    <div v-if="navDown" class="notice tone-danger banner">{{ t('nav.serviceDown') }}</div>
    <p v-if="message" :class="`tone-${message.tone} msg`" role="status">{{ message.text }}</p>

    <!-- Posición: estado de la fijación y coordenadas medidas. -->
    <section class="hero" :class="`tone-${fixTone}`">
      <span class="orb" aria-hidden="true"><component :is="heroIcon" :size="28" /></span>
      <div class="hero-text">
        <h2>{{ heroTitle }}</h2>
        <div class="coords">
          <p class="coord">
            <span class="axis">{{ t('nav.lat') }}</span>
            <span class="val mono">{{ hasPos ? g!.latitude!.toFixed(6) : '—' }}</span>
            <span v-if="dms.lat" class="dms mono">{{ dms.lat }}</span>
          </p>
          <p class="coord">
            <span class="axis">{{ t('nav.lon') }}</span>
            <span class="val mono">{{ hasPos ? g!.longitude!.toFixed(6) : '—' }}</span>
            <span v-if="dms.lon" class="dms mono">{{ dms.lon }}</span>
          </p>
        </div>
        <ProbeNote v-if="!navDown && gnss && gnss.state !== 'ok'" :probe="gnss" />
        <!-- Respaldo: posición del nodo LoRa, solo informativa y con su antigüedad. -->
        <div v-if="!hasPos && fallback" class="fallback">
          <p class="fb-title"><RadioTower :size="16" aria-hidden="true" /> {{ t('nav.fallback.title') }}</p>
          <p class="mono">{{ fallback.latitude.toFixed(6) }}, {{ fallback.longitude.toFixed(6) }}<template v-if="fallback.altitudeM !== null"> · {{ formatNumber(fallback.altitudeM, 0) }} m</template></p>
          <p class="fb-note">
            {{
              fallback.ageSeconds === null
                ? t('nav.fallback.noTime', { node: fallback.nodeId ?? '?' })
                : t(fallback.lastKnown ? 'nav.fallback.lastKnown' : 'nav.fallback.age', { age: formatAge(fallback.ageSeconds), node: fallback.nodeId ?? '?' })
            }}
            {{ t('nav.fallback.note') }}
          </p>
        </div>
        <p v-if="nav?.devices.length" class="hero-id mono">{{ t('nav.device') }} · {{ nav.devices.join(', ') }}</p>
      </div>
      <dl class="hero-stats">
        <div>
          <dt>{{ t('nav.accuracy') }}</dt>
          <dd class="mono">{{ g?.horizontalErrorM != null ? `± ${formatNumber(g.horizontalErrorM, 0)} m` : '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('nav.sats') }}</dt>
          <dd class="mono">{{ g ? `${g.satellitesUsed ?? '?'} / ${g.satellitesVisible ?? '?'}` : '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('nav.alt') }}</dt>
          <dd class="mono">{{ g?.altitudeM != null ? `${formatNumber(g.altitudeM, 0)} m` : '—' }}</dd>
        </div>
      </dl>
    </section>

    <!-- Rumbo y destino -->
    <div class="bento">
      <AppCard :title="t('nav.heading')" :icon="Navigation" :tone="g?.courseDeg != null ? 'ok' : 'muted'">
        <div class="compass">
          <svg class="rose" viewBox="0 0 120 120" role="img" :aria-label="g?.courseDeg != null ? `${t('nav.heading')} ${formatNumber(g.courseDeg, 0)}°` : t('nav.heading')">
            <circle cx="60" cy="60" r="57" class="rim" />
            <circle cx="60" cy="60" r="33" class="inner" />
            <line
              v-for="a in TICKS" :key="a" x1="60" y1="5" x2="60" :y2="a % 90 === 0 ? 14 : 10"
              class="tick" :class="{ major: a % 90 === 0 }" :transform="`rotate(${a} 60 60)`"
            />
            <text v-for="c in CARDINALS" :key="c.deg" :x="c.x" :y="c.y" class="cardinal" :class="{ north: c.deg === 0 }">{{ c.label }}</text>
            <!-- Marca del destino sobre el aro (rumbo verdadero al punto). -->
            <path v-if="targetRot !== null" class="target-mark" d="M60 15 L66 4 H54 Z" :style="{ transform: `rotate(${targetRot}deg)` }" />
            <!-- Aguja: solo con rumbo medido por el GNSS; sin medida no se dibuja. -->
            <path v-if="needleRot !== null" class="needle" d="M60 30 L71 84 L60 76 L49 84 Z" :style="{ transform: `rotate(${needleRot}deg)` }" />
            <circle v-else cx="60" cy="60" r="3" class="hub" />
          </svg>
          <div class="compass-info">
            <p class="ui-figure">
              <span class="num mono">{{ g?.courseDeg != null ? `${formatNumber(g.courseDeg, 0)}°` : '—' }}</span>
              <span v-if="g?.courseDeg != null" class="unit">{{ cardinal(g.courseDeg) }}</span>
              <span class="cap">{{ t('ui.nav.courseCap') }}</span>
            </p>
            <KvRow :label="t('nav.speed')" :value="g?.speedMs != null ? `${formatNumber(g.speedMs * 3.6)} km/h` : null" mono />
            <p v-if="g?.courseDeg == null" class="note">{{ t('nav.heading.note') }}</p>
          </div>
        </div>
      </AppCard>

      <AppCard :title="t('nav.target')" :icon="Target" :tone="target ? 'info' : 'muted'">
        <template v-if="target">
          <p class="target-name">
            <span class="kdot" :style="{ '--kc': WAYPOINT_COLORS[target.kind] }" aria-hidden="true" />
            <strong>{{ target.name }}</strong>
          </p>
          <p class="ui-figure">
            <span class="num mono">{{ toTarget ? formatDistance(toTarget.d) : '—' }}</span>
            <span class="cap">{{ toTarget ? t('nav.distance') : t('nav.needFix') }}</span>
          </p>
          <KvRow :label="t('nav.bearing')" :value="toTarget ? `${formatNumber(toTarget.b, 0)}° ${cardinal(toTarget.b)}` : '—'" mono />
          <button type="button" class="btn clear" @click="targetId = null">
            <Target :size="18" aria-hidden="true" /> {{ t('nav.target.clear') }}
          </button>
        </template>
        <div v-else class="empty">
          <Flag :size="22" aria-hidden="true" />
          <p>{{ t('nav.target.none') }}</p>
        </div>
      </AppCard>
    </div>

    <!-- Acciones -->
    <h2 class="ui-sec">{{ t('ui.nav.secActions') }}</h2>
    <div class="ctl-grid">
      <button type="button" class="ctl" :disabled="!hasPos" @click="saveHere">
        <MapPin :size="24" aria-hidden="true" />
        <span><strong>{{ t('nav.saveHere') }}</strong><small>{{ hasPos ? t('ui.nav.saveHint') : t('nav.needFix') }}</small></span>
      </button>
      <button type="button" class="ctl" :class="nav?.recording ? 'ctl-danger tone-danger' : 'tone-ok'" :disabled="navDown" @click="toggleRecording">
        <component :is="nav?.recording ? Square : Circle" :size="24" aria-hidden="true" />
        <span>
          <strong>{{ nav?.recording ? t('nav.stop') : t('nav.start') }}</strong>
          <small>{{ nav?.recording ? t('ui.nav.recPoints', { n: nav.recording.points }) : t('nav.track.privacy') }}</small>
        </span>
      </button>
      <label class="ctl">
        <FileUp :size="24" aria-hidden="true" />
        <span><strong>{{ t('nav.gpx.import') }}</strong><small>{{ t('ui.nav.importHint') }}</small></span>
        <input ref="fileInput" type="file" accept=".gpx,application/gpx+xml" hidden @change="importGpx" />
      </label>
      <NuxtLink v-if="!nav?.devices.length" to="/sistema/mantenimiento" class="ctl tone-info">
        <Satellite :size="24" aria-hidden="true" />
        <span><strong>{{ t('mnt.gps.enable') }}</strong><small>{{ t('ui.nav.gpsHint') }}</small></span>
      </NuxtLink>
    </div>

    <!-- Tracks y puntos -->
    <h2 class="ui-sec">{{ t('ui.nav.secData') }}</h2>
    <div class="bento">
      <AppCard
        :title="t('nav.track')" :icon="Route" :tone="nav?.recording ? 'warn' : 'muted'"
        :pill="nav?.recording ? t('nav.recording') : tracks.length ? String(tracks.length) : undefined"
      >
        <p v-if="nav?.recording">{{ t('nav.recording.detail', { n: nav.recording.points, s: nav.recording.intervalSeconds }) }}</p>
        <p v-if="!tracks.length" class="note">{{ t('ui.nav.tracksNone') }}</p>
        <ul v-else class="list">
          <li v-for="tr in tracks" :key="tr.id" class="ui-row item" :class="nav?.recording?.trackId === tr.id ? 'tone-warn' : 'tone-info'">
            <span class="dot" aria-hidden="true" />
            <span class="grow">
              <span class="name">{{ tr.name }}</span>
              <span class="meta">
                <span class="mono">{{ t('ui.nav.trackMeta', { n: tr.points, d: formatDistance(tr.distanceM) }) }}</span>
                · {{ trackDate(tr.startedAt) }}
              </span>
            </span>
            <span v-if="nav?.recording?.trackId === tr.id" class="ui-chip tone-warn">{{ t('nav.recording') }}</span>
            <a class="btn icon" :href="`/api/nav/tracks/${tr.id}.gpx`" :download="`${tr.id}.gpx`" :aria-label="t('nav.export')">
              <Download :size="18" aria-hidden="true" />
            </a>
            <button type="button" class="btn icon del" :aria-label="t('nav.delete')" @click="pendingDelete = { kind: 'track', id: tr.id, name: tr.name }">
              <Trash2 :size="18" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </AppCard>

      <AppCard :title="t('nav.waypoints')" :icon="Flag" :pill="String(waypoints.length)">
        <p v-if="!waypoints.length" class="note">{{ t('nav.waypoints.none') }}</p>
        <ul v-else class="list">
          <li v-for="w in sortedWaypoints" :key="w.id" class="ui-row item" :class="{ active: w.id === targetId }">
            <button type="button" class="pick" :aria-pressed="w.id === targetId" @click="targetId = w.id">
              <span class="kdot" :style="{ '--kc': WAYPOINT_COLORS[w.kind] }" aria-hidden="true" />
              <span class="grow">
                <span class="name">{{ w.name }}</span>
                <span class="meta">{{ t(`wp.kind.${w.kind}`) }} · {{ t(`wp.origin.${w.origin}`) }}</span>
              </span>
              <Target v-if="w.id === targetId" :size="18" class="is-target" aria-hidden="true" />
              <span v-if="wpDistance(w)" class="dist mono">{{ wpDistance(w) }}</span>
            </button>
            <button type="button" class="btn icon del" :aria-label="t('nav.delete')" @click="pendingDelete = { kind: 'wp', id: w.id, name: w.name }">
              <Trash2 :size="18" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <p class="note">{{ t('nav.waypoints.note') }}</p>
      </AppCard>
    </div>

    <ConfirmDialog
      v-if="pendingDelete"
      :title="t('nav.delete.title')"
      :message="t('nav.delete.body', { name: pendingDelete.name })"
      :confirm-label="t('nav.delete')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.banner {
  margin-bottom: var(--gap);
}

.msg {
  color: var(--tone);
  font-weight: 700;
  margin-bottom: 0.5rem;
}

/* ------------------------------------------------------------ Posición */
.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 0.8rem 1rem;
  margin-bottom: var(--gap);
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
  min-width: 18rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.hero-text h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.coords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 1.6rem;
}

.coord {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.axis {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.val {
  font-size: 1.55rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text);
}

.dms {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.hero-id {
  color: var(--text-faint);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-stats {
  flex: none;
  display: flex;
  margin: 0 0 0 auto;
}

.hero-stats div {
  padding: 0.15rem 0 0.15rem 1rem;
  margin-left: 1rem;
  border-left: 1px solid var(--border);
}

.hero-stats div:first-child {
  margin-left: 0;
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

/* ------------------------------------------------------------ Bento */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gap);
  align-items: stretch;
}

.note {
  color: var(--text-faint) !important;
  font-size: 0.82rem !important;
  line-height: 1.35;
}

/* Brújula */
.compass {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.rose {
  flex: none;
  width: 8.5rem;
  height: 8.5rem;
}

.rim {
  fill: color-mix(in srgb, var(--tone) 6%, var(--surface));
  stroke: color-mix(in srgb, var(--tone) 45%, var(--border));
  stroke-width: 1.5;
}

.inner {
  fill: none;
  stroke: var(--hairline);
  stroke-width: 1;
}

.tick {
  stroke: var(--text-faint);
  stroke-width: 1.2;
  stroke-linecap: round;
}

.tick.major {
  stroke: var(--text-muted);
  stroke-width: 2;
}

.cardinal {
  fill: var(--text-muted);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}

.cardinal.north {
  fill: var(--danger);
}

.needle,
.target-mark {
  transform-box: view-box;
  transform-origin: 60px 60px;
  transition: transform 0.4s ease-out;
}

.needle {
  fill: var(--tone);
  stroke: color-mix(in srgb, var(--tone) 60%, #000);
  stroke-width: 1;
  stroke-linejoin: round;
}

.target-mark {
  fill: var(--info);
}

.hub {
  fill: var(--text-faint);
}

.compass-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* Destino */
.target-name {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  color: var(--text) !important;
  font-size: 1rem !important;
}

.target-name strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear {
  align-self: flex-start;
  margin-top: auto;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 0.5rem;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}

.empty svg {
  color: var(--text-faint);
}

/* ------------------------------------------------------------ Acciones */
.ctl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--gap);
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
  background: var(--surface-grad);
  color: var(--text);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.ctl.tone-ok {
  --tone: var(--ok);
}

.ctl.tone-info {
  --tone: var(--info);
}

.ctl.tone-danger {
  --tone: var(--danger);
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

.ctl:active:not(:disabled) {
  transform: scale(0.97);
  background: var(--surface-3);
  border-color: var(--tone);
}

.ctl:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ctl-danger {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  background: color-mix(in srgb, var(--danger) 16%, var(--surface-2));
}

/* ------------------------------------------------------------ Listas */
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.item {
  gap: 0.5rem;
  min-height: 3.25rem;
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

.kdot {
  flex: none;
  width: 0.7rem;
  height: 0.7rem;
  margin: 0 0.15rem;
  border-radius: 50%;
  background: var(--kc);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--kc) 22%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 700;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 0.78rem;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: var(--touch);
  padding: 0.3rem 0.4rem;
  margin-left: -0.4rem;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.pick:active {
  transform: scale(0.98);
  background: var(--surface-3);
}

.item.active .pick {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--info) 45%, transparent);
}

.is-target {
  flex: none;
  color: var(--info);
}

.dist {
  flex: none;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.btn.icon {
  flex: none;
  width: var(--touch);
  padding: 0;
}

.btn.del svg {
  color: color-mix(in srgb, var(--danger) 80%, var(--text));
}

/* Respaldo LoRa: informativo, en tono de aviso (no es una fijación GNSS). */
.fallback {
  margin-top: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
  background: color-mix(in srgb, var(--warn) 8%, transparent);
}

.fallback p {
  margin: 0.1rem 0;
}

.fb-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 700;
}

.fb-note {
  font-size: 0.86rem;
  opacity: 0.85;
}
</style>
