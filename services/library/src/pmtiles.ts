/**
 * Lectura mínima de PMTiles v3 y de teselas vectoriales MVT, sin dependencias (los servicios no llevan
 * node_modules en tiempo de ejecución). Solo lo necesario para el índice de lugares: recorrer las teselas
 * de un nivel de zoom y extraer los puntos con nombre de la capa `places` de Protomaps.
 *
 * Especificación: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 * MVT: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */
import type { FileHandle } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

export interface PmHeader {
  rootOffset: number
  rootLength: number
  leafOffset: number
  tileDataOffset: number
  internalCompression: number
  tileCompression: number
  tileType: number
  minZoom: number
  maxZoom: number
  bounds: [number, number, number, number]
}

export interface DirEntry {
  tileId: number
  offset: number
  length: number
  runLength: number
}

const COMPRESSION_NONE = 1
const COMPRESSION_GZIP = 2
const TILE_TYPE_MVT = 1

// ------------------------------------------------------------------ varints (números > 2^32: sin operadores de bits)
export class Reader {
  pos: number
  readonly buf: Uint8Array
  readonly end: number

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf
    this.pos = start
    this.end = end
  }

  varint(): number {
    let result = 0
    let mul = 1
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error('varint truncado')
      const b = this.buf[this.pos++]!
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
      mul *= 128
    }
    throw new Error('varint demasiado largo')
  }

  done(): boolean {
    return this.pos >= this.end
  }
}

const zigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2)

// ------------------------------------------------------------------ cabecera y directorios
export function parseHeader(b: Uint8Array): PmHeader {
  if (b.length < 127) throw new Error('cabecera PMTiles incompleta')
  const magic = new TextDecoder().decode(b.subarray(0, 7))
  if (magic !== 'PMTiles' || b[7] !== 3) throw new Error('no es PMTiles v3')
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const u64 = (o: number): number => Number(v.getBigUint64(o, true))
  const e7 = (o: number): number => v.getInt32(o, true) / 1e7
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    leafOffset: u64(40),
    tileDataOffset: u64(56),
    internalCompression: b[97]!,
    tileCompression: b[98]!,
    tileType: b[99]!,
    minZoom: b[100]!,
    maxZoom: b[101]!,
    bounds: [e7(102), e7(106), e7(110), e7(114)],
  }
}

export function decompress(data: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESSION_NONE || compression === 0) return data
  if (compression === COMPRESSION_GZIP) return gunzipSync(data)
  throw new Error(`compresión PMTiles no soportada (${compression})`)
}

export function parseDirectory(b: Uint8Array): DirEntry[] {
  const r = new Reader(b)
  const n = r.varint()
  const entries: DirEntry[] = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }))
  let last = 0
  for (const e of entries) {
    last += r.varint()
    e.tileId = last
  }
  for (const e of entries) e.runLength = r.varint()
  for (const e of entries) e.length = r.varint()
  entries.forEach((e, i) => {
    const v = r.varint()
    const prev = entries[i - 1]
    e.offset = v === 0 && prev ? prev.offset + prev.length : v - 1
  })
  return entries
}

// ------------------------------------------------------------------ identificadores de tesela (curva de Hilbert)
/** Primer identificador del nivel z: (4^z − 1) / 3. */
export function zoomBase(z: number): number {
  return (4 ** z - 1) / 3
}

export function tileIdToZxy(id: number): [number, number, number] {
  let z = 0
  while (zoomBase(z + 1) <= id) z++
  let t = id - zoomBase(z)
  const n = 2 ** z
  let x = 0
  let y = 0
  for (let s = 1; s < n; s *= 2) {
    const rx = Math.floor(t / 2) % 2
    const ry = (t % 2) ^ rx
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      ;[x, y] = [y, x]
    }
    x += s * rx
    y += s * ry
    t = Math.floor(t / 4)
  }
  return [z, x, y]
}

/** Para pruebas y para la escritura de PMTiles de ejemplo. */
export function zxyToTileId(z: number, x: number, y: number): number {
  const n = 2 ** z
  let d = 0
  let xx = x
  let yy = y
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xx & s) > 0 ? 1 : 0
    const ry = (yy & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        xx = n - 1 - xx
        yy = n - 1 - yy
      }
      ;[xx, yy] = [yy, xx]
    }
  }
  return zoomBase(z) + d
}

// ------------------------------------------------------------------ archivo
export class PmFile {
  private readonly fh: FileHandle
  readonly header: PmHeader

  private constructor(fh: FileHandle, header: PmHeader) {
    this.fh = fh
    this.header = header
  }

  static async open(fh: FileHandle): Promise<PmFile> {
    const buf = new Uint8Array(127)
    await fh.read(buf, 0, 127, 0)
    const h = parseHeader(buf)
    if (h.tileType !== TILE_TYPE_MVT) throw new Error('el mapa no contiene teselas vectoriales MVT')
    return new PmFile(fh, h)
  }

  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const buf = new Uint8Array(length)
    const { bytesRead } = await this.fh.read(buf, 0, length, offset)
    if (bytesRead !== length) throw new Error('PMTiles truncado')
    return buf
  }

  private async dir(offset: number, length: number): Promise<DirEntry[]> {
    return parseDirectory(decompress(await this.bytes(offset, length), this.header.internalCompression))
  }

  /** Número de teselas del nivel z (solo lee directorios: sirve para el progreso). */
  async countAtZoom(z: number): Promise<number> {
    const lo = zoomBase(z)
    const hi = zoomBase(z + 1)
    const h = this.header
    let n = 0
    const walk = async (entries: DirEntry[]): Promise<void> => {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!
        const next = entries[i + 1]?.tileId ?? Number.MAX_SAFE_INTEGER
        if (e.runLength === 0) {
          if (next > lo && e.tileId < hi) await walk(await this.dir(h.leafOffset + e.offset, e.length))
        } else {
          n += Math.max(0, Math.min(e.tileId + e.runLength, hi) - Math.max(e.tileId, lo))
        }
      }
    }
    await walk(await this.dir(h.rootOffset, h.rootLength))
    return n
  }

  /**
   * Recorre las teselas del nivel z (en orden de Hilbert) sin leer las de otros niveles.
   * Las entradas con runLength > 1 (teselas idénticas, p. ej. mar) se entregan una vez por posición.
   */
  async *tilesAtZoom(z: number): AsyncGenerator<{ z: number; x: number; y: number; data: Uint8Array }> {
    const h = this.header
    yield* this.walk(await this.dir(h.rootOffset, h.rootLength), zoomBase(z), zoomBase(z + 1))
  }

  private async *walk(entries: DirEntry[], lo: number, hi: number): AsyncGenerator<{ z: number; x: number; y: number; data: Uint8Array }> {
    const h = this.header
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!
      const next = entries[i + 1]?.tileId ?? Number.MAX_SAFE_INTEGER
      if (e.runLength === 0) {
        // Directorio hoja: cubre [e.tileId, siguiente entrada).
        if (next > lo && e.tileId < hi) yield* this.walk(await this.dir(h.leafOffset + e.offset, e.length), lo, hi)
        continue
      }
      if (e.tileId + e.runLength <= lo || e.tileId >= hi) continue
      const data = decompress(await this.bytes(h.tileDataOffset + e.offset, e.length), h.tileCompression)
      for (let k = 0; k < e.runLength; k++) {
        const id = e.tileId + k
        if (id < lo || id >= hi) continue
        const [tz, x, y] = tileIdToZxy(id)
        yield { z: tz, x, y, data }
      }
    }
  }
}

// ------------------------------------------------------------------ MVT: puntos con nombre de una capa
export interface TilePoint {
  lon: number
  lat: number
  props: Record<string, string | number | boolean>
}

function readString(r: Reader): string {
  const len = r.varint()
  const s = new TextDecoder().decode(r.buf.subarray(r.pos, r.pos + len))
  r.pos += len
  return s
}

function skip(r: Reader, wire: number): void {
  if (wire === 0) r.varint()
  else if (wire === 1) r.pos += 8
  else if (wire === 2) {
    // Primero la longitud (avanza pos) y después el salto: `r.pos += r.varint()` usaría el pos anterior.
    const len = r.varint()
    r.pos += len
  }
  else if (wire === 5) r.pos += 4
  else throw new Error(`tipo de campo protobuf desconocido (${wire})`)
}

function readValue(r: Reader, end: number): string | number | boolean | null {
  let v: string | number | boolean | null = null
  const dv = new DataView(r.buf.buffer, r.buf.byteOffset, r.buf.byteLength)
  while (r.pos < end) {
    const key = r.varint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (field === 1 && wire === 2) v = readString(r)
    else if (field === 2 && wire === 5) {
      v = dv.getFloat32(r.pos, true)
      r.pos += 4
    } else if (field === 3 && wire === 1) {
      v = dv.getFloat64(r.pos, true)
      r.pos += 8
    } else if ((field === 4 || field === 5) && wire === 0) v = r.varint()
    else if (field === 6 && wire === 0) v = zigzag(r.varint())
    else if (field === 7 && wire === 0) v = r.varint() !== 0
    else skip(r, wire)
  }
  return v
}

/** Nombre de una capa sin decodificarla entera. */
function layerName(buf: Uint8Array, start: number, end: number): string | null {
  const r = new Reader(buf, start, end)
  while (!r.done()) {
    const key = r.varint()
    if (key === (1 << 3) + 2) return readString(r)
    skip(r, key % 8)
  }
  return null
}

/**
 * Puntos de la capa `layer` de una tesela MVT, en lon/lat. Se descartan los que caen fuera de la tesela
 * (el margen de las teselas vecinas repetiría el mismo lugar).
 */
export function tilePoints(tile: Uint8Array, layer: string, z: number, x: number, y: number): TilePoint[] {
  const r = new Reader(tile)
  while (!r.done()) {
    const key = r.varint()
    if (key !== (3 << 3) + 2) {
      skip(r, key % 8)
      continue
    }
    const len = r.varint()
    const start = r.pos
    const end = start + len
    r.pos = end
    if (layerName(tile, start, end) !== layer) continue
    return decodeLayer(tile, start, end, z, x, y)
  }
  return []
}

function decodeLayer(buf: Uint8Array, start: number, end: number, z: number, x: number, y: number): TilePoint[] {
  const r = new Reader(buf, start, end)
  const keys: string[] = []
  const values: (string | number | boolean | null)[] = []
  const features: [number, number][] = []
  let extent = 4096
  while (!r.done()) {
    const key = r.varint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (field === 3 && wire === 2) keys.push(readString(r))
    else if (field === 4 && wire === 2) {
      const len = r.varint()
      const vEnd = r.pos + len
      values.push(readValue(r, vEnd))
      r.pos = vEnd
    } else if (field === 2 && wire === 2) {
      const len = r.varint()
      features.push([r.pos, r.pos + len])
      r.pos += len
    } else if (field === 5 && wire === 0) extent = r.varint()
    else skip(r, wire)
  }
  const out: TilePoint[] = []
  const n = 2 ** z
  for (const [fs, fe] of features) {
    const f = new Reader(buf, fs, fe)
    let type = 0
    let tags: number[] = []
    let geom: number[] = []
    while (!f.done()) {
      const key = f.varint()
      const field = Math.floor(key / 8)
      const wire = key % 8
      if ((field === 2 || field === 4) && wire === 2) {
        const len = f.varint()
        const pEnd = f.pos + len
        const list: number[] = []
        while (f.pos < pEnd) list.push(f.varint())
        if (field === 2) tags = list
        else geom = list
      } else if (field === 3 && wire === 0) type = f.varint()
      else skip(f, wire)
    }
    // Solo puntos (type 1) con un MoveTo inicial.
    if (type !== 1 || geom.length < 3 || geom[0]! % 8 !== 1) continue
    const px = zigzag(geom[1]!)
    const py = zigzag(geom[2]!)
    if (px < 0 || py < 0 || px >= extent || py >= extent) continue
    const props: TilePoint['props'] = {}
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const k = keys[tags[i]!]
      const v = values[tags[i + 1]!]
      if (k !== undefined && v !== undefined && v !== null) props[k] = v
    }
    const lon = ((x + px / extent) / n) * 360 - 180
    const merc = Math.PI - (2 * Math.PI * (y + py / extent)) / n
    const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI
    out.push({ lon, lat, props })
  }
  return out
}
