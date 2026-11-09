import { execFile } from 'node:child_process'
import { createReadStream, readFileSync, realpathSync } from 'node:fs'
import { open, readdir, readFile, type FileHandle } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { ReadStream } from 'node:fs'
import type { Esp32Device, Esp32Status } from '@survival-os/shared-types'
import { chipName, LineSplitter, looksLikeMeshtastic, parseLine, PROTOCOL_VERSION, RateLimiter, readingsOf } from './protocol.ts'

const env = process.env
const HOST = env.ESP32_HOST || '127.0.0.1'
const PORT = Number.parseInt(env.ESP32_PORT ?? '', 10) || 8785
/** Puertos adicionales (placas con CH340/CP210x), p. ej. /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0 */
const EXTRA = (env.ESP32_PORTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const NAV_URL = env.NAV_URL || 'http://127.0.0.1:8784'
const MESH_ENV = env.MESH_ENV || '/etc/survival-os/mesh.env'
const SCAN_MS = 5000
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

interface Conn {
  real: string
  dev: Esp32Device
  stream: ReadStream | null
  writer: FileHandle | null
  splitter: LineSplitter
  limiter: RateLimiter
}

const conns = new Map<string, Conn>() // clave: ruta real del puerto
/** Puertos reconocidos como nodos Meshtastic por su salida: no se vuelven a abrir mientras sigan conectados. */
const meshtasticPorts = new Set<string>()
let lastPorts: Esp32Status['ports'] = []

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'esp32-gateway', msg, ...extra })}\n`)
}

async function usbIds(tty: string): Promise<{ vid: string | null; pid: string | null }> {
  // /sys/class/tty/ttyACM0/device → interfaz USB; idVendor está en el dispositivo padre.
  for (const up of ['../idVendor', '../../idVendor', '../../../idVendor']) {
    try {
      const base = `/sys/class/tty/${tty}/device/${up.replace('idVendor', '')}`
      const vid = (await readFile(`${base}idVendor`, 'utf8')).trim()
      const pid = (await readFile(`${base}idProduct`, 'utf8')).trim()
      return { vid, pid }
    } catch {
      // probar el siguiente nivel
    }
  }
  return { vid: null, pid: null }
}

async function gpsdDevices(): Promise<string[]> {
  try {
    const res = await fetch(`${NAV_URL}/status`, { signal: AbortSignal.timeout(1500) })
    const j = (await res.json()) as { devices?: string[] }
    return (j.devices ?? []).map((d) => {
      try {
        return realpathSync(d)
      } catch {
        return d
      }
    })
  } catch {
    return []
  }
}

function stty(port: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile('stty', ['-F', port, '115200', 'raw', '-echo', '-hupcl', 'cs8', '-cstopb', '-parenb'], { timeout: 3000 }, (err) => resolve(!err)),
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

function handleLine(c: Conn, line: string): void {
  c.dev.stats.lines++
  if (!c.limiter.allow()) {
    c.dev.stats.dropped++
    return
  }
  const r = parseLine(line)
  if (!r.ok) {
    c.dev.stats.invalid++
    if (looksLikeMeshtastic(line)) releaseAsMeshtastic(c)
    return
  }
  const { msg } = r
  c.dev.id = msg.device
  c.dev.lastSeen = nowIso()
  switch (msg.type) {
    case 'hello':
      c.dev.firmware = typeof msg.payload.firmware === 'string' ? msg.payload.firmware.slice(0, 40) : null
      if (typeof msg.payload.chip === 'string') c.dev.chip = msg.payload.chip.slice(0, 40)
      break
    case 'reading':
    case 'heartbeat':
      for (const rd of readingsOf(msg.payload)) {
        const existing = c.dev.readings.find((x) => x.sensor === rd.sensor)
        if (existing) Object.assign(existing, rd, { at: nowIso() })
        else if (c.dev.readings.length < 32) c.dev.readings.push({ ...rd, at: nowIso() })
      }
      break
    case 'event':
    case 'error':
      c.dev.events.unshift({
        kind: msg.type === 'error' ? 'error' : typeof msg.payload.event === 'string' ? msg.payload.event.slice(0, 24) : 'evento',
        detail: JSON.stringify(msg.payload).slice(0, 160),
        at: nowIso(),
      })
      c.dev.events.length = Math.min(c.dev.events.length, 20)
      break
    default:
      break
  }
}

/** Suelta un puerto que resulta ser un nodo Meshtastic (otro proceso, la malla, lo necesita en exclusiva). */
function releaseAsMeshtastic(c: Conn): void {
  if (meshtasticPorts.has(c.real)) return
  meshtasticPorts.add(c.real)
  c.dev.connected = false
  c.stream?.destroy()
  void c.writer?.close().catch(() => undefined)
  c.writer = null
  conns.delete(c.real)
  lastPorts = lastPorts.map((p) => (p.path === c.real ? { ...p, use: 'meshtastic' } : p))
  log('info', 'meshtastic_released', { port: c.dev.port })
}

async function connect(path: string, real: string, chip: string): Promise<void> {
  const conn: Conn = {
    real,
    dev: { id: basename(path), port: path, chip, connected: false, firmware: null, lastSeen: null, readings: [], events: [], stats: { lines: 0, invalid: 0, dropped: 0 } },
    stream: null,
    writer: null,
    splitter: new LineSplitter(),
    limiter: new RateLimiter(50),
  }
  conns.set(real, conn)
  if (!(await stty(real))) {
    log('warn', 'stty_failed', { port: path })
    conns.delete(real)
    return
  }
  try {
    conn.writer = await open(real, 'w')
    // highWaterMark pequeño: lecturas frecuentes y poca memoria.
    const stream = createReadStream(real, { highWaterMark: 1024, encoding: 'utf8' })
    conn.stream = stream
    conn.dev.connected = true
    stream.on('data', (chunk) => {
      for (const line of conn.splitter.push(String(chunk))) handleLine(conn, line)
    })
    const drop = (why: string): void => {
      if (!conn.dev.connected) return
      conn.dev.connected = false
      void conn.writer?.close().catch(() => undefined)
      conn.writer = null
      stream.destroy()
      log('info', 'disconnected', { port: path, why })
    }
    stream.on('error', (err) => drop(err.message))
    stream.on('end', () => drop('fin de flujo'))
    stream.on('close', () => drop('cerrado'))
    await sendTo(conn, { v: PROTOCOL_VERSION, type: 'ping' })
    log('info', 'connected', { port: path, chip })
  } catch (err) {
    log('warn', 'open_failed', { port: path, error: err instanceof Error ? err.message : String(err) })
    conn.dev.connected = false
  }
}

async function sendTo(c: Conn, msg: Record<string, unknown>): Promise<void> {
  if (!c.writer) throw new Error('no conectado')
  await c.writer.write(`${JSON.stringify(msg)}\n`)
}

/**
 * Puerto asignado a la pasarela Meshtastic (/etc/survival-os/mesh.env, MESH_SERIAL=/dev/serial/by-id/…).
 * Un nodo Meshtastic con ESP32-S3 nativo (303a:*) se reclamaría como ESP32: se excluye siempre.
 */
async function meshDevice(): Promise<string | null> {
  const env = await readFile(MESH_ENV, 'utf8').catch(() => '')
  const port = /^MESH_SERIAL=(.+)$/m.exec(env)?.[1]?.trim()
  if (!port) return null
  try {
    return realpathSync(port)
  } catch {
    return null
  }
}

/** Reconcilia puertos presentes ↔ conexiones. Nunca bloquea: todo es asíncrono y con timeout. */
async function scan(): Promise<void> {
  if (process.platform !== 'linux') return
  const ttys = (await readdir('/dev').catch(() => [] as string[])).filter((n) => /^tty(ACM|USB)\d+$/.test(n))
  // Un nodo Meshtastic desenchufado deja libre su ttyACM: lo que se conecte después se vuelve a evaluar.
  for (const p of meshtasticPorts) if (!ttys.includes(basename(p))) meshtasticPorts.delete(p)
  const gpsd = await gpsdDevices()
  const mesh = await meshDevice()
  const ports: Esp32Status['ports'] = []
  const wanted = new Map<string, { path: string; chip: string }>()
  for (const tty of ttys) {
    const path = `/dev/${tty}`
    const { vid, pid } = await usbIds(tty)
    const chip = chipName(vid, pid)
    let use: Esp32Status['ports'][number]['use'] = 'ignorado'
    if (gpsd.includes(path)) use = 'gpsd'
    else if (mesh === path || meshtasticPorts.has(path)) use = 'meshtastic'
    else if (vid === '303a') use = 'esp32'
    else if (EXTRA.some((e) => { try { return realpathSync(e) === path } catch { return false } })) use = 'esp32'
    ports.push({ path, vendorId: vid, productId: pid, chip, use })
    if (use === 'esp32') wanted.set(realpathSync(path), { path, chip })
  }
  // Puertos configurados que no son ttyACM/ttyUSB (p. ej. /dev/serial/by-id/…, o el simulador en /dev/pts).
  for (const extra of EXTRA) {
    try {
      const real = realpathSync(extra)
      if (!wanted.has(real) && !gpsd.includes(real) && real !== mesh && !ports.some((p) => p.path === real)) {
        wanted.set(real, { path: extra, chip: 'configurado' })
        ports.push({ path: extra, vendorId: null, productId: null, chip: 'configurado', use: 'esp32' })
      }
    } catch {
      // no presente ahora mismo
    }
  }
  lastPorts = ports
  for (const [real, c] of conns) {
    if (!wanted.has(real) || !c.dev.connected) {
      c.stream?.destroy()
      void c.writer?.close().catch(() => undefined)
      // Conservar el dispositivo desconectado en la lista unos minutos para que la UI lo muestre.
      if (!wanted.has(real)) {
        c.dev.connected = false
        setTimeout(() => {
          if (conns.get(real) === c && !c.dev.connected) conns.delete(real)
        }, 120_000).unref()
      } else {
        conns.delete(real)
      }
    }
  }
  for (const [real, w] of wanted) {
    if (!conns.has(real)) await connect(w.path, real, w.chip)
  }
}

function status(): Esp32Status {
  return { devices: [...conns.values()].map((c) => c.dev), ports: lastPorts }
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', service: 'esp32-gateway', version: VERSION })
  if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, status())
  const ping = /^\/devices\/([\w.-]{1,64})\/ping$/.exec(url.pathname)
  if (req.method === 'POST' && ping) {
    const c = [...conns.values()].find((x) => x.dev.id === ping[1] && x.dev.connected)
    if (!c) return send(res, 404, { error: 'Dispositivo no conectado' })
    await sendTo(c, { v: PROTOCOL_VERSION, type: 'ping' })
    return send(res, 200, { ok: true })
  }
  send(res, 404, { error: 'not_found' })
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    log('error', 'request_failed', { error: err instanceof Error ? err.message : String(err) })
    if (!res.headersSent) send(res, 500, { error: 'internal_error' })
  })
})

server.listen(PORT, HOST, () => log('info', 'listening', { host: HOST, port: PORT, version: VERSION, extraPorts: EXTRA.length }))
const timer = setInterval(() => void scan().catch((err: unknown) => log('error', 'scan_failed', { error: String(err) })), SCAN_MS)
void scan()

function shutdown(): void {
  clearInterval(timer)
  for (const c of conns.values()) {
    c.stream?.destroy()
    void c.writer?.close().catch(() => undefined)
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
