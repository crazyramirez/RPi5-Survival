import { realpathSync } from 'node:fs'
import type { Esp32Device, Esp32Status } from '@survival-os/shared-types'
import { chipName, LineSplitter, looksLikeMeshtastic, parseLine, PROTOCOL_VERSION, RateLimiter, readingsOf } from './esp32-protocol.ts'
import { log } from './mesh.ts'
import { openPort, type PortInfo, type SerialPort } from './serial.ts'

/**
 * Pasarela ESP32 (JSON Lines v1) de la versión portable (ADR 0016): MISMA API, MISMAS respuestas y
 * MISMAS reglas que services/esp32-gateway, que sigue siendo la de la Pi (systemd). Se sirve bajo
 * /esp32/* del HTTP de serial-hub y reutiliza su capa serie, así funciona en Windows, macOS y Linux.
 * - Detección por contenido: un puerto libre (ni malla ni GPS) que responde con líneas válidas del
 *   protocolo es una placa ESP32. Si lo que escribe es el registro de Meshtastic, se suelta.
 * - Puertos manuales (config.esp32): se abren sin sondeo, como ESP32_PORTS en la Pi.
 * Nunca se inventan datos: sin placa, `devices` va vacío y la interfaz lo dice.
 */

export const PING_LINE = `${JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' })}\n`
/** Cada puerto abierto ocupa un hilo del pool de libuv con una lectura bloqueante: se limita el número de placas. */
export const MAX_DEVICES = 4
/** Una placa desenchufada se sigue mostrando (desconectada) este tiempo, como en la Pi. */
const KEEP_GONE_MS = 120_000
/** Un puerto que no respondió al sondeo no se vuelve a abrir hasta pasado este tiempo (o hasta reconectarlo). */
const RETRY_MS = 600_000
const BAUD = 115200

type Opener = (path: string, baud: number) => Promise<SerialPort>
type Verdict = 'esp32' | 'meshtastic' | null

/** Clave para comparar puertos: COM5 = com5; en Linux/macOS, la ruta real (/dev/serial/by-id/… → /dev/ttyACM0). */
export function portKey(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return path.toUpperCase()
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** ¿Qué es esta línea? 'esp32' si es un mensaje válido del protocolo v1; 'meshtastic' si es el registro de un nodo. */
export function classifyLine(line: string): Verdict {
  if (looksLikeMeshtastic(line)) return 'meshtastic'
  return parseLine(line).ok ? 'esp32' : null
}

/** Nombre del chip USB; sin VID (macOS) se usa el nombre del puerto. */
export function chipOf(p: PortInfo): string {
  return p.vid ? chipName(p.vid, p.pid) : p.label || chipName(null, null)
}

export function newDevice(path: string, chip: string): Esp32Device {
  return {
    id: path.split(/[\\/]/).pop() || path,
    port: path,
    chip,
    connected: false,
    firmware: null,
    lastSeen: null,
    readings: [],
    events: [],
    stats: { lines: 0, invalid: 0, dropped: 0 },
  }
}

/**
 * Aplica una línea recibida al dispositivo (misma lógica que handleLine de services/esp32-gateway).
 * Devuelve true si la línea es del registro de Meshtastic: el puerto hay que soltarlo.
 */
export function applyLine(dev: Esp32Device, limiter: RateLimiter, line: string, now: Date = new Date()): boolean {
  dev.stats.lines++
  if (!limiter.allow(now.getTime())) {
    dev.stats.dropped++
    return false
  }
  const r = parseLine(line)
  if (!r.ok) {
    dev.stats.invalid++
    return looksLikeMeshtastic(line)
  }
  const { msg } = r
  const at = now.toISOString()
  dev.id = msg.device
  dev.lastSeen = at
  switch (msg.type) {
    case 'hello':
      dev.firmware = typeof msg.payload.firmware === 'string' ? msg.payload.firmware.slice(0, 40) : null
      if (typeof msg.payload.chip === 'string') dev.chip = msg.payload.chip.slice(0, 40)
      break
    case 'reading':
    case 'heartbeat':
      for (const rd of readingsOf(msg.payload)) {
        const existing = dev.readings.find((x) => x.sensor === rd.sensor)
        if (existing) Object.assign(existing, rd, { at })
        else if (dev.readings.length < 32) dev.readings.push({ ...rd, at })
      }
      break
    case 'event':
    case 'error':
      dev.events.unshift({
        kind: msg.type === 'error' ? 'error' : typeof msg.payload.event === 'string' ? msg.payload.event.slice(0, 24) : 'evento',
        detail: JSON.stringify(msg.payload).slice(0, 160),
        at,
      })
      dev.events.length = Math.min(dev.events.length, 20)
      break
    default:
      break
  }
  return false
}

/** Tabla de puertos de /status: por qué se usa o no cada uno (mismo criterio y orden que la Pi). */
export function describePorts(
  list: PortInfo[],
  roles: { gps: string | string[] | null; mesh: string | null; esp32: Set<string>; meshtastic: Set<string> },
  key: (p: string) => string,
): Esp32Status['ports'] {
  const gps = new Set((Array.isArray(roles.gps) ? roles.gps : [roles.gps]).filter((g): g is string => !!g).map(key))
  const mesh = roles.mesh ? key(roles.mesh) : null
  return list.map((p) => {
    const k = key(p.path)
    let use: Esp32Status['ports'][number]['use'] = 'ignorado'
    if (gps.has(k)) use = 'gpsd'
    else if (k === mesh || roles.meshtastic.has(k)) use = 'meshtastic'
    else if (roles.esp32.has(k)) use = 'esp32'
    return { path: p.path, vendorId: p.vid, productId: p.pid, chip: chipOf(p), use }
  })
}

/**
 * Valida la lista manual de puertos ESP32 de /config ({esp32: [puerto, …] | null}).
 * `taken`: puertos de la malla y del GPS (un puerto solo tiene una función).
 */
export function parseEsp32Ports(v: unknown, isPort: (s: string) => boolean, taken: (string | null)[], key: (p: string) => string): string[] {
  const bad = (msg: string): Error => Object.assign(new Error(msg), { status: 400 })
  if (v === null) return []
  if (!Array.isArray(v) || v.length > MAX_DEVICES) throw bad('Lista de puertos ESP32 no válida')
  const out: string[] = []
  for (const p of v) {
    if (typeof p !== 'string' || !isPort(p)) throw bad('Puerto no válido')
    if (!out.some((x) => key(x) === key(p))) out.push(p)
  }
  const used = new Set(taken.filter((t): t is string => !!t).map(key))
  if (out.some((p) => used.has(key(p)))) throw bad('Ese puerto ya está asignado a la malla o al GPS')
  return out
}

interface Conn {
  key: string
  manual: boolean
  dev: Esp32Device
  port: SerialPort | null
  limiter: RateLimiter
  goneAt: number | null
}

export class Esp32Hub {
  private conns = new Map<string, Conn>() // clave: portKey
  /** Puertos que escriben el registro de Meshtastic: no se vuelven a abrir mientras sigan conectados. */
  private meshtastic = new Set<string>()
  /** Puertos sondeados sin respuesta → momento del sondeo. */
  private tried = new Map<string, number>()
  private list: PortInfo[] = []
  private roles: { gps: string[]; mesh: string | null } = { gps: [], mesh: null }
  private readonly open: Opener
  private readonly platform: NodeJS.Platform

  constructor(opts: { open?: Opener; platform?: NodeJS.Platform } = {}) {
    this.open = opts.open ?? openPort
    this.platform = opts.platform ?? process.platform
  }

  key = (path: string): string => portKey(path, this.platform)

  status(): Esp32Status {
    const esp32 = new Set([...this.conns.values()].filter((c) => c.port).map((c) => c.key))
    return { devices: [...this.conns.values()].map((c) => c.dev), ports: describePorts(this.list, { ...this.roles, esp32, meshtastic: this.meshtastic }, this.key) }
  }

  /** Claves de los puertos abiertos como ESP32 (la malla y el GPS no deben tocarlos). */
  busy(): Set<string> {
    return new Set([...this.conns.values()].filter((c) => c.port).map((c) => c.key))
  }

  /** ¿Merece la pena sondear este puerto? (no abierto, no Meshtastic, sin sondeo fallido reciente, hay hueco). */
  shouldProbe(path: string, now = Date.now()): boolean {
    const k = this.key(path)
    if (this.conns.has(k) || this.meshtastic.has(k) || this.conns.size >= MAX_DEVICES) return false
    return now - (this.tried.get(k) ?? -Infinity) >= RETRY_MS
  }

  isMeshtastic(path: string): boolean {
    return this.meshtastic.has(this.key(path))
  }

  /** Tras cambiar la configuración: se vuelve a evaluar todo desde cero. */
  forget(): void {
    this.tried.clear()
    this.meshtastic.clear()
  }

  /** Cierra ya las placas abiertas en estos puertos (acaban de asignarse a la malla o al GPS). */
  release(paths: (string | null)[]): void {
    for (const p of paths) {
      if (!p) continue
      const c = this.conns.get(this.key(p))
      if (!c) continue
      this.disconnect(c, 'asignado a otra función')
      this.conns.delete(c.key)
    }
  }

  async ping(id: string): Promise<boolean> {
    const c = [...this.conns.values()].find((x) => x.dev.id === id && x.port)
    if (!c?.port) return false
    await c.port.write(Buffer.from(PING_LINE))
    return true
  }

  /**
   * Reconcilia puertos presentes ↔ placas: retira lo desenchufado o reasignado y abre los puertos manuales.
   * La detección automática va aparte (probe), desde el bucle de sondeo de serial-hub.
   */
  async reconcile(list: PortInfo[], opts: { mesh: string | null; gps: string | string[] | null; manual: string[] }, now = Date.now()): Promise<void> {
    this.list = list
    const gpsList = (Array.isArray(opts.gps) ? opts.gps : [opts.gps]).filter((g): g is string => !!g)
    this.roles = { mesh: opts.mesh, gps: gpsList }
    const present = new Map(list.map((p) => [this.key(p.path), p]))
    // Un puerto que desaparece queda libre: lo que se conecte después se vuelve a evaluar.
    for (const k of this.meshtastic) if (!present.has(k)) this.meshtastic.delete(k)
    for (const k of this.tried.keys()) if (!present.has(k)) this.tried.delete(k)
    const reserved = new Set([opts.mesh, ...gpsList].filter((p): p is string => !!p).map(this.key))
    const manual = new Set(opts.manual.map(this.key))
    for (const [k, c] of this.conns) {
      if (!present.has(k)) {
        // Desenchufada: se conserva desconectada unos minutos para que la interfaz la muestre.
        this.disconnect(c, 'puerto retirado')
        c.goneAt ??= now
        if (now - c.goneAt >= KEEP_GONE_MS) this.conns.delete(k)
      } else if (reserved.has(k) || (c.manual && !manual.has(k)) || !c.port) {
        // Reasignado, quitado de la lista manual o caído con el puerto presente: se cierra y se reevalúa.
        this.disconnect(c, reserved.has(k) ? 'asignado a otra función' : 'reconexión')
        this.conns.delete(k)
      }
    }
    for (const k of manual) {
      const p = present.get(k)
      if (!p || reserved.has(k) || this.meshtastic.has(k) || this.conns.has(k)) continue
      if (this.conns.size >= MAX_DEVICES) {
        log('warn', 'esp32_limit', { port: p.path, max: MAX_DEVICES })
        break
      }
      try {
        const port = await this.open(p.path, BAUD)
        const c = this.attach(port, p, true)
        const splitter = new LineSplitter()
        port.stream.on('data', (chunk: string | Buffer) => {
          for (const line of splitter.push(String(chunk))) this.onLine(c, line)
        })
        await port.write(Buffer.from(PING_LINE)).catch(() => undefined)
        log('info', 'esp32_connected', { port: p.path, manual: true })
      } catch (err) {
        log('warn', 'esp32_open_failed', { port: p.path, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /**
   * Sondeo: abre el puerto a 115200, envía ping y escucha hasta `timeoutMs`. Si responde con el protocolo
   * v1 la placa se queda abierta (sin reabrir: no se pierde nada ni se reinicia la placa). Si escribe el
   * registro de Meshtastic, se suelta y se marca. Nunca se abre un puerto reservado: lo comprueba quien llama.
   */
  async probe(info: PortInfo, timeoutMs = 3500, now = Date.now()): Promise<Verdict> {
    const k = this.key(info.path)
    if (!this.shouldProbe(info.path, now)) return this.meshtastic.has(k) ? 'meshtastic' : null
    let port: SerialPort
    try {
      port = await this.open(info.path, BAUD)
    } catch {
      this.tried.set(k, now)
      return null
    }
    const splitter = new LineSplitter()
    const seen: string[] = []
    let verdict = null as Verdict // se asigna desde los manejadores del flujo
    let finish: () => void = () => undefined
    const decided = new Promise<void>((resolve) => (finish = resolve))
    let sink = (line: string): void => {
      if (seen.length < 64) seen.push(line)
      verdict ??= classifyLine(line)
      if (verdict) finish()
    }
    port.stream.setEncoding('utf8')
    port.stream.on('data', (chunk: string | Buffer) => {
      for (const line of splitter.push(String(chunk))) sink(line)
    })
    port.stream.on('error', () => finish())
    port.stream.on('close', () => finish())
    // Segundo ping por si la placa se reinició al abrir el puerto y no oyó el primero.
    const again = setTimeout(() => void port.write(Buffer.from(PING_LINE)).catch(() => undefined), Math.min(1500, timeoutMs / 2))
    const limit = setTimeout(finish, timeoutMs)
    await port.write(Buffer.from(PING_LINE)).catch(() => undefined)
    await decided
    clearTimeout(again)
    clearTimeout(limit)
    if (verdict === 'esp32' && this.conns.size < MAX_DEVICES && !this.conns.has(k)) {
      const c = this.attach(port, info, false)
      sink = (line) => this.onLine(c, line)
      for (const line of seen) if (c.port) this.onLine(c, line)
      if (c.port) log('info', 'esp32_connected', { port: info.path, chip: c.dev.chip })
      return c.port ? 'esp32' : 'meshtastic'
    }
    port.close()
    if (verdict === 'meshtastic') {
      this.meshtastic.add(k)
      log('info', 'meshtastic_released', { port: info.path })
    } else this.tried.set(k, now)
    return verdict === 'esp32' ? null : verdict
  }

  close(): void {
    for (const c of this.conns.values()) this.disconnect(c, 'cierre')
  }

  private attach(port: SerialPort, info: PortInfo, manual: boolean): Conn {
    const c: Conn = { key: this.key(info.path), manual, dev: newDevice(info.path, chipOf(info)), port, limiter: new RateLimiter(50), goneAt: null }
    c.dev.connected = true
    this.conns.set(c.key, c)
    this.tried.delete(c.key)
    port.stream.setEncoding('utf8')
    const lost = (why: string): void => {
      if (c.port === port) this.disconnect(c, why)
    }
    port.stream.on('error', (err: Error) => lost(err.message))
    port.stream.on('end', () => lost('fin de flujo'))
    port.stream.on('close', () => lost('cerrado'))
    return c
  }

  private onLine(c: Conn, line: string): void {
    if (applyLine(c.dev, c.limiter, line)) this.releaseAsMeshtastic(c)
  }

  /** Suelta un puerto que resulta ser un nodo Meshtastic (la malla lo necesita en exclusiva). */
  private releaseAsMeshtastic(c: Conn): void {
    this.meshtastic.add(c.key)
    this.disconnect(c, 'nodo Meshtastic')
    this.conns.delete(c.key)
    log('info', 'meshtastic_released', { port: c.dev.port })
  }

  private disconnect(c: Conn, why: string): void {
    const p = c.port
    c.dev.connected = false
    if (!p) return
    c.port = null
    p.close()
    log('info', 'esp32_disconnected', { port: c.dev.port, why })
  }
}
