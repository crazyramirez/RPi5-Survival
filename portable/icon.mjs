/**
 * Icono de Survival OS (brújula) generado sin dependencias (ADR 0014/0019): PNG a cualquier tamaño, ICO de
 * Windows con varios tamaños (lanzador .exe, unidad USB, carpeta) e ICNS de macOS (.app e icono del volumen).
 * Lo usan el empaquetado (release-portable.mjs) y scripts/build-icons.mjs (favicon de la web).
 */
import { crc32, deflateSync } from 'node:zlib'

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const BG = hex('#13241b')
const RING = hex('#8fd19e')
const NORTH = hex('#f2f7f3')
const SOUTH = hex('#5f8f6b')

function inTri(x, y, a, b, d) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
  const p = [x, y]
  const d1 = s(p, a, b)
  const d2 = s(p, b, d)
  const d3 = s(p, d, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/**
 * PNG RGBA cuadrado: fondo verde oscuro redondeado, anillo y aguja de brújula. El dibujo está definido
 * sobre 256 unidades y se escala; supermuestreo 4×4 para bordes suaves también a 16 px.
 */
export function makeIconPng(size = 256) {
  const S = 4
  const k = size / 256
  const px = Buffer.alloc(size * size * 4)
  const sample = (ux, uy) => {
    // (ux, uy) en unidades de 256
    const c = 128
    const r = 44
    const qx = Math.max(Math.abs(ux - c) - (c - 8 - r), 0)
    const qy = Math.max(Math.abs(uy - c) - (c - 8 - r), 0)
    if (Math.hypot(qx, qy) > r) return null
    const d = Math.hypot(ux - c, uy - c)
    if (d > 80 && d < 94) return RING
    if (inTri(ux, uy, [c, c - 70], [c - 20, c], [c + 20, c])) return NORTH
    if (inTri(ux, uy, [c, c + 70], [c - 20, c], [c + 20, c])) return SOUTH
    return BG
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const col = sample((x + (sx + 0.5) / S) / k, (y + (sy + 0.5) / S) / k)
          if (col) {
            r += col[0]
            g += col[1]
            b += col[2]
            a++
          }
        }
      }
      const i = (y * size + x) * 4
      if (a) {
        px[i] = Math.round(r / a)
        px[i + 1] = Math.round(g / a)
        px[i + 2] = Math.round(b / a)
      }
      px[i + 3] = Math.round((a / (S * S)) * 255)
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))])
}

/** ICO (Windows Vista+) con entradas PNG: 16, 24, 32, 48, 64 y 256 px (Explorador, barra de tareas, unidades). */
export function makeIco(sizes = [16, 24, 32, 48, 64, 256]) {
  const pngs = sizes.map((s) => makeIconPng(s))
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  const dir = Buffer.alloc(16 * sizes.length)
  let offset = 6 + dir.length
  sizes.forEach((s, i) => {
    const o = i * 16
    dir.writeUInt8(s >= 256 ? 0 : s, o)
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(pngs[i].length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += pngs[i].length
  })
  return Buffer.concat([head, dir, ...pngs])
}

/** ICNS (macOS 10.7+) con entradas PNG: 16 (icp4), 32 (icp5), 128 (ic07), 256 (ic08) y 512 (ic09). */
export function makeIcns() {
  const entries = [['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512]].map(([type, s]) => {
    const png = makeIconPng(s)
    const h = Buffer.alloc(8)
    h.write(type, 0, 'ascii')
    h.writeUInt32BE(8 + png.length, 4)
    return Buffer.concat([h, png])
  })
  const body = Buffer.concat(entries)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}
