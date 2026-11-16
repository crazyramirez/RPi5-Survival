import { HW_MODELS, ROLES } from './enums.ts'
import { Msg, Writer } from './proto.ts'

/**
 * Protocolo serie de Meshtastic sin librerías (ADR 0016):
 *   trama = 0x94 0xC3 <longitud 16 bits big-endian> <FromRadio/ToRadio protobuf>
 * Lo que no es trama es el registro de depuración del nodo y se ignora.
 * Los objetos tienen la MISMA forma que los dict de la librería Python (MessageToDict), para que la
 * lógica de survival_mesh.py se porte sin cambios de significado.
 */

export const START1 = 0x94
export const START2 = 0xc3
export const MAX_FRAME = 512
export const BROADCAST = 0xffffffff
export const PORT = { TEXT: 1, POSITION: 3, NODEINFO: 4, ROUTING: 5, TELEMETRY: 67 } as const

export const nodeId = (num: number): string => `!${(num >>> 0).toString(16).padStart(8, '0')}`

/** Separa las tramas de un flujo de bytes (tolera basura y tramas partidas entre lecturas). */
export class FrameParser {
  private buf = new Uint8Array(0)
  private readonly onFrame: (payload: Uint8Array) => void
  constructor(onFrame: (payload: Uint8Array) => void) {
    this.onFrame = onFrame
  }
  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    let i = 0
    while (i < merged.length) {
      if (merged[i] !== START1) {
        i++
        continue
      }
      if (i + 1 >= merged.length) break
      if (merged[i + 1] !== START2) {
        i++
        continue
      }
      if (i + 4 > merged.length) break
      const len = ((merged[i + 2] as number) << 8) | (merged[i + 3] as number)
      if (len > MAX_FRAME) {
        i++ // longitud imposible: era basura que casualmente empezaba por 0x94 0xC3
        continue
      }
      if (i + 4 + len > merged.length) break
      this.onFrame(merged.slice(i + 4, i + 4 + len))
      i += 4 + len
    }
    this.buf = merged.slice(i)
    if (this.buf.length > 4 * MAX_FRAME) this.buf = this.buf.slice(-MAX_FRAME)
  }
}

export function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 4)
  out.set([START1, START2, (payload.length >> 8) & 0xff, payload.length & 0xff])
  out.set(payload, 4)
  return out
}

// ------------------------------------------------------------------ decodificación

export interface UserDict {
  id?: string
  longName?: string
  shortName?: string
  hwModel?: string
  role?: string
}
export interface PositionDict {
  latitude?: number
  longitude?: number
  altitude?: number
  time?: number
  precisionBits?: number
}
export interface MetricsDict {
  batteryLevel?: number
  voltage?: number
  channelUtilization?: number
}
export interface NodeDict {
  num: number
  user?: UserDict
  position?: PositionDict
  snr?: number
  lastHeard?: number
  deviceMetrics?: MetricsDict
  hopsAway?: number
}
export interface PacketDict {
  from: number
  fromId: string
  to: number
  toId: string
  channel: number
  id: number | null
  rxTime: number | null
  rxSnr: number | null
  rxRssi: number | null
  hopLimit: number | null
  hopStart: number | null
  decoded: { portnum: string; portnumNo: number; text?: string; position?: PositionDict; user?: UserDict; deviceMetrics?: MetricsDict } | null
}
export interface ChannelDict {
  index: number
  role: number
  name: string
  pskLength: number
}

const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | null | undefined): void => {
  if (v !== null && v !== undefined) o[k] = v
}

export function decodeUser(m: Msg): UserDict {
  const u: UserDict = {}
  set(u, 'id', m.string(1))
  set(u, 'longName', m.string(2))
  set(u, 'shortName', m.string(3))
  const hw = m.uint(5)
  if (hw !== null) u.hwModel = HW_MODELS[hw] ?? String(hw)
  const role = m.uint(7)
  if (role !== null && role !== 0) u.role = ROLES[role] ?? String(role)
  return u
}

export function decodePosition(m: Msg): PositionDict {
  const p: PositionDict = {}
  const lat = m.sfixed32(1)
  const lon = m.sfixed32(2)
  if (lat !== null) p.latitude = lat * 1e-7
  if (lon !== null) p.longitude = lon * 1e-7
  set(p, 'altitude', m.int32(3))
  set(p, 'time', m.fixed32(4))
  set(p, 'precisionBits', m.uint(23))
  return p
}

export function decodeMetrics(m: Msg): MetricsDict {
  const d: MetricsDict = {}
  set(d, 'batteryLevel', m.uint(1))
  set(d, 'voltage', m.float(2))
  set(d, 'channelUtilization', m.float(3))
  return d
}

export function decodeNodeInfo(m: Msg): NodeDict | null {
  const num = m.uint(1)
  if (num === null) return null
  const n: NodeDict = { num }
  const user = m.msg(2)
  if (user) n.user = decodeUser(user)
  const pos = m.msg(3)
  if (pos) n.position = decodePosition(pos)
  set(n, 'snr', m.float(4))
  set(n, 'lastHeard', m.fixed32(5))
  const met = m.msg(6)
  if (met) n.deviceMetrics = decodeMetrics(met)
  set(n, 'hopsAway', m.uint(9))
  return n
}

const PORT_NAMES: Record<number, string> = { 1: 'TEXT_MESSAGE_APP', 3: 'POSITION_APP', 4: 'NODEINFO_APP', 5: 'ROUTING_APP', 67: 'TELEMETRY_APP' }

export function decodePacket(m: Msg): PacketDict {
  const from = m.fixed32(1) ?? 0
  const to = m.fixed32(2) ?? 0
  const data = m.msg(4)
  let decoded: PacketDict['decoded'] = null
  if (data) {
    const portnumNo = data.uint(1) ?? 0
    const payload = data.bytes(2) ?? new Uint8Array(0)
    decoded = { portnum: PORT_NAMES[portnumNo] ?? String(portnumNo), portnumNo }
    try {
      if (portnumNo === PORT.TEXT) decoded.text = new TextDecoder('utf-8', { fatal: false }).decode(payload)
      else if (portnumNo === PORT.POSITION) decoded.position = decodePosition(new Msg(payload))
      else if (portnumNo === PORT.NODEINFO) decoded.user = decodeUser(new Msg(payload))
      else if (portnumNo === PORT.TELEMETRY) {
        const dm = new Msg(payload).msg(2) // Telemetry.device_metrics
        if (dm) decoded.deviceMetrics = decodeMetrics(dm)
      }
    } catch {
      // carga útil dañada: se conserva solo la cabecera
    }
  }
  return {
    from,
    fromId: nodeId(from),
    to,
    toId: to === BROADCAST ? '^all' : nodeId(to),
    channel: m.uint(3) ?? 0,
    id: m.fixed32(6),
    rxTime: m.fixed32(7),
    rxSnr: m.float(8),
    rxRssi: m.int32(12),
    hopLimit: m.uint(9),
    hopStart: m.uint(15),
    decoded,
  }
}

export function decodeChannel(m: Msg): ChannelDict {
  const s = m.msg(2)
  return { index: m.int32(1) ?? 0, role: m.uint(3) ?? 0, name: s?.string(3) ?? '', pskLength: s?.bytes(2)?.length ?? 0 }
}

export type FromRadio =
  | { kind: 'myInfo'; myNodeNum: number }
  | { kind: 'nodeInfo'; node: NodeDict }
  | { kind: 'channel'; channel: ChannelDict }
  | { kind: 'metadata'; firmware: string | null }
  | { kind: 'configComplete'; id: number }
  | { kind: 'packet'; packet: PacketDict }
  | { kind: 'rebooted' }
  | { kind: 'other' }

export function decodeFromRadio(buf: Uint8Array): FromRadio {
  const m = new Msg(buf)
  const my = m.msg(3)
  if (my) return { kind: 'myInfo', myNodeNum: my.uint(1) ?? 0 }
  const ni = m.msg(4)
  if (ni) {
    const node = decodeNodeInfo(ni)
    return node ? { kind: 'nodeInfo', node } : { kind: 'other' }
  }
  const ch = m.msg(10)
  if (ch) return { kind: 'channel', channel: decodeChannel(ch) }
  const meta = m.msg(13)
  if (meta) return { kind: 'metadata', firmware: meta.string(1) }
  if (m.has(7)) return { kind: 'configComplete', id: m.uint(7) ?? 0 }
  const pkt = m.msg(2)
  if (pkt) return { kind: 'packet', packet: decodePacket(pkt) }
  if (m.bool(8)) return { kind: 'rebooted' }
  return { kind: 'other' }
}

// ------------------------------------------------------------------ codificación (ToRadio)

export const wantConfig = (id: number): Uint8Array => new Writer().uint(3, id).finish()
export const heartbeat = (): Uint8Array => new Writer().bytes(7, new Uint8Array(0)).finish()

export function textPacket(o: { to: number; channel: number; text: string; id: number; wantAck: boolean; hopLimit?: number }): Uint8Array {
  const data = new Writer().uint(1, PORT.TEXT).string(2, o.text)
  const pkt = new Writer().fixed32(2, o.to).uint(3, o.channel).msg(4, data).fixed32(6, o.id).uint(9, o.hopLimit ?? 3).bool(10, o.wantAck)
  return new Writer().msg(1, pkt).finish()
}

/** Petición de posición (Position vacía con want_response), como `meshtastic --request-position`. */
export function positionRequest(o: { to: number; channel: number; id: number; hopLimit?: number }): Uint8Array {
  const data = new Writer().uint(1, PORT.POSITION).bytes(2, new Uint8Array(0)).bool(3, true)
  const pkt = new Writer().fixed32(2, o.to).uint(3, o.channel).msg(4, data).fixed32(6, o.id).uint(9, o.hopLimit ?? 3)
  return new Writer().msg(1, pkt).finish()
}

// ------------------------------------------------------------------ sesión (estado como la librería)

/** Estado del nodo local tras el intercambio de configuración y los paquetes recibidos. */
export class Session {
  myNodeNum: number | null = null
  readonly nodes = new Map<number, NodeDict>()
  readonly channels = new Map<number, ChannelDict>()
  firmware: string | null = null
  configComplete = false

  /** Aplica un FromRadio; devuelve el paquete si lo era (para mensajes y muestras de hora). */
  apply(fr: FromRadio, now = Date.now() / 1000): PacketDict | null {
    switch (fr.kind) {
      case 'myInfo':
        this.myNodeNum = fr.myNodeNum
        return null
      case 'nodeInfo':
        this.nodes.set(fr.node.num, { ...this.nodes.get(fr.node.num), ...fr.node })
        return null
      case 'channel':
        this.channels.set(fr.channel.index, fr.channel)
        return null
      case 'metadata':
        this.firmware = fr.firmware
        return null
      case 'configComplete':
        this.configComplete = true
        return null
      case 'packet':
        this.onPacket(fr.packet, now)
        return fr.packet
      default:
        return null
    }
  }

  /** Lo mismo que hace la librería Python con cada paquete: actualiza el nodo emisor. */
  private onPacket(p: PacketDict, now: number): void {
    if (!p.from) return
    const n: NodeDict = this.nodes.get(p.from) ?? { num: p.from }
    n.lastHeard = p.rxTime && p.rxTime > 0 ? p.rxTime : Math.floor(now)
    if (p.rxSnr !== null) n.snr = p.rxSnr
    if (p.hopStart !== null && p.hopLimit !== null) n.hopsAway = p.hopStart - p.hopLimit
    const d = p.decoded
    if (d?.user) n.user = { ...n.user, ...d.user }
    if (d?.position && (d.position.latitude !== undefined || d.position.longitude !== undefined)) n.position = { ...n.position, ...d.position }
    if (d?.deviceMetrics) n.deviceMetrics = { ...n.deviceMetrics, ...d.deviceMetrics }
    this.nodes.set(p.from, n)
  }
}
