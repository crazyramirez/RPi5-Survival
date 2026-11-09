<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { Bike, Car, Circle, Copy, Crosshair, Download, Footprints, Info, LocateFixed, Map as MapIcon, MapPinPlus, Minus, Moon, Plus, Route, Sun, TriangleAlert, X } from '@lucide/vue'
import type { MapPackage, RouteMode, RouteResult, RoutingStatus, TrackPoint, Waypoint, WaypointKind } from '@survival-os/shared-types'
import { parseMapQuery } from '~/utils/coords'
import { formatAge, formatBytes, formatDuration } from '~/utils/format'
import { formatDistance, WAYPOINT_COLORS, WAYPOINT_KINDS } from '~/utils/waypoints'

const t = useT()
/** `?lat=&lon=&z=`: abrir el mapa en un punto concreto (enlaces). */
const initialView = parseMapQuery(useRoute().query as Record<string, unknown>)
const { nav, refreshNav } = useNav()

const maps = ref<MapPackage[] | null>(null)
const selected = ref<string | null>(null)
const flavor = ref<'light' | 'dark'>('light')
const mapEl = ref<HTMLDivElement | null>(null)
const center = ref<{ lat: number; lon: number; zoom: number } | null>(null)
const message = ref<string | null>(null)
const waypoints = ref<Waypoint[]>([])
const adding = ref(false)
const newName = ref('')
const newKind = ref<WaypointKind>('personal')

let map: MlMap | null = null
let posMarker: Marker | null = null
/** Posición de respaldo del nodo LoRa (Meshtastic): solo se dibuja si NO hay fijación GNSS. */
let loraMarker: Marker | null = null
let wpMarkers: Marker[] = []
let navTimer: ReturnType<typeof setInterval> | undefined
let protocol: Protocol | null = null

const fix = computed(() => (nav.value?.gnss.state === 'ok' && nav.value.gnss.value.fix !== 'none' ? nav.value.gnss.value : null))
/** Respaldo LoRa (última posición del propio nodo Meshtastic). Dato medido por el nodo, con su antigüedad. */
const lora = computed(() => (!fix.value && nav.value?.fallback?.state === 'ok' ? nav.value.fallback.value : null))
const loraAge = computed(() => (lora.value?.ageSeconds != null ? formatAge(lora.value.ageSeconds) : null))
/** «± 2,9 km» si el canal recorta la posición: nunca se presenta como exacta. */
const loraPrecision = computed(() => (lora.value?.precisionM ? t('maps.lora.precision', { d: formatDistance(lora.value.precisionM) }) : ''))
const loraHud = computed(() => {
  const l = lora.value
  if (!l) return ''
  const who = l.remote && l.nodeName ? l.nodeName : null
  const base = who
    ? loraAge.value ? t('maps.lora.hudRemote', { name: who, age: loraAge.value }) : t('maps.lora.hudRemoteNoTime', { name: who })
    : loraAge.value ? t('maps.lora.hud', { age: loraAge.value }) : t('maps.lora.hudNoTime')
  return loraPrecision.value ? `${base} · ${loraPrecision.value}` : base
})
/** Solo presentación: paquete cartográfico seleccionado (para la línea de información). */
const currentMap = computed(() => maps.value?.find((m) => m.file === selected.value) ?? null)

function loadPrefs(): void {
  try {
    const p = JSON.parse(localStorage.getItem('survival-os:map') ?? '{}') as { file?: string; flavor?: 'light' | 'dark' }
    if (p.flavor === 'dark' || p.flavor === 'light') flavor.value = p.flavor
    if (p.file) selected.value = p.file
  } catch {
    // sin preferencias guardadas
  }
}
function savePrefs(): void {
  try {
    localStorage.setItem('survival-os:map', JSON.stringify({ file: selected.value, flavor: flavor.value }))
  } catch {
    // ignorar
  }
}

function style(file: string) {
  const origin = window.location.origin
  return {
    version: 8 as const,
    glyphs: `${origin}/map-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map-assets/sprites/v4/${flavor.value}`,
    sources: {
      protomaps: {
        type: 'vector' as const,
        url: `pmtiles://${origin}/maps-data/${file}`,
        attribution: '© OpenStreetMap · Protomaps',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor.value), { lang: 'es' }),
  }
}

function addOverlays(): void {
  if (!map) return
  if (!map.getSource('track')) {
    map.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#e5527a', 'line-width': 4 } })
  }
  if (!map.getSource('route')) {
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const layout = { 'line-join': 'round' as const, 'line-cap': 'round' as const }
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout, paint: { 'line-color': '#2f6fe0', 'line-width': 5 } })
  }
  drawRoute()
}

function webgl2Available(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

async function initMap(file: string): Promise<void> {
  if (!mapEl.value) return
  if (!webgl2Available()) {
    message.value = t('maps.error.webgl')
    return
  }
  map?.remove()
  const url = `${window.location.origin}/maps-data/${file}`
  const pm = new PMTiles(url)
  protocol?.add(pm)
  let bounds: [number, number, number, number] | null = null
  try {
    const h = await pm.getHeader()
    bounds = [h.minLon, h.minLat, h.maxLon, h.maxLat]
  } catch {
    message.value = t('maps.error.read')
  }
  let m: MlMap
  try {
    m = new maplibregl.Map({
    container: mapEl.value,
    style: style(file),
    ...(initialView ? { center: initialView.center, zoom: initialView.zoom } : { bounds: bounds ?? undefined }),
    maxZoom: 18,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    fadeDuration: 0,
    attributionControl: { compact: true },
    })
  } catch {
    message.value = t('maps.error.webgl')
    return
  }
  m.touchZoomRotate.disableRotation()
  m.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-left')
  const updateCenter = (): void => {
    const c = m.getCenter()
    center.value = { lat: c.lat, lon: c.lng, zoom: m.getZoom() }
  }
  m.on('moveend', updateCenter)
  m.on('load', () => {
    updateCenter()
    addOverlays()
    renderWaypoints()
    updatePosition()
    void updateTrack()
  })
  m.on('style.load', addOverlays)
  map = m
}

function renderWaypoints(): void {
  for (const m of wpMarkers) m.remove()
  wpMarkers = []
  if (!map) return
  for (const w of waypoints.value) {
    const el = document.createElement('div')
    el.className = 'wp-marker'
    el.style.background = WAYPOINT_COLORS[w.kind]
    el.title = w.name
    const label = document.createElement('span')
    label.textContent = w.name // textContent: nunca HTML del usuario
    el.appendChild(label)
    wpMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([w.longitude, w.latitude]).addTo(map))
  }
}

function updateLora(): void {
  if (!map) return
  const l = lora.value
  if (!l) {
    loraMarker?.remove()
    loraMarker = null
    return
  }
  const base = loraAge.value ? t('maps.lora.label', { age: loraAge.value }) : t('maps.lora.labelNoTime')
  const text = loraPrecision.value ? `${base} · ${loraPrecision.value}` : base
  if (!loraMarker) {
    const el = document.createElement('div')
    el.className = 'lora-marker'
    const dot = document.createElement('i')
    const label = document.createElement('span')
    el.append(dot, label)
    loraMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([l.longitude, l.latitude]).addTo(map)
  } else {
    loraMarker.setLngLat([l.longitude, l.latitude])
  }
  const label = loraMarker.getElement().querySelector('span')
  if (label) label.textContent = text
}

function updatePosition(): void {
  if (!map) return
  updateLora()
  const f = fix.value
  if (!f || f.latitude === null || f.longitude === null) {
    posMarker?.remove()
    posMarker = null
    return
  }
  if (!posMarker) {
    const el = document.createElement('div')
    el.className = nav.value?.simulated ? 'pos-marker simulated' : 'pos-marker'
    posMarker = new maplibregl.Marker({ element: el }).setLngLat([f.longitude, f.latitude]).addTo(map)
  } else {
    posMarker.setLngLat([f.longitude, f.latitude])
  }
}

async function updateTrack(): Promise<void> {
  const rec = nav.value?.recording
  const src = map?.getSource('track') as GeoJSONSource | undefined
  if (!src) return
  if (!rec) {
    src.setData({ type: 'FeatureCollection', features: [] })
    return
  }
  try {
    const pts = await $fetch<TrackPoint[]>(`/api/nav/tracks/${rec.trackId}/points`, { timeout: 5000, retry: 0 })
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } })
  } catch {
    // se reintenta en el siguiente ciclo
  }
}

/** Vista pública (punto de acceso): mapa de consulta sin posición, puntos ni grabación (ADR 0009). */
const publicView = isPublicView()

async function loadWaypoints(): Promise<void> {
  if (publicView) return
  try {
    waypoints.value = await $fetch<Waypoint[]>('/api/nav/waypoints', { timeout: 5000, retry: 0 })
  } catch {
    waypoints.value = []
  }
  renderWaypoints()
}

function centerOnMe(): void {
  const f = fix.value
  if (map && f?.latitude != null && f.longitude != null) {
    map.flyTo({ center: [f.longitude, f.latitude], zoom: Math.max(map.getZoom(), 15), speed: 1.6 })
    return
  }
  // Sin GNSS: la última posición del nodo LoRa (zoom algo menor: es aproximada y puede ser antigua).
  const l = lora.value
  if (map && l) map.flyTo({ center: [l.longitude, l.latitude], zoom: Math.max(map.getZoom(), 13), speed: 1.6 })
}

// ------------------------------------------------------------------ Rutas sin conexión (ADR 0010)
const routing = ref<RoutingStatus | null>(null)
const routeOpen = ref(false)
const routeMode = ref<RouteMode>('foot')
const routeFrom = ref<'gnss' | 'lora' | 'center'>('gnss')
/** Destino: 'center' (mira del mapa) o id de un punto guardado. */
const routeTo = ref<string>('center')
const routeBusy = ref(false)
const routeError = ref<string | null>(null)
const route = ref<RouteResult | null>(null)
const routeQuery = ref<string | null>(null)

const ROUTE_MODES: { id: RouteMode; icon: typeof Footprints }[] = [
  { id: 'foot', icon: Footprints },
  { id: 'bike', icon: Bike },
  { id: 'car', icon: Car },
]

async function loadRouting(): Promise<void> {
  if (publicView) return
  routing.value = await $fetch<RoutingStatus>('/api/routing/status', { timeout: 5000, retry: 0 }).catch(() => null)
}

function openRoute(): void {
  routeError.value = null
  // Origen por defecto: el dato más fiable disponible (GNSS > LoRa > centro del mapa).
  routeFrom.value = fix.value ? 'gnss' : lora.value ? 'lora' : 'center'
  if (routeFrom.value === 'center' && routeTo.value === 'center') routeTo.value = waypoints.value[0]?.id ?? 'center'
  routeOpen.value = true
  void loadRouting()
}

function pointOf(kind: 'gnss' | 'lora' | 'center' | string): { lat: number; lon: number } | null {
  if (kind === 'gnss') return fix.value?.latitude != null && fix.value.longitude != null ? { lat: fix.value.latitude, lon: fix.value.longitude } : null
  if (kind === 'lora') return lora.value ? { lat: lora.value.latitude, lon: lora.value.longitude } : null
  if (kind === 'center') return center.value ? { lat: center.value.lat, lon: center.value.lon } : null
  const w = waypoints.value.find((x) => x.id === kind)
  return w ? { lat: w.latitude, lon: w.longitude } : null
}

async function calcRoute(): Promise<void> {
  const a = pointOf(routeFrom.value)
  const b = pointOf(routeTo.value)
  routeError.value = null
  if (!a || !b) {
    routeError.value = t('maps.route.needPoints')
    return
  }
  const q = new URLSearchParams({ from: `${a.lat.toFixed(6)},${a.lon.toFixed(6)}`, to: `${b.lat.toFixed(6)},${b.lon.toFixed(6)}`, mode: routeMode.value })
  routeBusy.value = true
  try {
    route.value = await $fetch<RouteResult>(`/api/routing/route?${q.toString()}`, { timeout: 80_000, retry: 0 })
    routeQuery.value = q.toString()
    routeOpen.value = false
    drawRoute(true)
  } catch (err) {
    routeError.value = actionErrorMessage(err)
  } finally {
    routeBusy.value = false
  }
}

function drawRoute(fit = false): void {
  const src = map?.getSource('route') as GeoJSONSource | undefined
  if (!src) return
  const r = route.value
  src.setData(r ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coordinates.map((c) => [c[0]!, c[1]!]) } } : { type: 'FeatureCollection', features: [] })
  if (r && fit && map) {
    const b = new maplibregl.LngLatBounds()
    for (const c of r.coordinates) b.extend([c[0]!, c[1]!])
    map.fitBounds(b, { padding: { top: 90, bottom: 120, left: 60, right: 110 }, maxZoom: 16, duration: 600 })
  }
}

function clearRoute(): void {
  route.value = null
  routeQuery.value = null
  drawRoute()
}

async function copyCenter(): Promise<void> {
  if (!center.value) return
  try {
    await navigator.clipboard.writeText(`${center.value.lat.toFixed(6)}, ${center.value.lon.toFixed(6)}`)
    message.value = t('maps.copied')
  } catch {
    message.value = t('maps.copyFailed')
  }
}

async function saveWaypoint(): Promise<void> {
  if (!center.value) return
  try {
    await postAction('/api/nav/waypoints', { name: newName.value, kind: newKind.value, latitude: center.value.lat, longitude: center.value.lon })
    adding.value = false
    newName.value = ''
    await loadWaypoints()
  } catch (err) {
    message.value = actionErrorMessage(err)
  }
}

async function toggleRecording(): Promise<void> {
  try {
    await postAction(nav.value?.recording ? '/api/nav/tracks/stop' : '/api/nav/tracks/start')
    await refreshNav()
    void updateTrack()
  } catch (err) {
    message.value = actionErrorMessage(err)
  }
}

function selectMap(file: string): void {
  selected.value = file
  savePrefs()
  void initMap(file)
}

function toggleFlavor(): void {
  flavor.value = flavor.value === 'light' ? 'dark' : 'light'
  savePrefs()
  if (map && selected.value) map.setStyle(style(selected.value))
}

watch(nav, () => {
  updatePosition()
})

onMounted(async () => {
  void loadRouting()
  loadPrefs()
  // Worker servido localmente (public/map-assets/maplibre, copiado en cada build).
  maplibregl.setWorkerUrl(`${window.location.origin}/map-assets/maplibre/maplibre-gl-worker.mjs`)
  protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  try {
    maps.value = await $fetch<MapPackage[]>('/api/maps', { timeout: 5000, retry: 0 })
  } catch {
    maps.value = []
  }
  const list = maps.value ?? []
  if (!list.length) return
  if (!selected.value || !list.some((m) => m.file === selected.value)) selected.value = list[0]?.file ?? null
  await nextTick()
  if (selected.value) await initMap(selected.value)
  await loadWaypoints()
  // Mientras el mapa está visible: posición cada 3 s y track cada 10 s.
  let ticks = 0
  navTimer = setInterval(() => {
    if (document.hidden) return
    void refreshNav()
    if (++ticks % 3 === 0) void updateTrack()
  }, 3000)
})

onBeforeUnmount(() => {
  if (navTimer) clearInterval(navTimer)
  map?.remove() // libera WebGL: no se renderiza nada fuera de esta pantalla
  map = null
  maplibregl.removeProtocol('pmtiles')
})
</script>

<template>
  <div class="maps">
    <!-- El mapa ocupa toda la pantalla: título solo para lectores de pantalla y para la estructura. -->
    <h1 v-if="!(maps && maps.length === 0)" class="sr-only">{{ t('module.maps') }}</h1>
    <div v-if="maps && maps.length === 0" class="page">
      <PageHeader :title="t('module.maps')" :icon="MapIcon" />
      <div class="grid-cards">
        <AppCard :title="t('maps.cartography')" :icon="MapIcon" tone="muted" :pill="t('state.unavailable')">
          <strong>{{ t('maps.cartography.none') }}</strong>
          <p>{{ t('maps.install.howto') }}</p>
          <NuxtLink to="/sistema/mantenimiento" class="btn btn-primary">{{ t('mnt.usb.scan') }}</NuxtLink>
        </AppCard>
      </div>
    </div>

    <template v-else>
      <div ref="mapEl" class="map" />
      <!-- Retícula: halo oscuro (trazo grueso) + trazo de color; sin filtros. -->
      <div class="crosshair" aria-hidden="true">
        <Crosshair :size="30" :stroke-width="4.5" class="ch-halo" />
        <Crosshair :size="30" :stroke-width="2" class="ch-main" />
      </div>

      <div v-if="nav?.simulated" class="sim-badge" role="status">
        <TriangleAlert :size="16" aria-hidden="true" />{{ t('maps.simulated') }}
      </div>

      <div class="panel top-left">
        <div class="hud" :class="fix ? 'tone-ok' : 'tone-warn'">
          <div v-if="!publicView" class="hud-gnss">
            <span class="dot" aria-hidden="true" />
            <span class="hud-gnss-text">
              {{
                fix
                  ? t('maps.gnss.fix', { fix: fix.fix.toUpperCase(), err: fix.horizontalErrorM ?? '?' })
                  : lora
                    ? loraHud
                    : (nav?.gnss.state === 'unavailable' ? nav.gnss.reason : t('maps.gnss.none'))
              }}
            </span>
          </div>
          <div v-if="center" class="hud-coords">
            <span class="mono">{{ center.lat.toFixed(5) }}, {{ center.lon.toFixed(5) }}</span>
            <span class="zoom mono">{{ t('ui.maps.zoomLevel', { z: center.zoom.toFixed(1) }) }}</span>
          </div>
          <div v-if="nav?.recording" class="hud-rec tone-danger">
            <span class="dot" aria-hidden="true" />
            <strong>{{ t('nav.recording') }}</strong>
            <span class="mono">{{ t('ui.maps.recPoints', { n: nav.recording.points }) }}</span>
          </div>
        </div>

        <div v-if="maps && maps.length > 1" class="chips" role="group" :aria-label="t('maps.cartography')">
          <button
            v-for="m in maps"
            :key="m.file"
            type="button"
            class="chip"
            :class="{ on: m.file === selected }"
            :aria-pressed="m.file === selected"
            @click="selectMap(m.file)"
          >
            <MapIcon :size="16" aria-hidden="true" />{{ m.title }}
          </button>
        </div>

        <div v-if="message" class="toast" role="status"><Info :size="16" aria-hidden="true" /><span>{{ message }}</span></div>
      </div>

      <div class="panel right">
        <div class="rail">
          <button type="button" class="mbtn" :aria-label="t('maps.zoomIn')" @click="map?.zoomIn()"><Plus :size="26" /></button>
          <button type="button" class="mbtn" :aria-label="t('maps.zoomOut')" @click="map?.zoomOut()"><Minus :size="26" /></button>
        </div>
        <div class="rail">
          <button type="button" class="mbtn" :disabled="!fix && !lora" :aria-label="fix || !lora ? t('maps.centerMe') : t('maps.centerLora')" @click="centerOnMe"><LocateFixed :size="24" /></button>
          <button type="button" class="mbtn" :aria-label="t('maps.flavor')" @click="toggleFlavor">
            <component :is="flavor === 'light' ? Moon : Sun" :size="24" />
          </button>
          <button type="button" class="mbtn" :aria-label="t('maps.copy')" @click="copyCenter"><Copy :size="22" /></button>
        </div>
        <div v-if="!publicView" class="rail">
          <button type="button" class="mbtn route" :aria-label="t('maps.route.open')" @click="openRoute"><Route :size="24" /></button>
          <button type="button" class="mbtn add" :aria-label="t('maps.addPoint')" @click="adding = true"><MapPinPlus :size="24" /></button>
          <button
            type="button"
            class="mbtn"
            :class="{ rec: nav?.recording }"
            :aria-label="t('maps.record')"
            :aria-pressed="!!nav?.recording"
            @click="toggleRecording"
          >
            <Circle :size="24" />
          </button>
        </div>
      </div>

      <p v-if="currentMap" class="map-info">
        <MapIcon :size="13" aria-hidden="true" />
        <span>{{ currentMap.title }}</span>
        <span class="sep" aria-hidden="true" />
        <span>{{ t('maps.dataDate', { date: currentMap.dataDate ?? t('common.none') }) }}</span>
        <span class="sep" aria-hidden="true" />
        <span class="mono">{{ formatBytes(currentMap.sizeBytes) }}</span>
      </p>

      <!-- Ruta calculada: resumen con lo que da BRouter (sin inventar tiempos ni desniveles). -->
      <div v-if="route" class="route-card">
        <span class="route-icon" aria-hidden="true"><component :is="ROUTE_MODES.find((m) => m.id === route!.mode)!.icon" :size="20" /></span>
        <span class="route-main">
          <strong class="mono">{{ formatDistance(route.distanceM) }}</strong>
          <span v-if="route.timeS != null" class="mono">{{ formatDuration(route.timeS) }}</span>
          <span v-if="route.ascentM != null" class="mono">↑ {{ Math.round(route.ascentM) }} m</span>
        </span>
        <a v-if="routeQuery" class="btn small" :href="`/api/routing/route?${routeQuery}&format=gpx`" :download="`ruta-${route.mode}.gpx`">
          <Download :size="18" aria-hidden="true" />GPX
        </a>
        <button type="button" class="btn small icon-only" :aria-label="t('maps.route.clear')" @click="clearRoute"><X :size="18" /></button>
      </div>

      <div v-if="routeOpen" class="sheet-backdrop" @click.self="routeOpen = false">
        <form class="sheet route-sheet" @submit.prevent="calcRoute">
          <header class="sheet-head">
            <span class="orb" aria-hidden="true"><Route :size="22" /></span>
            <div class="sheet-title">
              <h2>{{ t('maps.route.title') }}</h2>
              <p>{{ t('maps.route.offline') }}<template v-if="routing?.downloadedAt"> · {{ t('maps.route.data', { date: routing.downloadedAt.slice(0, 10) }) }}</template></p>
            </div>
          </header>
          <p v-if="routing && !routing.available" class="notice tone-warn route-off">
            <TriangleAlert :size="16" aria-hidden="true" /><span>{{ routing.reason }}</span>
            <NuxtLink to="/sistema/mantenimiento" class="btn small">{{ t('mnt.title') }}</NuxtLink>
          </p>
          <div class="route-row">
            <span class="route-lbl">{{ t('maps.route.from') }}</span>
            <div class="seg">
              <button type="button" class="seg-btn" :disabled="!fix" :aria-pressed="routeFrom === 'gnss'" @click="routeFrom = 'gnss'">{{ t('maps.route.fromGnss') }}</button>
              <button type="button" class="seg-btn" :disabled="!lora" :aria-pressed="routeFrom === 'lora'" @click="routeFrom = 'lora'">{{ t('maps.route.fromLora') }}</button>
              <button type="button" class="seg-btn" :aria-pressed="routeFrom === 'center'" @click="routeFrom = 'center'">{{ t('maps.route.center') }}</button>
            </div>
          </div>
          <div class="route-row">
            <span class="route-lbl">{{ t('maps.route.to') }}</span>
            <select v-model="routeTo" class="ui-field route-to">
              <option value="center" :disabled="routeFrom === 'center'">{{ t('maps.route.toCenter') }}</option>
              <option v-for="w in waypoints" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div class="route-row">
            <span class="route-lbl">{{ t('maps.route.mode') }}</span>
            <div class="seg">
              <button v-for="m in ROUTE_MODES" :key="m.id" type="button" class="seg-btn" :aria-pressed="routeMode === m.id" @click="routeMode = m.id">
                <component :is="m.icon" :size="18" aria-hidden="true" />{{ t(`maps.route.mode.${m.id}`) }}
              </button>
            </div>
          </div>
          <p v-if="routeError" class="route-err"><TriangleAlert :size="16" aria-hidden="true" /><span>{{ routeError }}</span></p>
          <div class="actions">
            <button type="button" class="btn" @click="routeOpen = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="routeBusy || (routing !== null && !routing.available)">
              <Route :size="18" aria-hidden="true" />{{ routeBusy ? t('maps.route.busy') : t('maps.route.calc') }}
            </button>
          </div>
        </form>
      </div>

      <div v-if="adding" class="sheet-backdrop" @click.self="adding = false">
        <form class="sheet add-point-sheet" @submit.prevent="saveWaypoint">
          <header class="sheet-head">
            <span class="orb" aria-hidden="true"><MapPinPlus :size="22" /></span>
            <div class="sheet-title">
              <h2>{{ t('maps.addPoint') }}</h2>
              <p class="mono">{{ center?.lat.toFixed(6) }}, {{ center?.lon.toFixed(6) }}</p>
            </div>
          </header>
          <input v-model="newName" class="ui-field name selectable" maxlength="80" :placeholder="t('maps.pointName')" />
          <div class="kinds" role="group">
            <button
              v-for="k in WAYPOINT_KINDS"
              :key="k"
              type="button"
              class="kind"
              :class="{ on: newKind === k }"
              :style="{ '--k': WAYPOINT_COLORS[k] }"
              :aria-pressed="newKind === k"
              @click="newKind = k"
            >
              <span class="kdot" aria-hidden="true" />{{ t(`wp.kind.${k}`) }}
            </button>
          </div>
          <p class="note"><Info :size="15" aria-hidden="true" /><span>{{ t('maps.pointNote') }}</span></p>
          <div class="actions">
            <button type="button" class="btn" @click="adding = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ t('common.save') }}</button>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Cromo del mapa: superficies opacas (o casi) con filete fino.
 * Nada de backdrop-filter ni blur: la GPU de la Pi ya está ocupada con MapLibre.
 */
.maps {
  --chrome-bg: color-mix(in srgb, var(--surface) 95%, transparent);
  --chrome-border: color-mix(in srgb, var(--border) 90%, #000);
  --chrome-shadow: 0 2px 0 rgb(0 0 0 / 22%);

  position: relative;
  height: 100%;
}

.map {
  position: absolute;
  inset: 0;
  background: #1a1f1c;
}

/* ------------------------------------------------------------ Retícula */
.crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 30px;
  height: 30px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.crosshair svg {
  position: absolute;
  inset: 0;
}

.ch-halo {
  color: rgb(0 0 0 / 55%);
}

.ch-main {
  color: #e5527a;
}

/* ------------------------------------------------------------ Paneles flotantes */
.panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.top-left {
  left: 0.6rem;
  top: 0.6rem;
  max-width: 60%;
  align-items: flex-start;
}

.right {
  right: 0.6rem;
  top: 0.6rem;
  gap: 0.5rem;
}

/* Lectura principal: GNSS + centro + grabación, con filo del tono GNSS. */
.hud {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 15rem;
  max-width: 100%;
  padding: 0.5rem 0.75rem 0.55rem 0.9rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--chrome-border);
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--tone) 12%, transparent), transparent 60%),
    var(--chrome-bg);
  box-shadow: var(--chrome-shadow);
  overflow: hidden;
}

.hud::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--tone);
}

.hud-gnss,
.hud-rec {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.hud-gnss-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--tone);
}

.dot {
  flex: none;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
}

.hud-coords {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  color: var(--text);
}

.zoom {
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hairline);
  background: var(--surface-3);
  font-size: 0.75rem;
  color: var(--text-muted);
}

.hud-rec {
  padding-top: 0.3rem;
  border-top: 1px solid var(--hairline);
  font-size: 0.85rem;
}

.hud-rec strong {
  color: var(--tone);
}

.hud-rec .mono {
  color: var(--text-muted);
}

/* Selector de paquete cartográfico. */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: var(--touch);
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-bg);
  box-shadow: var(--chrome-shadow);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.chip svg {
  flex: none;
  color: var(--text-faint);
}

.chip.on {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
}

.chip.on svg {
  color: var(--accent);
}

.chip:active {
  transform: scale(0.97);
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  max-width: 100%;
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--info) 45%, var(--chrome-border));
  background: var(--chrome-bg);
  box-shadow: var(--chrome-shadow);
  font-size: 0.85rem;
  animation: fade-in 0.15s ease-out;
}

.toast svg {
  flex: none;
  margin-top: 0.1rem;
  color: var(--info);
}

/* Botonera: grupos unidos con filete fino entre botones. */
.rail {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  border: 1px solid var(--chrome-border);
  background: var(--surface);
  box-shadow: var(--chrome-shadow);
  overflow: hidden;
}

.mbtn {
  width: 3.25rem;
  height: 3.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-bottom: 1px solid var(--hairline);
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
  color: var(--text);
  cursor: pointer;
  transition: transform 0.08s ease-out, background-color 0.12s;
}

.mbtn:last-child {
  border-bottom: none;
}

.mbtn:active:not(:disabled) {
  background: var(--surface-3);
  transform: scale(0.97);
}

.mbtn:disabled {
  color: var(--text-faint);
  opacity: 0.5;
  cursor: not-allowed;
}

.mbtn.route svg {
  color: #6c9cff;
}

.mbtn.add {
  color: var(--accent);
}

.mbtn.rec {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 18%, var(--surface));
}

.mbtn.rec svg {
  fill: var(--danger);
}

/* ------------------------------------------------------------ Avisos e información */
.sim-badge {
  position: absolute;
  left: 50%;
  top: 0.6rem;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 34%;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 60%, #000);
  background: var(--danger);
  box-shadow: var(--chrome-shadow);
  color: #000;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.2;
}

.sim-badge svg {
  flex: none;
}

/* Resumen de la ruta calculada: abajo en el centro, opaco (sin desenfoque sobre el mapa). */
.route-card {
  position: absolute;
  left: 50%;
  bottom: 0.7rem;
  z-index: 5;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.4rem 0.35rem 0.5rem;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, #2f6fe0 60%, var(--chrome-border));
  background: var(--chrome-bg);
  box-shadow: 0 2px 10px rgb(0 0 0 / 30%);
  animation: pop-in 0.16s ease-out;
}

.route-icon {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  color: #8fb4ff;
  background: rgb(47 111 224 / 22%);
}

.route-main {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding-right: 0.3rem;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.route-main strong {
  color: var(--text);
  font-size: 1.2rem;
}

.btn.small {
  min-height: var(--touch);
  padding: 0 0.8rem;
  font-size: 0.9rem;
}

.btn.icon-only {
  min-width: var(--touch);
  padding: 0;
}

.route-sheet .route-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.route-lbl {
  flex: none;
  width: 4.5rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.route-sheet .seg {
  flex: 1;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 0.35rem;
}

.seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: var(--touch);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
}

.seg-btn[aria-pressed='true'] {
  color: var(--accent-ink);
  border-color: var(--accent);
  background: var(--accent);
}

.seg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.route-to {
  flex: 1;
}

.route-off,
.route-err {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.route-off .btn {
  margin-left: auto;
}

.route-err {
  color: var(--danger);
  font-weight: 700;
}

.map-info {
  position: absolute;
  left: 0.6rem;
  bottom: 2.1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 60%;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--chrome-border);
  background: var(--chrome-bg);
  color: var(--text-muted);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
}

.map-info svg {
  flex: none;
  color: var(--accent);
}

.sep {
  flex: none;
  width: 1px;
  height: 0.7rem;
  background: var(--border);
}

/* ------------------------------------------------------------ Hoja: añadir punto */
.sheet-backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  /* Arriba: el teclado en pantalla aparece abajo y taparía la ficha. */
  align-items: flex-start;
  justify-content: center;
  background: rgb(0 0 0 / 55%);
  animation: fade-in 0.14s ease-out;
}

.sheet {
  /* Ancha: los seis tipos de punto caben en una sola fila a 1024 px. */
  width: min(54rem, 100%);
  padding: 0.95rem 1.05rem 1.05rem;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  border: 1px solid var(--border);
  border-top: none;
  background:
    radial-gradient(90% 60% at 50% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%),
    var(--surface);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  animation: pop-in 0.16s ease-out;
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.orb {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--accent) 65%, transparent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 8%, transparent);
}

.sheet-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.sheet-title h2 {
  font-size: 1.15rem;
  letter-spacing: -0.01em;
}

.sheet-title p {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.name {
  font-size: 1.05rem;
}

.kinds {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.4rem;
}

/* Pantallas estrechas (móvil): en dos filas de tres. */
@media (max-width: 700px) {
  .kinds {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: var(--touch);
  padding: 0 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.08s ease-out;
}

.kind:active {
  transform: scale(0.97);
}

.kdot {
  flex: none;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--k);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--k) 25%, transparent);
}

.kind.on {
  color: var(--text);
  border-color: var(--k);
  background: color-mix(in srgb, var(--k) 18%, var(--surface-2));
  box-shadow: inset 0 0 0 1px var(--k);
}

.note {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
  font-size: 0.82rem;
  color: var(--text-faint);
}

.note svg {
  flex: none;
  margin-top: 0.1rem;
  color: var(--info);
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.actions .btn {
  min-height: 3.25rem;
}

/* ------------------------------------------------------------ Marcadores (DOM de MapLibre) */
:deep(.pos-marker) {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #2f8bff;
  border: 3px solid #fff;
  box-shadow: 0 0 0 6px rgb(47 139 255 / 30%);
}

:deep(.pos-marker.simulated) {
  background: #ff5a5a;
}

/* Respaldo LoRa: distinto del punto GNSS (aproximado y con antigüedad), sin animación. */
:deep(.lora-marker) {
  position: relative;
  width: 22px;
  height: 22px;
}

:deep(.lora-marker i) {
  position: absolute;
  inset: 2px;
  transform: rotate(45deg);
  border-radius: 4px;
  background: #e5b85c;
  border: 2px dashed #fff;
  box-shadow: 0 0 0 5px rgb(229 184 92 / 30%);
}

:deep(.lora-marker span) {
  position: absolute;
  left: 50%;
  top: 28px;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 999px;
  background: rgb(15 20 18 / 92%);
  border: 1px solid #e5b85c;
  color: #f3dfb0;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

:deep(.wp-marker) {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
  position: relative;
}

/* Etiqueta en píldora opaca: más nítida y barata que un text-shadow difuminado. */
:deep(.wp-marker span) {
  position: absolute;
  left: 18px;
  top: -3px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 18%);
  white-space: nowrap;
  font: 700 12px/1.2 system-ui, sans-serif;
  color: #111;
}

:deep(.maplibregl-ctrl-scale) {
  border-color: var(--text-muted);
  background: var(--chrome-bg);
  color: var(--text);
  font-family: var(--font-mono);
}
</style>
