/**
 * Protobuf mínimo (proto3, sin dependencias) para el protocolo serie de Meshtastic.
 * Solo los tipos de cable que usa: varint (0), 64 bits (1), longitud (2) y 32 bits (5).
 * Números de campo verificados contra meshtastic/protobufs (master, 2026-11-16).
 */

export type Field = { no: number; wire: number; v: bigint | Uint8Array | number }

/** Lee todos los campos de un mensaje. Lanza si el mensaje está truncado. */
export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = []
  let i = 0
  const varint = (): bigint => {
    let r = 0n
    let shift = 0n
    for (;;) {
      if (i >= buf.length) throw new Error('varint truncado')
      const b = buf[i++] as number
      r |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return r
      shift += 7n
      if (shift > 70n) throw new Error('varint demasiado largo')
    }
  }
  while (i < buf.length) {
    const key = Number(varint())
    const no = key >>> 3
    const wire = key & 7
    if (wire === 0) out.push({ no, wire, v: varint() })
    else if (wire === 1) {
      if (i + 8 > buf.length) throw new Error('fixed64 truncado')
      out.push({ no, wire, v: buf.subarray(i, i + 8) })
      i += 8
    } else if (wire === 2) {
      const len = Number(varint())
      if (i + len > buf.length) throw new Error('campo truncado')
      out.push({ no, wire, v: buf.subarray(i, i + len) })
      i += len
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new Error('fixed32 truncado')
      out.push({ no, wire, v: buf.subarray(i, i + 4) })
      i += 4
    } else throw new Error(`tipo de cable no soportado: ${wire}`)
  }
  return out
}

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** Acceso tipado a los campos de un mensaje (el último valor gana, como en proto3). */
export class Msg {
  private readonly map = new Map<number, Field[]>()
  constructor(buf: Uint8Array) {
    for (const f of readFields(buf)) {
      const list = this.map.get(f.no) ?? []
      list.push(f)
      this.map.set(f.no, list)
    }
  }
  has(no: number): boolean {
    return this.map.has(no)
  }
  private last(no: number): Field | undefined {
    const l = this.map.get(no)
    return l ? l[l.length - 1] : undefined
  }
  uint(no: number): number | null {
    const f = this.last(no)
    return f && f.wire === 0 ? Number(BigInt.asUintN(32, f.v as bigint)) : null
  }
  int32(no: number): number | null {
    const f = this.last(no)
    return f && f.wire === 0 ? Number(BigInt.asIntN(32, f.v as bigint)) : null
  }
  sint(no: number): number | null {
    const f = this.last(no)
    if (!f || f.wire !== 0) return null
    const n = f.v as bigint
    return Number((n >> 1n) ^ -(n & 1n))
  }
  bool(no: number): boolean | null {
    const f = this.last(no)
    return f && f.wire === 0 ? (f.v as bigint) !== 0n : null
  }
  fixed32(no: number): number | null {
    const f = this.last(no)
    return f && f.wire === 5 ? view(f.v as Uint8Array).getUint32(0, true) : null
  }
  sfixed32(no: number): number | null {
    const f = this.last(no)
    return f && f.wire === 5 ? view(f.v as Uint8Array).getInt32(0, true) : null
  }
  /** float32 con su representación más corta (como la librería oficial: 4.372, no 4.371999740600586). */
  float(no: number): number | null {
    const f = this.last(no)
    return f && f.wire === 5 ? Number.parseFloat(view(f.v as Uint8Array).getFloat32(0, true).toPrecision(7)) : null
  }
  bytes(no: number): Uint8Array | null {
    const f = this.last(no)
    return f && f.wire === 2 ? (f.v as Uint8Array) : null
  }
  string(no: number): string | null {
    const b = this.bytes(no)
    return b ? new TextDecoder().decode(b) : null
  }
  msg(no: number): Msg | null {
    const b = this.bytes(no)
    return b ? new Msg(b) : null
  }
}

// ------------------------------------------------------------------ escritura

export class Writer {
  private readonly parts: number[] = []
  private varint(v: bigint): void {
    let n = BigInt.asUintN(64, v)
    while (n >= 0x80n) {
      this.parts.push(Number((n & 0x7fn) | 0x80n))
      n >>= 7n
    }
    this.parts.push(Number(n))
  }
  private key(no: number, wire: number): void {
    this.varint(BigInt((no << 3) | wire))
  }
  uint(no: number, v: number): this {
    this.key(no, 0)
    this.varint(BigInt(v >>> 0))
    return this
  }
  bool(no: number, v: boolean): this {
    if (v) this.uint(no, 1)
    return this
  }
  fixed32(no: number, v: number): this {
    this.key(no, 5)
    const b = new Uint8Array(4)
    view(b).setUint32(0, v >>> 0, true)
    this.parts.push(...b)
    return this
  }
  sfixed32(no: number, v: number): this {
    this.key(no, 5)
    const b = new Uint8Array(4)
    view(b).setInt32(0, v | 0, true)
    this.parts.push(...b)
    return this
  }
  float(no: number, v: number): this {
    this.key(no, 5)
    const b = new Uint8Array(4)
    view(b).setFloat32(0, v, true)
    this.parts.push(...b)
    return this
  }
  bytes(no: number, v: Uint8Array): this {
    this.key(no, 2)
    this.varint(BigInt(v.length))
    this.parts.push(...v)
    return this
  }
  string(no: number, v: string): this {
    return this.bytes(no, new TextEncoder().encode(v))
  }
  msg(no: number, w: Writer): this {
    return this.bytes(no, w.finish())
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}
