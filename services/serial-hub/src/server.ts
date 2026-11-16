import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Esp32Hub, parseEsp32Ports, portKey } from './esp32.ts'
import { Gps } from './gps.ts'
import { Mesh, Store, log, VERSION } from './mesh.ts'
import { looksLikeNmea } from './nmea.ts'
import { FrameParser, frame, wantConfig } from './meshtastic.ts'
import { KNOWN_VIDS, listPorts, openPort, type PortInfo } from './serial.ts'

/**
 * serial-hub (ADR 0016): nodo Meshtastic + receptor GNSS + placas ESP32 por USB en Windows, macOS y Linux.
 *   HTTP (MESH_PORT): misma API que survival-mesh (/status /nodes /channels /messages /send /time /track
 *   /refresh) + /ports, /config y /gps; y bajo /esp32/* la misma API que services/esp32-gateway
 *   (/esp32/health, /esp32/status, POST /esp32/devices/<id>/ping).
 *   TCP (GPSD_PORT): protocolo gpsd para el servicio de navegación.
 * Detección automática: los puertos USB-serie conocidos se sondean (primero solo escuchando NMEA; luego un
 * ping del protocolo ESP32 v1; luego el intercambio Meshtastic, que no transmite nada por radio). La
 * elección manual siempre manda y un puerto solo tiene una función.
 */
const env = process.env
const HOST = env.SERIAL_HUB_HOST || '127.0.0.1'
const PORT = Number(env.MESH_PORT || 8787)
const GPSD_PORT = Number(env.GPSD_PORT || 2947)
const DATA = env.SERIAL_HUB_DATA || join(process.cwd(), 'serial-hub')
const CONFIG = join(DATA, 'config.json')
mkdirSync(DATA, { recursive: true })

const PORT_RE = process.platform === 'win32' ? /^COM\d{1,3}$/i : /^\/dev\/(serial\/by-id\/[\w.:+-]{1,200}|tty(ACM|USB)\d{1,3}|cu\.[\w.-]{1,100})$/

interface Config {
  meshPort: string | null
  gpsPort: string | null
  gpsBaud: number | null
  /** Puertos asignados a mano a placas ESP32 (se abren sin sondeo). */
  esp32: string[]
  auto: boolean
}
function loadConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(CONFIG, 'utf8')) as Partial<Config>
    const esp32 = Array.isArray(c.esp32) ? c.esp32.filter((p): p is string => typeof p === 'string' && PORT_RE.test(p)) : []
    return { meshPort: c.meshPort ?? null, gpsPort: c.gpsPort ?? null, gpsBaud: c.gpsBaud ?? null, esp32, auto: c.auto !== false }
  } catch {
    return { meshPort: null, gpsPort: null, gpsBaud: null, esp32: [], auto: true }
  }
}
const config = loadConfig()
function saveConfig(): void {
  writeFileSync(`${CONFIG}.tmp`, JSON.stringify(config, null, 2))
  renameSync(`${CONFIG}.tmp`, CONFIG)
}

const store = new Store(join(DATA, 'mesh.db'))
const mesh = new Mesh(store, DATA)
const gps = new Gps()
gps.listen(GPSD_PORT, HOST)
const esp32 = new Esp32Hub()

// ------------------------------------------------------------------ detección y conexión

let ports: PortInfo[] = []
const failed = new Map<string, number>() // puerto → momento del último sondeo fallido

async function probeNmea(path: string): Promise<number | null> {
  for (const baud of [9600, 4800, 38400, 115200]) {
    let text = ''
    try {
      const p = await openPort(path, baud)
      p.stream.setEncoding('latin1')
      p.stream.on('data', (d: string | Buffer) => (text += String(d)))
      p.stream.on('error', () => undefined)
      await new Promise((r) => setTimeout(r, 2500))
      p.close()
    } catch {
      return null
    }
    if (looksLikeNmea(text)) return baud
  }
  return null
}

async function probeMeshtastic(path: string): Promise<boolean> {
  try {
    const p = await openPort(path, 115200)
    let got = false
    const parser = new FrameParser(() => (got = true))
    p.stream.on('data', (d: string | Buffer) => parser.push(typeof d === 'string' ? Buffer.from(d, 'latin1') : d))
    p.stream.on('error', () => undefined)
    await p.write(new Uint8Array(32).fill(0xc3))
    await new Promise((r) => setTimeout(r, 100))
    await p.write(frame(wantConfig(1)))
    for (let i = 0; i < 25 && !got; i++) await new Promise((r) => setTimeout(r, 200))
    p.close()
    return got
  } catch {
    return false
  }
}

let syncing = false
async function sync(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    ports = await listPorts()
    const present = new Set(ports.map((p) => p.path))
    // Un puerto desenchufado y vuelto a enchufar se evalúa enseguida.
    for (const p of failed.keys()) if (!present.has(p)) failed.delete(p)
    // ESP32 primero: suelta los puertos que ahora son de la malla o del GPS antes de que estos los abran.
    await esp32.reconcile(ports, { mesh: config.meshPort, gps: config.gpsPort, manual: config.esp32 })
    // Conexiones configuradas.
    if (config.meshPort && !mesh.connected && present.has(config.meshPort)) {
      await mesh.connect(config.meshPort).catch((err: Error) => {
        mesh.setError(`No se pudo abrir el nodo: ${err.message}`)
        log('warn', 'connect_failed', { error: err.message })
      })
    } else if (config.meshPort && !present.has(config.meshPort)) mesh.setError('Nodo no conectado por USB')
    if (config.gpsPort && !gps.connected && present.has(config.gpsPort)) {
      await gps.connect(config.gpsPort, config.gpsBaud ?? 9600).catch((err: Error) => log('warn', 'gps_connect_failed', { error: err.message }))
    }
    // Detección automática de lo que falte, solo en puertos USB-serie conocidos y libres. Las placas ESP32
    // pueden ser varias: se busca siempre, pero cada puerto sin respuesta se deja tranquilo un rato (Esp32Hub).
    if (config.auto) {
      const reserved = new Set([config.meshPort, config.gpsPort].filter((p): p is string => !!p).map((p) => portKey(p)))
      for (const p of ports) {
        if (reserved.has(portKey(p.path)) || esp32.busy().has(portKey(p.path)) || (p.vid && !KNOWN_VIDS.has(p.vid))) continue
        if (Date.now() - (failed.get(p.path) ?? 0) < 120_000) continue
        if (!config.gpsPort) {
          const baud = await probeNmea(p.path)
          if (baud) {
            config.gpsPort = p.path
            config.gpsBaud = baud
            saveConfig()
            log('info', 'gps_detected', { port: p.path, baud })
            await gps.connect(p.path, baud).catch(() => undefined)
            continue
          }
        }
        if (esp32.shouldProbe(p.path) && (await esp32.probe(p)) === 'esp32') continue
        if (!config.meshPort && (await probeMeshtastic(p.path))) {
          config.meshPort = p.path
          saveConfig()
          log('info', 'mesh_detected', { port: p.path })
          await mesh.connect(p.path).catch((err: Error) => mesh.setError(`No se pudo abrir el nodo: ${err.message}`))
          continue
        }
        failed.set(p.path, Date.now())
      }
    }
    if (!config.meshPort && !mesh.connected) mesh.setError('Ningún nodo Meshtastic detectado por USB')
  } catch (err) {
    log('error', 'sync_failed', { error: err instanceof Error ? err.message : String(err) })
  } finally {
    syncing = false
  }
}
void sync()
setInterval(() => void sync(), 15_000)

// ------------------------------------------------------------------ HTTP

function send(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 4096) throw Object.assign(new Error('Cuerpo vacío o demasiado grande'), { status: 400 })
    chunks.push(c as Buffer)
  }
  if (!chunks.length) throw Object.assign(new Error('Cuerpo vacío o demasiado grande'), { status: 400 })
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('JSON no válido'), { status: 400 })
  }
}

/** /esp32/*: mismas rutas y respuestas que services/esp32-gateway (NUXT_ESP32_URL apunta aquí en la portable). */
async function handleEsp32(m: string, path: string, res: ServerResponse): Promise<void> {
  if (m === 'GET' && path === '/health') return send(res, 200, { status: 'ok', service: 'esp32-gateway', version: VERSION })
  if (m === 'GET' && path === '/status') return send(res, 200, esp32.status())
  const ping = /^\/devices\/([\w.-]{1,64})\/ping$/.exec(path)
  if (m === 'POST' && ping?.[1]) {
    if (!(await esp32.ping(ping[1]))) return send(res, 404, { error: 'Dispositivo no conectado' })
    return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'not_found' })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://hub')
  const m = req.method ?? 'GET'
  if (u.pathname.startsWith('/esp32/')) return handleEsp32(m, u.pathname.slice('/esp32'.length), res)
  if (m === 'GET') {
    if (u.pathname === '/health') return send(res, 200, { status: 'ok', service: 'serial-hub', version: VERSION })
    if (u.pathname === '/status') return send(res, 200, mesh.status())
    if (u.pathname === '/nodes') return send(res, 200, mesh.nodes())
    if (u.pathname === '/channels') return send(res, 200, mesh.channels())
    if (u.pathname === '/track') return send(res, 200, { id: mesh.trackId })
    if (u.pathname === '/time') return send(res, 200, mesh.timeStatus())
    if (u.pathname === '/messages') {
      const limit = Math.max(1, Math.min(500, Number.parseInt(u.searchParams.get('limit') ?? '100', 10) || 100))
      return send(res, 200, store.list(limit))
    }
    if (u.pathname === '/gps') return send(res, 200, gps.status())
    if (u.pathname === '/ports') {
      ports = await listPorts()
      return send(res, 200, { ports, configured: { mesh: config.meshPort, gps: config.gpsPort, gpsBaud: config.gpsBaud, esp32: config.esp32, auto: config.auto } })
    }
    return send(res, 404, { error: 'not_found' })
  }
  if (m !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
  if (u.pathname === '/refresh') return send(res, 200, await mesh.refresh())
  const body = await readJson(req)
  if (u.pathname === '/send') return send(res, 200, await mesh.send(body))
  if (u.pathname === '/track') return send(res, 200, mesh.setTrack(body))
  if (u.pathname === '/config') {
    // {mesh?: puerto|null, gps?: puerto|null, gpsBaud?: n, esp32?: [puerto…]|null, auto?: bool}
    const port = (v: unknown): string | null => {
      if (v === null) return null
      if (typeof v !== 'string' || !PORT_RE.test(v)) throw Object.assign(new Error('Puerto no válido'), { status: 400 })
      return v
    }
    // Se valida antes de cambiar nada. Un puerto solo tiene una función: si la malla o el GPS pasan a un
    // puerto de la lista ESP32, ese puerto sale de la lista; una lista ESP32 con sus puertos se rechaza.
    const nextMesh = 'mesh' in body ? port(body.mesh) : config.meshPort
    const nextGps = 'gps' in body ? port(body.gps) : config.gpsPort
    const nextEsp32 =
      'esp32' in body
        ? parseEsp32Ports(body.esp32, (s) => PORT_RE.test(s), [nextMesh, nextGps], (p) => portKey(p))
        : config.esp32.filter((p) => ![nextMesh, nextGps].some((t) => t && portKey(t) === portKey(p)))
    config.esp32 = nextEsp32
    if ('mesh' in body) {
      config.meshPort = port(body.mesh)
      mesh.close()
    }
    if ('gps' in body) {
      config.gpsPort = port(body.gps)
      gps.close()
    }
    if ('gpsBaud' in body) {
      const b = Number(body.gpsBaud)
      if (![4800, 9600, 19200, 38400, 57600, 115200].includes(b)) throw Object.assign(new Error('Baudios no válidos'), { status: 400 })
      config.gpsBaud = b
    }
    if ('auto' in body) config.auto = body.auto === true
    saveConfig()
    failed.clear()
    esp32.forget()
    esp32.release([config.meshPort, config.gpsPort])
    void sync()
    return send(res, 200, { configured: config })
  }
  return send(res, 404, { error: 'not_found' })
}

createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const status = (err as { status?: number }).status ?? (err instanceof RangeError ? 400 : 500)
    if (status === 500) log('error', 'request_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'error' })
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Error interno' : (err as Error).message })
  })
}).listen(PORT, HOST, () => log('info', 'listening', { host: HOST, port: PORT, gpsd: GPSD_PORT, version: VERSION }))

const stop = (): void => {
  mesh.close()
  gps.close()
  esp32.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
