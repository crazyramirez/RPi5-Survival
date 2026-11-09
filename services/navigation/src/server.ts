import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { NavFallbackPosition, NavFix, NavStatus, Probe, TrackPoint, TrackSummary } from '@survival-os/shared-types'
import { meshFallback, type MeshStatusLike } from './fallback.ts'
import { GpsdClient, STALE_AFTER_S, toFix } from './gpsd.ts'
import { parseGpx, trackToGpx, waypointsToGpx } from './gpx.ts'
import { DEFAULT_POLICY, shouldRecord, type RecorderPolicy } from './recorder.ts'
import { NavStore } from './store.ts'

const env = process.env
const HOST = env.NAV_HOST || '127.0.0.1'
const PORT = Number.parseInt(env.NAV_PORT ?? '', 10) || 8784
const DATA = env.NAV_DATA_DIR || (process.platform === 'linux' ? '/var/lib/survival-os/navigation' : '.data/navigation')
// Simulación SOLO fuera de producción y con opt-in explícito; la UI lo rotula como SIMULADO.
const SIMULATE = env.NAV_SIMULATE === '1' && env.NODE_ENV !== 'production'
const policy: RecorderPolicy = {
  ...DEFAULT_POLICY,
  intervalSeconds: Math.max(1, Number.parseInt(env.NAV_TRACK_INTERVAL ?? '', 10) || DEFAULT_POLICY.intervalSeconds),
}
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

const store = new NavStore(DATA)
let recording: { track: TrackSummary; last: { point: TrackPoint; at: number } | null; pending: Promise<void> } | null = null

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'navigation', msg, ...extra })}\n`)
}

function simulatedFix(): NavFix {
  const t = Date.now() / 1000
  return {
    fix: '3d',
    latitude: 40.4168 + Math.sin(t / 300) * 0.002,
    longitude: -3.7038 + Math.cos(t / 300) * 0.002,
    altitudeM: 657,
    speedMs: 1.4,
    courseDeg: (t * 1.2) % 360,
    horizontalErrorM: 5,
    satellitesUsed: 9,
    satellitesVisible: 14,
    time: new Date().toISOString(),
    ageSeconds: 0,
  }
}

function currentFix(): NavFix | null {
  return SIMULATE ? simulatedFix() : toFix(gpsd.state)
}

function onFix(): void {
  if (!recording) return
  const fix = currentFix()
  if (!fix) return
  const now = Date.now()
  const decision = shouldRecord(fix, recording.last, now, policy)
  if (!decision.record || !decision.point) return
  const rec = recording
  rec.last = { point: decision.point, at: now }
  const point = decision.point
  rec.pending = rec.pending
    .then(() => store.appendPoints(rec.track, [point], decision.distanceM))
    .catch((err: unknown) => log('error', 'track_write_failed', { error: String(err) }))
}

// Respaldo: posición del nodo LoRa (servicio survival-mesh en loopback). Se consulta cada 20 s.
const MESH_URL = env.MESH_URL || 'http://127.0.0.1:8787'
let meshStatus: MeshStatusLike | null = null
async function pollMesh(): Promise<void> {
  try {
    const r = await fetch(`${MESH_URL}/status`, { signal: AbortSignal.timeout(3000) })
    meshStatus = r.ok ? ((await r.json()) as MeshStatusLike) : null
  } catch {
    meshStatus = null
  }
}
if (!SIMULATE) {
  void pollMesh()
  setInterval(() => void pollMesh(), 20_000).unref()
}

const gpsd = new GpsdClient(env.GPSD_HOST || '127.0.0.1', Number.parseInt(env.GPSD_PORT ?? '', 10) || 2947, onFix)

function status(): NavStatus {
  const fix = currentFix()
  let gnss: NavStatus['gnss']
  if (fix) {
    gnss =
      fix.ageSeconds !== null && fix.ageSeconds > STALE_AFTER_S
        ? { state: 'unavailable', reason: `Sin datos del receptor desde hace ${Math.round(fix.ageSeconds)} s` }
        : { state: 'ok', value: fix, at: new Date().toISOString() }
  } else if (!gpsd.state.connected) {
    gnss = { state: 'unavailable', reason: 'gpsd no responde (no instalado o detenido)' }
  } else if (gpsd.state.devices.length === 0) {
    gnss = { state: 'unavailable', reason: 'Ningún receptor GNSS conectado a gpsd' }
  } else {
    gnss = { state: 'unavailable', reason: 'Receptor conectado, esperando datos' }
  }
  const fallback: Probe<NavFallbackPosition> = SIMULATE ? { state: 'unavailable', reason: 'Simulación' } : meshFallback(meshStatus, Date.now())
  return {
    gpsd: gpsd.state.connected || SIMULATE ? 'connected' : 'unreachable',
    devices: gpsd.state.devices,
    gnss,
    fallback,
    recording: recording
      ? { trackId: recording.track.id, points: recording.track.points, startedAt: recording.track.startedAt, intervalSeconds: policy.intervalSeconds }
      : null,
    simulated: SIMULATE,
  }
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 })
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req, 64 * 1024)
  try {
    const v = text ? (JSON.parse(text) as unknown) : {}
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const p = url.pathname
  const m = req.method ?? 'GET'

  if (m === 'GET' && p === '/health') return send(res, 200, { status: 'ok', service: 'navigation', version: VERSION, simulated: SIMULATE })
  if (m === 'GET' && p === '/status') return send(res, 200, status())

  if (p === '/waypoints' && m === 'GET') return send(res, 200, await store.listWaypoints())
  if (p === '/waypoints' && m === 'POST') {
    const b = await readJson(req)
    // "aquí": guardar la posición GNSS actual (solo con fijación real).
    if (b.here === true) {
      const fix = currentFix()
      if (!fix || fix.fix === 'none' || fix.latitude === null) return send(res, 409, { error: 'Sin fijación GNSS' })
      return send(res, 201, await store.addWaypoint({ name: b.name, kind: b.kind, note: b.note, latitude: fix.latitude, longitude: fix.longitude, origin: 'gnss' }))
    }
    return send(res, 201, await store.addWaypoint({ name: b.name, kind: b.kind, latitude: b.latitude, longitude: b.longitude, note: b.note, origin: 'usuario' }))
  }
  const wp = /^\/waypoints\/([\w-]{1,64})$/.exec(p)
  if (wp && m === 'DELETE') return send(res, (await store.deleteWaypoint(wp[1] ?? '')) ? 200 : 404, { ok: true })
  if (p === '/waypoints.gpx' && m === 'GET') return send(res, 200, waypointsToGpx(await store.listWaypoints()), 'application/gpx+xml; charset=utf-8')

  if (p === '/tracks' && m === 'GET') return send(res, 200, await store.listTracks())
  if (p === '/tracks/start' && m === 'POST') {
    if (recording) return send(res, 409, { error: 'Ya se está grabando un track' })
    const b = await readJson(req)
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `Track ${new Date().toLocaleString('es-ES')}`
    recording = { track: await store.createTrack(name, 'gnss'), last: null, pending: Promise.resolve() }
    log('info', 'recording_started', { id: recording.track.id })
    return send(res, 200, status())
  }
  if (p === '/tracks/stop' && m === 'POST') {
    if (!recording) return send(res, 409, { error: 'No hay grabación en curso' })
    const rec = recording
    recording = null
    await rec.pending
    await store.finishTrack(rec.track)
    log('info', 'recording_stopped', { id: rec.track.id, points: rec.track.points })
    return send(res, 200, rec.track)
  }
  const tr = /^\/tracks\/([\w-]{1,64})(\.gpx|\/points)?$/.exec(p)
  if (tr) {
    const id = tr[1] ?? ''
    const t = await store.getTrack(id)
    if (!t) return send(res, 404, { error: 'not_found' })
    if (m === 'DELETE') {
      if (recording?.track.id === id) return send(res, 409, { error: 'Detén la grabación antes de borrar' })
      await store.deleteTrack(id)
      return send(res, 200, { ok: true })
    }
    if (m === 'GET' && tr[2] === '.gpx') return send(res, 200, trackToGpx(t.name, await store.trackPoints(id)), 'application/gpx+xml; charset=utf-8')
    if (m === 'GET' && tr[2] === '/points') return send(res, 200, await store.trackPoints(id))
    if (m === 'GET') return send(res, 200, t)
  }
  if (p === '/gpx/import' && m === 'POST') {
    const parsed = parseGpx(await readBody(req, 10 * 1024 * 1024))
    for (const w of parsed.waypoints) {
      await store.addWaypoint({ name: w.name, kind: 'personal', latitude: w.lat, longitude: w.lon, note: w.note, origin: 'gpx' })
    }
    const tracks = []
    for (const t of parsed.tracks) tracks.push(await store.importTrack(t.name, t.points))
    return send(res, 200, { waypoints: parsed.waypoints.length, tracks: tracks.length, rejected: parsed.rejected })
  }
  send(res, 404, { error: 'not_found' })
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const code = (err as { status?: number }).status ?? 500
    if (code === 500) log('error', 'request_failed', { error: err instanceof Error ? err.message : String(err) })
    if (!res.headersSent) send(res, code, { error: code === 500 ? 'internal_error' : (err as Error).message })
    else res.end()
  })
})

async function main(): Promise<void> {
  await store.init()
  if (!SIMULATE) gpsd.start()
  else setInterval(onFix, 1000).unref()
  server.listen(PORT, HOST, () => log('info', 'listening', { host: HOST, port: PORT, version: VERSION, simulated: SIMULATE }))
}

async function shutdown(): Promise<void> {
  gpsd.stop()
  if (recording) {
    const rec = recording
    recording = null
    await rec.pending.catch(() => undefined)
    await store.finishTrack(rec.track).catch(() => undefined)
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

void main()
