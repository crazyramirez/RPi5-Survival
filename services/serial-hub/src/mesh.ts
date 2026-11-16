import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomInt } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { BROADCAST, FrameParser, Session, decodeFromRadio, frame, heartbeat, nodeId, positionRequest, textPacket, wantConfig, type NodeDict, type PacketDict } from './meshtastic.ts'
import { openPort, type SerialPort } from './serial.ts'

/**
 * Pasarela Meshtastic en Node (ADR 0016): MISMA API y MISMAS reglas que services/mesh/survival_mesh.py
 * (sin inventar datos, hora solo del canal PRIVADO, sin claves en respuestas ni registros).
 */
export const VERSION = '0.5.0-node'
export const MAX_TEXT_BYTES = 200
const MAX_MESSAGES = 2000
const SEND_INTERVAL_S = 3
const REFRESH_INTERVAL_S = 60
const HANDSHAKE_TIMEOUT_S = 30
const HEARTBEAT_S = 300
export const NODE_ID_RE = /^![0-9a-f]{8}$/
export const TIME_FLOOR = 1767225600
const TIME_AGREE_S = 10
const TIME_MAX_AGE_S = 2700
const TIME_KEEP = 6

export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'serial-hub', msg, ...extra })}\n`)
}

export function iso(epoch: unknown): string | null {
  const e = typeof epoch === 'number' ? epoch : Number(epoch)
  if (!Number.isFinite(e) || e < 1577836800) return null
  return new Date(e * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function precisionM(bits: unknown): number | null {
  if (typeof bits !== 'number' || !Number.isInteger(bits) || bits <= 0 || bits >= 32) return null
  return Math.round((2 ** (32 - bits) * 1e-7 * 111_320) / 2)
}

export interface Position {
  lat: number
  lon: number
  alt: number | null
  at: string | null
  precisionM: number | null
  cached?: boolean
}

export function nodeSummary(n: NodeDict, myNum: number | null): Record<string, unknown> & { id: string | null; isMe: boolean; lastHeard: string | null; position: Position | null } {
  const user = n.user ?? {}
  const pos = n.position ?? {}
  const met = n.deviceMetrics ?? {}
  let position: Position | null = null
  if (typeof pos.latitude === 'number' && typeof pos.longitude === 'number' && !(pos.latitude === 0 && pos.longitude === 0)) {
    position = { lat: pos.latitude, lon: pos.longitude, alt: pos.altitude ?? null, at: iso(pos.time), precisionM: precisionM(pos.precisionBits) }
  }
  const level = met.batteryLevel
  const battery = typeof level === 'number' ? { level: level > 100 ? null : Math.trunc(level), powered: level > 100, voltage: met.voltage ?? null } : null
  return {
    id: user.id ?? (typeof n.num === 'number' ? nodeId(n.num) : null),
    num: n.num,
    longName: user.longName ?? null,
    shortName: user.shortName ?? null,
    hwModel: user.hwModel ?? null,
    role: user.role ?? 'CLIENT',
    isMe: myNum !== null && n.num === myNum,
    lastHeard: iso(n.lastHeard),
    snr: n.snr ?? null,
    hopsAway: n.hopsAway ?? null,
    battery,
    channelUtilization: met.channelUtilization ?? null,
    position,
  }
}

export interface TextMessage {
  packetId: number | null
  from: string | null
  to: string | null
  channel: number
  text: string
  rxTime: string | null
  snr?: number | null
  rssi?: number | null
  hops?: number | null
}

export function textMessage(p: PacketDict, now = Date.now() / 1000): TextMessage | null {
  if (p.decoded?.portnum !== 'TEXT_MESSAGE_APP' || typeof p.decoded.text !== 'string') return null
  const hops = p.hopStart !== null && p.hopLimit !== null ? p.hopStart - p.hopLimit : null
  return { packetId: p.id, from: p.fromId, to: p.toId, channel: p.channel, text: p.decoded.text, rxTime: iso(p.rxTime) ?? iso(now), snr: p.rxSnr, rssi: p.rxRssi, hops }
}

export function validateSend(body: Record<string, unknown>, channelIndexes: number[]): { text: string; channel: number; to: string | null } {
  const raw = body.text
  if (typeof raw !== 'string' || !raw.trim()) throw new RangeError('Escribe un mensaje')
  const text = raw.trim()
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new RangeError(`Mensaje demasiado largo (máx. ${MAX_TEXT_BYTES} bytes)`)
  const channel = body.channel ?? 0
  if (typeof channel !== 'number' || !Number.isInteger(channel) || !channelIndexes.includes(channel)) throw new RangeError('Canal no válido')
  const to = body.to ?? null
  if (to !== null && (typeof to !== 'string' || !NODE_ID_RE.test(to))) throw new RangeError('Destino no válido')
  return { text, channel, to }
}

export interface TimeSample {
  from: string | null
  nodeTime: number
  mono: number
}

export function timeSample(p: PacketDict, privateChannels: Set<number>, monoNow: number): TimeSample | null {
  if (p.decoded?.portnum !== 'POSITION_APP') return null
  if (!privateChannels.has(p.channel)) return null
  const t = p.decoded.position?.time
  if (typeof t !== 'number' || !Number.isInteger(t) || t < TIME_FLOOR) return null
  return { from: p.fromId, nodeTime: t, mono: monoNow }
}

export function estimateTime(samples: TimeSample[], monoNow: number): Record<string, unknown> | null {
  const recent = samples.filter((x) => monoNow - x.mono <= TIME_MAX_AGE_S)
  if (recent.length < 2) return null
  const a = recent[recent.length - 2] as TimeSample
  const b = recent[recent.length - 1] as TimeSample
  const ea = a.nodeTime + (monoNow - a.mono)
  const eb = b.nodeTime + (monoNow - b.mono)
  if (Math.abs(ea - eb) > TIME_AGREE_S) return null
  const r1 = (v: number): number => Math.round(v * 10) / 10
  return { utc: r1(eb), from: b.from, samples: 2, spreadS: r1(Math.abs(ea - eb)), newestAgeS: r1(monoNow - b.mono) }
}

export function rememberPosition(cached: Position | null | undefined, current: Position | null | undefined): Position | null {
  if (!current?.at) return cached ?? null
  if (cached?.at && cached.at >= current.at) return cached
  const kept: Position = { lat: current.lat, lon: current.lon, alt: current.alt, at: current.at, precisionM: null }
  if (current.precisionM !== null) kept.precisionM = current.precisionM
  else delete (kept as { precisionM?: number | null }).precisionM
  return kept
}

export function validateTrack(body: Record<string, unknown>): string | null {
  if (!('id' in body)) throw new RangeError('Falta el nodo')
  const id = body.id
  if (id === null) return null
  if (typeof id !== 'string' || !NODE_ID_RE.test(id)) throw new RangeError('Nodo no válido')
  return id
}

// ------------------------------------------------------------------ almacenamiento (SQLite)

export class Store {
  private readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, packet_id INTEGER, dir TEXT NOT NULL, from_id TEXT, to_id TEXT,
        channel INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, at TEXT NOT NULL,
        snr REAL, rssi INTEGER, hops INTEGER, UNIQUE(packet_id, from_id));`)
  }
  add(m: TextMessage, dir: 'in' | 'out'): void {
    this.db
      .prepare('INSERT OR IGNORE INTO messages (packet_id, dir, from_id, to_id, channel, text, at, snr, rssi, hops) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.packetId, dir, m.from, m.to, m.channel, m.text, m.rxTime ?? iso(Date.now() / 1000), m.snr ?? null, m.rssi ?? null, m.hops ?? null)
    this.db.prepare('DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)').run(MAX_MESSAGES)
  }
  list(limit: number): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT id, dir AS direction, from_id AS "from", to_id AS "to", channel, text, at, snr, rssi, hops FROM messages ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[]
  }
}

const readJson = (p: string): unknown => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (p: string, v: unknown): void => {
  writeFileSync(`${p}.tmp`, JSON.stringify(v))
  renameSync(`${p}.tmp`, p)
}

// ------------------------------------------------------------------ conexión con el nodo

export class Mesh {
  private port: SerialPort | null = null
  private session = new Session()
  private connectedAt: string | null = null
  private lastPacketAt: string | null = null
  private error: string | null = 'Nodo no conectado por USB'
  private lastSend = -Infinity
  private lastRefresh = -Infinity
  private samples: TimeSample[] = []
  private hbTimer: NodeJS.Timeout | null = null
  private positions: Record<string, Position> = {}
  trackId: string | null = null
  serialPath: string | null = null
  private readonly store: Store
  private readonly positionsPath: string
  private readonly trackPath: string

  constructor(store: Store, stateDir: string) {
    this.store = store
    this.positionsPath = `${stateDir}/last-positions.json`
    this.trackPath = `${stateDir}/track.json`
    const raw = readJson(this.positionsPath)
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, Position>)) {
        const kept = NODE_ID_RE.test(k) ? rememberPosition(null, v) : null
        if (kept) this.positions[k] = kept
      }
    }
    const t = readJson(this.trackPath) as { id?: unknown } | null
    this.trackId = typeof t?.id === 'string' && NODE_ID_RE.test(t.id) ? t.id : null
  }

  get connected(): boolean {
    return this.port !== null && this.session.configComplete
  }

  /** Abre el nodo y hace el intercambio de configuración. Lanza si no responde en HANDSHAKE_TIMEOUT_S. */
  async connect(path: string): Promise<void> {
    this.close()
    this.serialPath = path
    const port = await openPort(path, 115200)
    const session = new Session()
    const parser = new FrameParser((payload) => {
      try {
        const fr = decodeFromRadio(payload)
        const pkt = session.apply(fr)
        if (pkt) this.onPacket(pkt, session)
      } catch {
        // trama dañada: se descarta
      }
    })
    port.stream.on('data', (d: string | Buffer) => parser.push(typeof d === 'string' ? Buffer.from(d, 'latin1') : d))
    port.stream.on('error', () => this.lost(port))
    port.stream.on('close', () => this.lost(port))
    this.port = port
    this.session = session
    // Despertar (32 × START2) y pedir la configuración, como la librería oficial.
    await port.write(new Uint8Array(32).fill(0xc3))
    await new Promise((r) => setTimeout(r, 100))
    await port.write(frame(wantConfig(randomInt(1, 0x7fffffff))))
    const deadline = Date.now() + HANDSHAKE_TIMEOUT_S * 1000
    while (!session.configComplete && Date.now() < deadline && this.port === port) await new Promise((r) => setTimeout(r, 200))
    if (!session.configComplete) {
      this.close()
      throw new Error('El nodo no respondió al intercambio de configuración')
    }
    this.connectedAt = iso(Date.now() / 1000)
    this.error = null
    this.hbTimer = setInterval(() => void this.port?.write(frame(heartbeat())).catch(() => undefined), HEARTBEAT_S * 1000)
    log('info', 'connected', { port: path })
  }

  private lost(port: SerialPort): void {
    if (this.port !== port) return // aviso tardío de una conexión anterior
    log('warn', 'connection_lost')
    this.error = 'Conexión con el nodo perdida'
    this.close()
  }

  close(): void {
    if (this.hbTimer) clearInterval(this.hbTimer)
    this.hbTimer = null
    const p = this.port
    this.port = null
    this.connectedAt = null
    p?.close()
  }

  setError(msg: string): void {
    if (!this.port) this.error = msg
  }

  private onPacket(p: PacketDict, session: Session): void {
    this.lastPacketAt = iso(Date.now() / 1000)
    const m = textMessage(p)
    if (m) {
      this.store.add(m, 'in')
      log('info', 'text_received', { channel: m.channel, bytes: Buffer.byteLength(m.text, 'utf8') })
      return
    }
    const ts = timeSample(p, this.privateChannels(session), performance.now() / 1000)
    if (ts) this.samples = [...this.samples, ts].slice(-TIME_KEEP)
  }

  private privateChannels(session = this.session): Set<number> {
    const out = new Set<number>()
    for (const c of session.channels.values()) if (c.role !== 0 && c.pskLength >= 16) out.add(c.index)
    return out
  }

  private myNum(): number | null {
    return this.port ? this.session.myNodeNum : null
  }

  nodes(): Record<string, unknown>[] {
    if (!this.port) return []
    const me = this.myNum()
    const out = [...this.session.nodes.values()].map((n) => nodeSummary(n, me))
    for (const n of out) if (n.isMe || (n.id && n.id === this.trackId)) this.updateLastPos(n.id, n.position)
    const heard = (n: { lastHeard: string | null }): number => (n.lastHeard ? Date.parse(n.lastHeard) : 0)
    out.sort((a, b) => Number(!a.isMe) - Number(!b.isMe) || heard(b) - heard(a))
    return out
  }

  channels(): { index: number; name: string | null; role: string }[] {
    if (!this.port) return []
    const roles: Record<number, string> = { 1: 'PRIMARY', 2: 'SECONDARY' }
    return [...this.session.channels.values()]
      .filter((c) => c.role !== 0)
      .sort((a, b) => a.index - b.index)
      .map((c) => ({ index: c.index, name: c.name || null, role: roles[c.role] ?? 'DISABLED' }))
  }

  timeStatus(): Record<string, unknown> {
    return { privateChannel: this.privateChannels().size > 0, samples: this.samples.length, estimate: estimateTime(this.samples, performance.now() / 1000) }
  }

  private withCached(s: Record<string, unknown> & { position: Position | null }, cached: Position | undefined): Record<string, unknown> {
    return !s.position && cached ? { ...s, position: { ...cached, cached: true } } : s
  }

  status(): Record<string, unknown> {
    let me: Record<string, unknown> | null = null
    let tracked: Record<string, unknown> | null = null
    if (this.port) {
      const meNum = this.myNum()
      const node = meNum !== null ? this.session.nodes.get(meNum) : undefined
      const mine = node ? nodeSummary(node, meNum) : { id: null, position: null, isMe: true, lastHeard: null }
      this.updateLastPos(mine.id, mine.position)
      me = this.withCached({ ...mine, firmware: this.session.firmware }, this.positions[mine.id ?? ''])
      if (this.trackId && this.trackId !== mine.id) {
        const other = [...this.session.nodes.values()].find((n) => nodeId(n.num) === this.trackId)
        const summ = other ? nodeSummary(other, meNum) : { id: this.trackId, longName: null, shortName: null, lastHeard: null, position: null, isMe: false }
        this.updateLastPos(this.trackId, summ.position)
        tracked = this.withCached(summ, this.positions[this.trackId])
      } else tracked = me
    }
    return {
      version: VERSION,
      connected: this.port !== null,
      transport: this.serialPath ? 'usb' : null,
      port: this.serialPath,
      connectedAt: this.connectedAt,
      lastPacketAt: this.lastPacketAt,
      error: this.port ? null : this.error,
      me,
      trackId: this.trackId,
      tracked,
      nodeCount: this.port ? this.session.nodes.size : 0,
      maxTextBytes: MAX_TEXT_BYTES,
    }
  }

  private updateLastPos(id: string | null, pos: Position | null): void {
    if (!id || !NODE_ID_RE.test(id)) return
    const old = this.positions[id]
    const next = rememberPosition(old, pos)
    if (!next || next === old || JSON.stringify(next) === JSON.stringify(old)) return
    this.positions[id] = next
    // Solo el propio y el seguido: no se archiva la posición de terceros.
    const me = this.myNum()
    const keep = new Set([this.trackId, me !== null ? nodeId(me) : null])
    this.positions = Object.fromEntries(Object.entries(this.positions).filter(([k]) => keep.has(k)))
    try {
      writeJson(this.positionsPath, this.positions)
    } catch (err) {
      log('warn', 'last_position_save_failed', { error: (err as Error).name })
    }
  }

  setTrack(body: Record<string, unknown>): { id: string | null } {
    const id = validateTrack(body)
    this.trackId = id
    writeJson(this.trackPath, { id })
    log('info', 'track_set', { own: id === null })
    return { id }
  }

  async refresh(): Promise<Record<string, unknown>> {
    if (!this.port) throw Object.assign(new Error(this.error ?? 'Nodo no conectado'), { status: 503 })
    const me = this.myNum()
    const meId = me !== null ? nodeId(me) : null
    const target = this.trackId && this.trackId !== meId ? this.trackId : null
    if (!target) return { requested: null, reason: 'own' }
    const priv = [...this.privateChannels()].sort((a, b) => a - b)
    if (!priv.length) throw Object.assign(new Error('Sin canal privado: no se pide la posición por el canal público'), { status: 400 })
    const wait = REFRESH_INTERVAL_S - (performance.now() / 1000 - this.lastRefresh)
    if (wait > 0) throw Object.assign(new Error(`Espera ${Math.ceil(wait)} s entre peticiones`), { status: 429 })
    await this.port.write(frame(positionRequest({ to: Number.parseInt(target.slice(1), 16), channel: priv[0] as number, id: randomInt(1, 0x7fffffff) })))
    this.lastRefresh = performance.now() / 1000
    log('info', 'position_requested', { channel: priv[0] })
    return { requested: target }
  }

  async send(body: Record<string, unknown>): Promise<TextMessage> {
    if (!this.port) throw Object.assign(new Error(this.error ?? 'Nodo no conectado'), { status: 503 })
    const { text, channel, to } = validateSend(body, this.channels().map((c) => c.index).length ? this.channels().map((c) => c.index) : [0])
    const wait = SEND_INTERVAL_S - (performance.now() / 1000 - this.lastSend)
    if (wait > 0) throw Object.assign(new Error(`Espera ${Math.ceil(wait)} s entre mensajes`), { status: 429 })
    const id = randomInt(1, 0x7fffffff)
    await this.port.write(frame(textPacket({ to: to ? Number.parseInt(to.slice(1), 16) : BROADCAST, channel, text, id, wantAck: to !== null })))
    this.lastSend = performance.now() / 1000
    const me = this.myNum()
    const m: TextMessage = { packetId: id, from: me !== null ? nodeId(me) : null, to: to ?? '^all', channel, text, rxTime: iso(Date.now() / 1000) }
    this.store.add(m, 'out')
    log('info', 'text_sent', { channel, direct: to !== null, bytes: Buffer.byteLength(text, 'utf8') })
    return m
  }
}
