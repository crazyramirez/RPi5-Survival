import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { tileIdToZxy as libTileIdToZxy, zxyToTileId as libZxyToTileId } from 'pmtiles'
import { PlaceIndex, scorePlace } from '../src/places.ts'
import { parseDirectory, parseHeader, tileIdToZxy, tilePoints, zxyToTileId } from '../src/pmtiles.ts'

// ------------------------------------------------------------------ codificación mínima (solo para las pruebas)
function varint(n: number): number[] {
  const out: number[] = []
  let v = n
  while (v >= 128) {
    out.push((v % 128) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}
const zz = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1)
const bytes = (field: number, data: number[]): number[] => [...varint(field * 8 + 2), ...varint(data.length), ...data]
const str = (field: number, s: string): number[] => bytes(field, [...new TextEncoder().encode(s)])

type Props = Record<string, string | number>
/** Tesela MVT con una capa de puntos (coordenadas de tesela, extensión 4096). */
function mvt(layer: string, points: { px: number; py: number; props: Props }[]): Uint8Array {
  const keys: string[] = []
  const values: (string | number)[] = []
  const idx = <T>(list: T[], v: T): number => {
    const i = list.indexOf(v)
    if (i >= 0) return i
    list.push(v)
    return list.length - 1
  }
  const features = points.map((p) => {
    const tags: number[] = []
    for (const [k, v] of Object.entries(p.props)) tags.push(idx(keys, k), idx(values, v))
    const geom = [1 * 8 + 1, zz(p.px), zz(p.py)]
    return bytes(2, [...bytes(2, tags.flatMap(varint)), 3 * 8, 1, ...bytes(4, geom.flatMap(varint))])
  })
  const encValue = (v: string | number): number[] => (typeof v === 'string' ? str(1, v) : [5 * 8, ...varint(v)])
  const body = [
    ...[15 * 8, 2],
    ...str(1, layer),
    ...features.flat(),
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytes(4, encValue(v))),
    ...[5 * 8, ...varint(4096)],
  ]
  // Una capa ajena delante: el lector debe saltarla.
  return new Uint8Array([...bytes(3, [...[15 * 8, 2], ...str(1, 'water'), ...[5 * 8, ...varint(4096)]]), ...bytes(3, body)])
}

/** PMTiles v3 con directorio raíz único; teselas comprimidas con gzip. */
function pmtiles(tiles: { z: number; x: number; y: number; data: Uint8Array }[]): Buffer {
  const sorted = tiles.map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: gzipSync(t.data) })).sort((a, b) => a.id - b.id)
  let off = 0
  const entries = sorted.map((t) => {
    const e = { id: t.id, offset: off, length: t.data.length }
    off += t.data.length
    return e
  })
  const dir: number[] = [...varint(entries.length)]
  let last = 0
  for (const e of entries) {
    dir.push(...varint(e.id - last))
    last = e.id
  }
  for (const _ of entries) dir.push(...varint(1))
  for (const e of entries) dir.push(...varint(e.length))
  for (const e of entries) dir.push(...varint(e.offset + 1))
  const root = gzipSync(new Uint8Array(dir))
  const h = Buffer.alloc(127)
  h.write('PMTiles', 0, 'ascii')
  h[7] = 3
  const tileData = Buffer.concat(sorted.map((t) => t.data))
  h.writeBigUInt64LE(127n, 8)
  h.writeBigUInt64LE(BigInt(root.length), 16)
  h.writeBigUInt64LE(BigInt(127 + root.length), 24) // metadatos (vacíos)
  h.writeBigUInt64LE(0n, 32)
  h.writeBigUInt64LE(BigInt(127 + root.length), 40) // directorios hoja (ninguno)
  h.writeBigUInt64LE(0n, 48)
  h.writeBigUInt64LE(BigInt(127 + root.length), 56)
  h.writeBigUInt64LE(BigInt(tileData.length), 64)
  h[97] = 2 // directorios: gzip
  h[98] = 2 // teselas: gzip
  h[99] = 1 // MVT
  h[100] = 0
  h[101] = 12
  h.writeInt32LE(-4 * 1e7, 102)
  h.writeInt32LE(39 * 1e7, 106)
  h.writeInt32LE(-3 * 1e7, 110)
  h.writeInt32LE(41 * 1e7, 114)
  return Buffer.concat([h, root, tileData])
}

/** Tesela de zoom 12 que contiene (lat, lon) y la posición del punto dentro de ella. */
function at(lat: number, lon: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** 12
  const fx = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 4096), py: Math.floor((fy % 1) * 4096) }
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function fixture(): { dir: string; maps: string } {
  const dir = mkdtempSync(join(tmpdir(), 'places-'))
  dirs.push(dir)
  const maps = join(dir, 'maps')
  rmSync(maps, { recursive: true, force: true })
  mkdirSync(maps)
  return { dir, maps }
}

describe('PMTiles: identificadores de tesela', () => {
  it('coinciden con la librería oficial (ida y vuelta)', () => {
    for (const [z, x, y] of [[0, 0, 0], [1, 1, 0], [5, 17, 9], [12, 2005, 1546], [15, 12345, 6789], [18, 200000, 100000]] as const) {
      const id = zxyToTileId(z, x, y)
      expect(id).toBe(libZxyToTileId(z, x, y))
      expect(tileIdToZxy(id)).toEqual([z, x, y])
      expect(tileIdToZxy(id)).toEqual(libTileIdToZxy(id))
    }
  })
})

describe('PMTiles: lectura', () => {
  it('cabecera y directorio', () => {
    const buf = pmtiles([{ z: 12, x: 2005, y: 1546, data: mvt('places', []) }])
    const h = parseHeader(new Uint8Array(buf))
    expect(h).toMatchObject({ minZoom: 0, maxZoom: 12, tileType: 1, tileCompression: 2 })
    expect(h.bounds).toEqual([-4, 39, -3, 41])
    const entries = parseDirectory(gunzipSync(buf.subarray(h.rootOffset, h.rootOffset + h.rootLength)))
    expect(entries).toEqual([{ tileId: zxyToTileId(12, 2005, 1546), offset: 0, length: expect.any(Number), runLength: 1 }])
  })

  it('puntos de la capa pedida, en lon/lat; descarta los de fuera de la tesela', () => {
    const p = at(40.4168, -3.7038)
    const tile = mvt('places', [
      { px: p.px, py: p.py, props: { name: 'Madrid', kind: 'locality', kind_detail: 'city' } },
      { px: 5000, py: 10, props: { name: 'Fuera', kind: 'locality' } },
    ])
    const pts = tilePoints(tile, 'places', 12, p.x, p.y)
    expect(pts).toHaveLength(1)
    expect(pts[0]!.props).toEqual({ name: 'Madrid', kind: 'locality', kind_detail: 'city' })
    expect(pts[0]!.lat).toBeCloseTo(40.4168, 3)
    expect(pts[0]!.lon).toBeCloseTo(-3.7038, 3)
    expect(tilePoints(tile, 'roads', 12, p.x, p.y)).toEqual([])
  })
})

describe('índice de lugares', () => {
  function writeMap(maps: string, file: string, places: { lat: number; lon: number; props: Props }[]): void {
    const byTile = new Map<string, { x: number; y: number; points: { px: number; py: number; props: Props }[] }>()
    for (const pl of places) {
      const p = at(pl.lat, pl.lon)
      const k = `${p.x}/${p.y}`
      if (!byTile.has(k)) byTile.set(k, { x: p.x, y: p.y, points: [] })
      byTile.get(k)!.points.push({ px: p.px, py: p.py, props: pl.props })
    }
    const tiles = [...byTile.values()].map((t) => ({ z: 12, x: t.x, y: t.y, data: mvt('places', t.points) }))
    // Una tesela de otro zoom que no debe leerse.
    tiles.push({ z: 11, x: 1002, y: 773, data: mvt('places', [{ px: 10, py: 10, props: { name: 'Zoom11', kind: 'locality' } }]) })
    writeFileSync(join(maps, file), pmtiles(tiles))
  }

  const SAMPLE: { lat: number; lon: number; props: Props }[] = [
    { lat: 40.4168, lon: -3.7038, props: { name: 'Madrid', 'name:en': 'Madrid', kind: 'locality', kind_detail: 'city', population: 3_400_000 } },
    { lat: 40.5017, lon: -4.0689, props: { name: 'Valdemorillo', kind: 'locality', kind_detail: 'village', population: 6083 } },
    { lat: 40.9, lon: -3.2, props: { name: 'Valdemorillo', kind: 'locality', kind_detail: 'locality', population: 1000 } },
    { lat: 40.45, lon: -3.69, props: { name: 'Chamartín', kind: 'neighbourhood', kind_detail: 'suburb' } },
    { lat: 40.42, lon: -3.75, props: { name: 'Casa de Campo', 'name:fr': 'Maison de Campagne', kind: 'locality', kind_detail: 'locality' } },
    { lat: 40.43, lon: -3.71, props: { kind: 'locality' } }, // sin nombre: se ignora
  ]

  it('sin mapas: estado «none» y sin resultados', async () => {
    const { dir, maps } = fixture()
    const idx = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    await idx.refresh(0)
    await idx.idle()
    expect(idx.status()).toMatchObject({ state: 'none', count: 0, maps: [] })
    expect(idx.search('madrid', 'es', null)).toEqual([])
    idx.close()
  })

  it('construye, busca sin acentos ni mayúsculas y prefiere lo importante y cercano', async () => {
    const { dir, maps } = fixture()
    writeMap(maps, 'madrid-20261108-z12.pmtiles', SAMPLE)
    const idx = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    await idx.refresh(0)
    await idx.idle()
    expect(idx.status()).toMatchObject({ state: 'ready', count: 5, maps: ['madrid-20261108-z12.pmtiles'], progress: null, error: null })

    expect(idx.search('CHAMARTIN', 'es', null).map((h) => h.name)).toEqual(['Chamartín'])
    expect(idx.search('zoom11', 'es', null)).toEqual([])
    // El pueblo antes que el paraje homónimo; con la referencia cerca del paraje, la distancia lo compensa en parte.
    const v = idx.search('valdemorillo', 'es', { lat: 40.4168, lon: -3.7038 })
    expect(v.map((h) => h.detail)).toEqual(['village', 'locality'])
    expect(v[0]!.distanceM).toBeGreaterThan(30_000)
    expect(v[0]!.lat).toBeCloseTo(40.5017, 3)
    // Prefijo en la última palabra.
    expect(idx.search('casa de cam', 'es', null).map((h) => h.name)).toEqual(['Casa de Campo'])
    idx.close()
  })

  it('nombre en el idioma de la interfaz si el mapa lo trae, con el local aparte', async () => {
    const { dir, maps } = fixture()
    writeMap(maps, 'madrid-20261108-z12.pmtiles', SAMPLE)
    const idx = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    await idx.refresh(0)
    await idx.idle()
    expect(idx.search('maison', 'fr', null)[0]).toMatchObject({ name: 'Maison de Campagne', localName: 'Casa de Campo' })
    expect(idx.search('casa de campo', 'es', null)[0]).toMatchObject({ name: 'Casa de Campo', localName: null })
    // Nunca se devuelve la población (Protomaps rellena estimaciones).
    expect(idx.search('madrid', 'es', null)[0]).not.toHaveProperty('population')
    idx.close()
  })

  it('se reconstruye al cambiar los mapas y conserva el índice en un fichero nuevo', async () => {
    const { dir, maps } = fixture()
    writeMap(maps, 'a-20261108-z12.pmtiles', SAMPLE.slice(0, 1))
    const idx = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    await idx.refresh(0)
    await idx.idle()
    expect(idx.status().count).toBe(1)
    writeMap(maps, 'b-20261108-z12.pmtiles', SAMPLE.slice(3, 4))
    await idx.refresh(60_000) // dentro del intervalo: no se comprueba
    expect(idx.status().count).toBe(1)
    await idx.refresh(0)
    await idx.idle()
    expect(idx.status()).toMatchObject({ state: 'ready', count: 2, maps: ['a-20261108-z12.pmtiles', 'b-20261108-z12.pmtiles'] })
    idx.close()
    // Al reabrir, el índice ya está listo sin reconstruir.
    const again = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    expect(again.status()).toMatchObject({ state: 'ready', count: 2 })
    again.close()
  })

  it('un mapa dañado deja el estado en error sin romper el índice anterior', async () => {
    const { dir, maps } = fixture()
    writeMap(maps, 'a-20261108-z12.pmtiles', SAMPLE.slice(0, 1))
    const idx = new PlaceIndex(join(dir, 'places.sqlite'), maps)
    await idx.refresh(0)
    await idx.idle()
    writeFileSync(join(maps, 'roto-20261108-z12.pmtiles'), Buffer.from('no soy un mapa'))
    await idx.refresh(0)
    await idx.idle()
    expect(idx.status().state).toBe('error')
    expect(idx.search('madrid', 'es', null).map((h) => h.name)).toEqual(['Madrid'])
    idx.close()
  })
})

describe('puntuación', () => {
  it('coincidencia exacta > prefijo > palabra; ciudad > paraje; cerca > lejos', () => {
    expect(scorePlace('toledo', ['Toledo'], 'city', null, null)).toBeGreaterThan(scorePlace('toledo', ['Toledo de Abajo'], 'city', null, null))
    expect(scorePlace('toledo', ['Toledo de Abajo'], 'hamlet', null, null)).toBeGreaterThan(scorePlace('toledo', ['Montes de Toledo'], 'hamlet', null, null))
    expect(scorePlace('x', ['X'], 'city', null, null)).toBeGreaterThan(scorePlace('x', ['X'], 'locality', null, null))
    expect(scorePlace('x', ['X'], 'hamlet', null, 1000)).toBeGreaterThan(scorePlace('x', ['X'], 'hamlet', null, 500_000))
  })
})
