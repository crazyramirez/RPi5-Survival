import { Socket } from 'node:net'
import type { GnssFix, NavFix } from '@survival-os/shared-types'

/** Velocidad mínima (m/s) para considerar fiable el rumbo sobre el terreno (~3,6 km/h). */
export const MIN_SPEED_FOR_COURSE = 1.0
/** Un dato GNSS más antiguo que esto se considera caducado. */
export const STALE_AFTER_S = 15

export interface GpsdState {
  connected: boolean
  devices: string[]
  tpv: Record<string, unknown> | null
  tpvAt: number | null
  satellitesUsed: number | null
  satellitesVisible: number | null
}

export function emptyState(): GpsdState {
  return { connected: false, devices: [], tpv: null, tpvAt: null, satellitesUsed: null, satellitesVisible: null }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Aplica un mensaje JSON de gpsd al estado. Ignora clases desconocidas. */
export function applyMessage(state: GpsdState, msg: Record<string, unknown>, now = Date.now()): void {
  switch (msg.class) {
    case 'DEVICES': {
      const list = Array.isArray(msg.devices) ? (msg.devices as { path?: unknown }[]) : []
      state.devices = list.map((d) => (typeof d.path === 'string' ? d.path : '')).filter(Boolean)
      break
    }
    case 'DEVICE': {
      const path = typeof msg.path === 'string' ? msg.path : null
      if (path && msg.activated === 0) state.devices = state.devices.filter((d) => d !== path)
      else if (path && !state.devices.includes(path)) state.devices.push(path)
      break
    }
    case 'TPV':
      state.tpv = msg
      state.tpvAt = now
      break
    case 'SKY': {
      const sats = Array.isArray(msg.satellites) ? (msg.satellites as { used?: unknown }[]) : null
      state.satellitesUsed = num(msg.uSat) ?? (sats ? sats.filter((s) => s.used === true).length : null)
      state.satellitesVisible = num(msg.nSat) ?? (sats ? sats.length : null)
      break
    }
    default:
      break
  }
}

/** Estado → NavFix. Sin TPV → null (no hay dato que mostrar). */
export function toFix(state: GpsdState, now = Date.now()): NavFix | null {
  const t = state.tpv
  if (!t || state.tpvAt === null) return null
  const mode = num(t.mode) ?? 0
  const fix: GnssFix = mode >= 3 ? '3d' : mode === 2 ? '2d' : 'none'
  const hasPos = fix !== 'none'
  const speed = num(t.speed)
  const course = num(t.track)
  const epx = num(t.epx)
  const epy = num(t.epy)
  return {
    fix,
    latitude: hasPos ? num(t.lat) : null,
    longitude: hasPos ? num(t.lon) : null,
    altitudeM: fix === '3d' ? (num(t.altMSL) ?? num(t.alt)) : null,
    speedMs: hasPos ? speed : null,
    courseDeg: hasPos && speed !== null && speed >= MIN_SPEED_FOR_COURSE ? course : null,
    horizontalErrorM: num(t.eph) ?? (epx !== null && epy !== null ? Math.round(Math.hypot(epx, epy) * 10) / 10 : null),
    satellitesUsed: state.satellitesUsed,
    satellitesVisible: state.satellitesVisible,
    time: typeof t.time === 'string' ? t.time : null,
    ageSeconds: Math.round((now - state.tpvAt) / 100) / 10,
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

  constructor(host: string, port: number, onFix: () => void) {
    this.host = host
    this.port = port
    this.onFix = onFix
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
    s.connect(this.port, this.host, () => {
      this.state.connected = true
      this.retryMs = 2000
      s.write('?WATCH={"enable":true,"json":true};\n')
    })
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
