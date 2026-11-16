import { Socket } from 'node:net'
import type { GnssFix, NavFix } from '@survival-os/shared-types'

/** Velocidad mínima (m/s) para considerar fiable el rumbo sobre el terreno (~3,6 km/h). */
export const MIN_SPEED_FOR_COURSE = 1.0
/** Un dato GNSS más antiguo que esto se considera caducado. */
export const STALE_AFTER_S = 15

/** Último dato de un receptor concreto (gpsd etiqueta TPV y SKY con `device`). */
export interface ReceiverState {
  tpv: Record<string, unknown> | null
  tpvAt: number | null
  satellitesUsed: number | null
  satellitesVisible: number | null
  /** HDOP del receptor (SKY), solo para comparar receptores sin estimación de error. */
  hdop: number | null
  /** Desviación típica del error en latitud y longitud (m) que informa el propio receptor (GST de gpsd). */
  gst: { lat: number; lon: number; at: number } | null
}

export interface GpsdState {
  connected: boolean
  devices: string[]
  /** Por dispositivo ('' si gpsd no lo indica). Puede haber varios receptores a la vez. */
  receivers: Record<string, ReceiverState>
  /** Receptor elegido ahora (el mejor; ver pickReceiver). */
  active: string | null
}

export function emptyState(): GpsdState {
  return { connected: false, devices: [], receivers: {}, active: null }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function receiver(state: GpsdState, msg: Record<string, unknown>): ReceiverState {
  const key = typeof msg.device === 'string' ? msg.device : ''
  let r = state.receivers[key]
  if (!r) {
    r = { tpv: null, tpvAt: null, satellitesUsed: null, satellitesVisible: null, hdop: null, gst: null }
    state.receivers[key] = r
  }
  return r
}

function forget(state: GpsdState, path: string): void {
  delete state.receivers[path]
  if (state.active === path) state.active = null
}

/** Aplica un mensaje JSON de gpsd al estado. Ignora clases desconocidas. */
export function applyMessage(state: GpsdState, msg: Record<string, unknown>, now = Date.now()): void {
  switch (msg.class) {
    case 'DEVICES': {
      const list = Array.isArray(msg.devices) ? (msg.devices as { path?: unknown }[]) : []
      state.devices = list.map((d) => (typeof d.path === 'string' ? d.path : '')).filter(Boolean)
      for (const k of Object.keys(state.receivers)) if (k && !state.devices.includes(k)) forget(state, k)
      break
    }
    case 'DEVICE': {
      const path = typeof msg.path === 'string' ? msg.path : null
      if (path && msg.activated === 0) {
        state.devices = state.devices.filter((d) => d !== path)
        forget(state, path)
      } else if (path && !state.devices.includes(path)) state.devices.push(path)
      break
    }
    case 'TPV': {
      const r = receiver(state, msg)
      r.tpv = msg
      r.tpvAt = now
      break
    }
    case 'SKY': {
      const r = receiver(state, msg)
      const sats = Array.isArray(msg.satellites) ? (msg.satellites as { used?: unknown }[]) : null
      r.satellitesUsed = num(msg.uSat) ?? (sats ? sats.filter((s) => s.used === true).length : null)
      r.satellitesVisible = num(msg.nSat) ?? (sats ? sats.length : null)
      r.hdop = num(msg.hdop)
      break
    }
    case 'GST': {
      const lat = num(msg.lat)
      const lon = num(msg.lon)
      if (lat !== null && lon !== null && lat > 0 && lon > 0) receiver(state, msg).gst = { lat, lon, at: now }
      break
    }
    default:
      break
  }
}

/** Un GST más antiguo que esto ya no describe el dato actual. */
const GST_STALE_MS = 10_000

const modeOf = (r: ReceiverState): number => (r.tpv ? (num(r.tpv.mode) ?? 0) : 0)

/**
 * Error horizontal (m) según el receptor, o null si no lo informa. Primero el GST (lo mide el propio receptor);
 * si no, el eph/epx/epy de gpsd (gpsd 3.2x lo calcula con el HDOP, así que dos receptores con igual HDOP empatan).
 */
export function errorOf(r: ReceiverState, now = Date.now()): number | null {
  const t = r.tpv
  if (!t) return null
  if (r.gst && now - r.gst.at <= GST_STALE_MS) return Math.round(Math.hypot(r.gst.lat, r.gst.lon) * 10) / 10
  const epx = num(t.epx)
  const epy = num(t.epy)
  return num(t.eph) ?? (epx !== null && epy !== null ? Math.round(Math.hypot(epx, epy) * 10) / 10 : null)
}

const fresh = (r: ReceiverState, now: number): boolean => r.tpvAt !== null && now - r.tpvAt <= STALE_AFTER_S * 1000

/**
 * ¿`a` es claramente mejor que `b`? Orden: fijación (3D > 2D > nada) → error estimado por el receptor (quien lo
 * informa gana a quien no) → HDOP → satélites usados. `margin` evita saltar de receptor por diferencias mínimas.
 */
export function better(a: ReceiverState, b: ReceiverState, margin = 1, now = Date.now()): boolean {
  const ma = Math.min(modeOf(a), 3)
  const mb = Math.min(modeOf(b), 3)
  if (ma !== mb) return ma > mb
  const ea = errorOf(a, now)
  const eb = errorOf(b, now)
  if (ea !== null && eb !== null) return ea * margin < eb
  if (ea !== null || eb !== null) return ea !== null
  if (a.hdop !== null && b.hdop !== null && a.hdop !== b.hdop) return a.hdop * margin < b.hdop
  const ua = a.satellitesUsed ?? -1
  const ub = b.satellitesUsed ?? -1
  return margin === 1 ? ua > ub : ua >= ub + 3
}

/**
 * Elige el receptor con mejor dato entre los que tienen datos recientes (si todos están caducados, el más reciente,
 * para que se vea «sin datos desde hace…»). Se mantiene el actual salvo que otro sea claramente mejor (20 %).
 */
export function pickReceiver(state: GpsdState, now = Date.now()): string | null {
  const keys = Object.keys(state.receivers).filter((k) => state.receivers[k]?.tpv)
  if (!keys.length) return (state.active = null)
  const live = keys.filter((k) => fresh(state.receivers[k] as ReceiverState, now))
  let best: string
  if (!live.length) {
    best = keys.reduce((a, b) => (((state.receivers[b] as ReceiverState).tpvAt ?? 0) > ((state.receivers[a] as ReceiverState).tpvAt ?? 0) ? b : a))
  } else {
    best = live.reduce((a, b) => (better(state.receivers[b] as ReceiverState, state.receivers[a] as ReceiverState, 1, now) ? b : a))
    const cur = state.active
    if (cur && cur !== best && live.includes(cur) && !better(state.receivers[best] as ReceiverState, state.receivers[cur] as ReceiverState, 1 / 0.8, now)) best = cur
  }
  state.active = best
  return best
}

/** Estado → NavFix del mejor receptor. Sin TPV → null (no hay dato que mostrar). */
export function toFix(state: GpsdState, now = Date.now()): NavFix | null {
  const key = pickReceiver(state, now)
  const r = key === null ? undefined : state.receivers[key]
  const t = r?.tpv
  if (!r || !t || r.tpvAt === null) return null
  const mode = num(t.mode) ?? 0
  const fix: GnssFix = mode >= 3 ? '3d' : mode === 2 ? '2d' : 'none'
  const hasPos = fix !== 'none'
  const speed = num(t.speed)
  const course = num(t.track)
  return {
    fix,
    latitude: hasPos ? num(t.lat) : null,
    longitude: hasPos ? num(t.lon) : null,
    altitudeM: fix === '3d' ? (num(t.altMSL) ?? num(t.alt)) : null,
    speedMs: hasPos ? speed : null,
    courseDeg: hasPos && speed !== null && speed >= MIN_SPEED_FOR_COURSE ? course : null,
    horizontalErrorM: errorOf(r, now),
    satellitesUsed: r.satellitesUsed,
    satellitesVisible: r.satellitesVisible,
    time: typeof t.time === 'string' ? t.time : null,
    ageSeconds: Math.round((now - r.tpvAt) / 100) / 10,
  }
}

/**
 * Cliente gpsd con reconexión (espera creciente hasta 60 s). Nunca lanza:
 * sin gpsd, el estado simplemente queda "desconectado".
 */
export class GpsdClient {
  readonly state: GpsdState = emptyState()
  private socket: Socket | null = null
  private buffer = ''
  private retryMs = 2000
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private readonly host: string
  private readonly port: number
  private readonly onFix: () => void

  /** Socket Unix de gpsd (Android, ADR 0020); si existe, sustituye a host:port. */
  private readonly socketPath: string | null

  constructor(host: string, port: number, onFix: () => void, socketPath: string | null = null) {
    this.host = host
    this.port = port
    this.onFix = onFix
    this.socketPath = socketPath
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.destroy()
  }

  private connect(): void {
    const s = new Socket()
    this.socket = s
    s.setEncoding('utf8')
    s.setTimeout(30_000)
    const onConnect = (): void => {
      this.state.connected = true
      this.retryMs = 2000
      s.write('?WATCH={"enable":true,"json":true};\n')
    }
    if (this.socketPath) s.connect(this.socketPath, onConnect)
    else s.connect(this.port, this.host, onConnect)
    s.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 1_000_000) this.buffer = '' // protección ante basura
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim()
        this.buffer = this.buffer.slice(nl + 1)
        if (!line.startsWith('{')) continue
        try {
          const msg = JSON.parse(line) as Record<string, unknown>
          applyMessage(this.state, msg)
          if (msg.class === 'TPV') this.onFix()
        } catch {
          // línea incompleta o corrupta: se ignora
        }
      }
    })
    // Sin datos durante 30 s con receptor activo no es error: gpsd calla si no hay dispositivo.
    s.on('timeout', () => undefined)
    const retry = (): void => {
      this.state.connected = false
      this.socket = null
      if (this.stopped) return
      this.timer = setTimeout(() => this.connect(), this.retryMs)
      this.retryMs = Math.min(60_000, this.retryMs * 2)
    }
    s.on('error', () => undefined)
    s.on('close', retry)
  }
}
