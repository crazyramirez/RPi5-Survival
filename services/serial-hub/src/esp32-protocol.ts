import type { Esp32MessageType } from '@survival-os/shared-types'

/**
 * Protocolo serie v1 (JSON Lines, 115200 8N1), una línea por mensaje:
 *   {"v":1,"type":"reading","device":"cyd-1","ts":12345,"payload":{"sensor":"temp_c","value":21.5,"unit":"°C"}}
 * Tipos: hello (firmware, chip), heartbeat, reading (uno o `readings: [...]`), event, ack, error.
 * La Pi → ESP32: {"v":1,"type":"ping"} → el ESP32 responde "ack".
 */
export const PROTOCOL_VERSION = 1
export const MAX_LINE_BYTES = 2048
const TYPES: Esp32MessageType[] = ['hello', 'heartbeat', 'reading', 'event', 'ack', 'error']

export interface Message {
  type: Esp32MessageType
  device: string
  ts: number | null
  payload: Record<string, unknown>
}

export type ParseResult = { ok: true; msg: Message } | { ok: false; reason: string }

export function parseLine(line: string): ParseResult {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) return { ok: false, reason: 'línea demasiado larga' }
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { ok: false, reason: 'JSON inválido' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'no es un objeto' }
  const o = raw as Record<string, unknown>
  if (o.v !== PROTOCOL_VERSION) return { ok: false, reason: `versión no soportada (${String(o.v)})` }
  if (!TYPES.includes(o.type as Esp32MessageType)) return { ok: false, reason: 'tipo desconocido' }
  if (typeof o.device !== 'string' || !/^[\w.-]{1,64}$/.test(o.device)) return { ok: false, reason: 'device inválido' }
  const payload = o.payload === undefined ? {} : o.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'payload inválido' }
  return {
    ok: true,
    msg: { type: o.type as Esp32MessageType, device: o.device, ts: typeof o.ts === 'number' && Number.isFinite(o.ts) ? o.ts : null, payload: payload as Record<string, unknown> },
  }
}

export interface ParsedReading {
  sensor: string
  value: number
  unit: string
}

/** Extrae lecturas válidas (nombre corto, valor finito, unidad corta). Las demás se descartan. */
export function readingsOf(payload: Record<string, unknown>): ParsedReading[] {
  const list = Array.isArray(payload.readings) ? payload.readings : [payload]
  const out: ParsedReading[] = []
  for (const r of list.slice(0, 32)) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    if (typeof x.sensor !== 'string' || !/^[\w.-]{1,32}$/.test(x.sensor)) continue
    if (typeof x.value !== 'number' || !Number.isFinite(x.value)) continue
    out.push({ sensor: x.sensor, value: x.value, unit: typeof x.unit === 'string' ? x.unit.slice(0, 12) : '' })
  }
  return out
}

// Secuencias de color ANSI (ESC [ … m) del registro de Meshtastic.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const MESHTASTIC_LOG_RE = /^(?:DEBUG|INFO|WARN|ERROR|CRIT|TRACE)\s*\|\s*[\d?]{2}:[\d?]{2}:[\d?]{2}\s+\d+\s+\[[^\]]+\]/

/**
 * ¿Es una línea del registro de depuración de un nodo Meshtastic? (p. ej. «DEBUG | 14:24:32 139 [Router] …»,
 * con colores ANSI). Un nodo Meshtastic con ESP32-S3 tiene el mismo USB (303a:1001) que un ESP32 propio:
 * se distingue por lo que escribe, y la pasarela lo suelta para no robarle el puerto a la malla.
 */
export function looksLikeMeshtastic(line: string): boolean {
  return MESHTASTIC_LOG_RE.test(line.replace(ANSI_RE, '').trim())
}

/** Separador de líneas tolerante a fragmentos y basura (descarta líneas gigantes sin acumular memoria). */
export class LineSplitter {
  private buf = ''
  private discarding = false

  push(chunk: string): string[] {
    const lines: string[] = []
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      if (this.discarding) {
        this.discarding = false
        continue
      }
      if (line.trim()) lines.push(line.trim())
    }
    if (this.buf.length > MAX_LINE_BYTES * 2) {
      this.buf = ''
      this.discarding = true
    }
    return lines
  }
}

/** Limitador de ritmo por ventana de 1 s. */
export class RateLimiter {
  private windowStart = 0
  private count = 0
  private readonly max: number

  constructor(maxPerSecond: number) {
    this.max = maxPerSecond
  }

  allow(now = Date.now()): boolean {
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.count = 0
    }
    this.count++
    return this.count <= this.max
  }
}

/** Chips USB conocidos → nombre. Espressif nativo (303a) es el único que se reclama automáticamente. */
export function chipName(vid: string | null, pid: string | null): string {
  const id = `${vid ?? '?'}:${pid ?? '?'}`
  if (vid === '303a') return 'ESP32 (USB nativo)'
  const known: Record<string, string> = {
    '10c4:ea60': 'CP210x',
    '1a86:7523': 'CH340',
    '1a86:55d4': 'CH9102',
    '0403:6001': 'FTDI',
    '067b:2303': 'PL2303',
    '1546:01a7': 'u-blox 7',
    '1546:01a8': 'u-blox 8',
    '1546:01a9': 'u-blox 9',
  }
  return known[id] ?? id
}
