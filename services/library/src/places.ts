/**
 * Índice de lugares sin conexión (pueblos, barrios, parajes) construido a partir de los mapas PMTiles instalados.
 *
 * - Se lee la capa `places` de Protomaps a zoom 12 (o el máximo del mapa si es menor): en España recoge
 *   ~420 000 lugares, el 92 % de los que aparecen a zoom 14, leyendo una fracción del archivo.
 * - El índice vive en su propia base (places.sqlite) y se reconstruye en un fichero temporal que sustituye
 *   al anterior al terminar: la búsqueda sigue funcionando mientras tanto.
 * - Se reconstruye solo cuando cambia el conjunto de mapas (nombre, tamaño y fecha de cada fichero).
 * - Nunca inventa: si no hay mapas o el índice no está listo, el estado lo dice.
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PlaceHit, PlacesStatus } from '@survival-os/shared-types'
import { toFtsQuery } from './db.ts'
import { PmFile, tilePoints } from './pmtiles.ts'

export const INDEX_ZOOM = 12
const LANGS = ['es', 'en', 'fr', 'it'] as const
type Lang = (typeof LANGS)[number]
const MAP_RE = /^[\w-]{1,80}\.pmtiles$/
/** Importancia por tipo de lugar (Protomaps kind_detail). */
const DETAIL_WEIGHT: Record<string, number> = {
  city: 60,
  town: 45,
  village: 30,
  suburb: 22,
  quarter: 20,
  borough: 20,
  hamlet: 15,
  neighbourhood: 12,
  locality: 8,
  isolated_dwelling: 5,
  farm: 4,
}

export const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** Distancia en metros (haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number): number => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

interface PlaceRow {
  id: number
  name: string
  name_es: string | null
  name_en: string | null
  name_fr: string | null
  name_it: string | null
  kind: string
  detail: string
  pop: number | null
  lat: number
  lon: number
  map: string
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_es TEXT, name_en TEXT, name_fr TEXT, name_it TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    pop INTEGER,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    map TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(names, content = '', tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/** Puntuación de un resultado: coincidencia del nombre + importancia + cercanía. */
export function scorePlace(query: string, names: string[], detail: string, pop: number | null, distM: number | null): number {
  const q = normalize(query)
  let match = 0
  for (const n of names.map(normalize)) {
    if (n === q) match = Math.max(match, 100)
    else if (n.startsWith(q)) match = Math.max(match, 60)
    else if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) match = Math.max(match, 35)
    else match = Math.max(match, 20)
  }
  const importance = (DETAIL_WEIGHT[detail] ?? 6) + (pop && pop > 0 ? Math.min(20, Math.log10(pop) * 3) : 0)
  // 1 km → −3; 10 km → −10; 100 km → −20; 1000 km → −30.
  const near = distM === null ? 0 : -10 * Math.log10(1 + distM / 1000)
  return match + importance + near
}

export class PlaceIndex {
  private db: DatabaseSync | null = null
  private building: Promise<void> | null = null
  private progress: number | null = null
  private error: string | null = null
  private lastCheck = 0
  private checking: Promise<void> | null = null

  private readonly dbPath: string
  private readonly mapsDir: string
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void

  constructor(dbPath: string, mapsDir: string, log: PlaceIndex['log'] = () => {}) {
    this.dbPath = dbPath
    this.mapsDir = mapsDir
    this.log = log
    if (existsSync(dbPath)) {
      try {
        this.db = this.openDb(dbPath)
      } catch (err) {
        this.log('warn', 'places_db_unreadable', { error: String(err) })
        this.db = null
      }
    }
  }

  private openDb(path: string): DatabaseSync {
    const db = new DatabaseSync(path)
    db.exec(SCHEMA)
    return db
  }

  private meta(key: string): string | null {
    try {
      const r = this.db?.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
      return r?.value ?? null
    } catch {
      return null
    }
  }

  /** Mapas instalados con su firma (nombre:tamaño:fecha), en orden estable. */
  async maps(): Promise<{ file: string; sig: string }[]> {
    const files = (await readdir(this.mapsDir).catch(() => [] as string[])).filter((f) => MAP_RE.test(f)).sort()
    const out: { file: string; sig: string }[] = []
    for (const f of files) {
      const st = await stat(join(this.mapsDir, f)).catch(() => null)
      if (st?.isFile()) out.push({ file: f, sig: `${f}:${st.size}:${Math.round(st.mtimeMs)}` })
    }
    return out
  }

  status(): PlacesStatus {
    const count = Number(this.meta('count') ?? 0)
    const maps = (this.meta('maps') ?? '').split('\n').filter(Boolean)
    const state: PlacesStatus['state'] = this.building ? 'building' : this.error ? 'error' : this.db && maps.length ? 'ready' : 'none'
    return { state, count, maps, progress: this.building ? (this.progress ?? 0) : null, builtAt: this.meta('builtAt'), error: this.error }
  }

  /** Comprueba (como mucho cada `everyMs`) si cambiaron los mapas y, si es así, reconstruye en segundo plano. */
  async refresh(everyMs = 60_000): Promise<void> {
    if (this.building || this.checking || Date.now() - this.lastCheck < everyMs) return
    this.lastCheck = Date.now()
    this.checking = (async () => {
      const maps = await this.maps()
      const sig = maps.map((m) => m.sig).join('\n')
      if (sig === (this.meta('signature') ?? '') && this.db) return
      if (!maps.length) {
        // Sin mapas: se vacía el índice (no se ofrecen lugares de un mapa ya borrado).
        this.replace(null)
        return
      }
      this.error = null
      this.building = this.build(maps.map((m) => m.file), sig)
        .catch((err: unknown) => {
          this.error = err instanceof Error ? err.message : String(err)
          this.log('error', 'places_build_failed', { error: this.error })
        })
        .finally(() => {
          this.building = null
          this.progress = null
        })
    })().finally(() => {
      this.checking = null
    })
    await this.checking
  }

  /** Espera a la reconstrucción en curso (pruebas y cierre ordenado). */
  async idle(): Promise<void> {
    await this.checking
    await this.building
  }

  private replace(tmp: string | null): void {
    this.db?.close()
    this.db = null
    if (tmp) {
      renameSync(tmp, this.dbPath)
      this.db = this.openDb(this.dbPath)
    } else {
      rmSync(this.dbPath, { force: true })
    }
  }

  private async build(files: string[], signature: string): Promise<void> {
    const started = Date.now()
    const tmp = `${this.dbPath}.tmp`
    rmSync(tmp, { force: true })
    const db = new DatabaseSync(tmp)
    let count = 0
    try {
      db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;')
      db.exec(SCHEMA)
      const insert = db.prepare('INSERT INTO places (name, name_es, name_en, name_fr, name_it, kind, detail, pop, lat, lon, map) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const insertFts = db.prepare('INSERT INTO places_fts (rowid, names) VALUES (?, ?)')
      this.progress = 0
      for (const [mi, file] of files.entries()) {
        const fh = await open(join(this.mapsDir, file), 'r')
        try {
          const pm = await PmFile.open(fh)
          const z = Math.max(pm.header.minZoom, Math.min(INDEX_ZOOM, pm.header.maxZoom))
          const total = Math.max(1, await pm.countAtZoom(z))
          let done = 0
          db.exec('BEGIN')
          for await (const t of pm.tilesAtZoom(z)) {
            // Duplicados solo dentro de la tesela: los puntos fuera de su tesela ya se descartan, y un conjunto
            // global de ~700 000 claves rozaría el límite de memoria del servicio en la Pi (MemoryMax=256M).
            const seen = new Set<string>()
            for (const p of tilePoints(t.data, 'places', t.z, t.x, t.y)) {
              const name = typeof p.props.name === 'string' ? p.props.name.trim() : ''
              if (!name) continue
              const kind = String(p.props.kind ?? 'locality')
              const detail = String(p.props.kind_detail ?? kind)
              const key = `${name}|${detail}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`
              if (seen.has(key)) continue
              seen.add(key)
              const local = (l: Lang): string | null => {
                const v = p.props[`name:${l}`]
                return typeof v === 'string' && v.trim() && v.trim() !== name ? v.trim() : null
              }
              const pop = typeof p.props.population === 'number' && p.props.population > 0 ? Math.round(p.props.population) : null
              const names = [name, ...LANGS.map(local)].filter((n): n is string => !!n)
              const r = insert.run(name, local('es'), local('en'), local('fr'), local('it'), kind, detail, pop, p.lat, p.lon, file)
              insertFts.run(Number(r.lastInsertRowid), [...new Set(names)].join(' · '))
              count++
            }
            // Ceder el bucle de eventos: el servicio sigue respondiendo mientras se indexa.
            if (++done % 64 === 0) {
              this.progress = (mi + Math.min(1, done / total)) / files.length
              await new Promise((r) => setImmediate(r))
            }
          }
          db.exec('COMMIT')
        } finally {
          await fh.close()
        }
        this.progress = (mi + 1) / files.length
      }
      const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      setMeta.run('signature', signature)
      setMeta.run('count', String(count))
      setMeta.run('maps', files.join('\n'))
      setMeta.run('builtAt', new Date().toISOString())
      setMeta.run('zoom', String(INDEX_ZOOM))
    } catch (err) {
      db.close()
      rmSync(tmp, { force: true })
      throw err
    }
    db.close()
    this.replace(tmp)
    this.log('info', 'places_indexed', { maps: files.length, places: count, ms: Date.now() - started })
  }

  /** Busca lugares. `near`: punto de referencia (centro del mapa) para preferir lo cercano. */
  search(query: string, lang: string, near: { lat: number; lon: number } | null, limit = 20): PlaceHit[] {
    const match = toFtsQuery(query)
    if (!match || !this.db) return []
    const rows = this.db
      .prepare('SELECT p.* FROM places_fts JOIN places p ON p.id = places_fts.rowid WHERE places_fts MATCH ? ORDER BY rank LIMIT 2000')
      .all(match) as unknown as PlaceRow[]
    const l = (LANGS as readonly string[]).includes(lang) ? (lang as Lang) : 'es'
    return rows
      .map((r) => {
        const dist = near ? distanceM(near.lat, near.lon, r.lat, r.lon) : null
        const shown = r[`name_${l}`] ?? r.name
        const names = [r.name, r.name_es, r.name_en, r.name_fr, r.name_it].filter((n): n is string => !!n)
        const hit: PlaceHit = {
          name: shown,
          localName: shown !== r.name ? r.name : null,
          kind: r.kind,
          detail: r.detail,
          lat: r.lat,
          lon: r.lon,
          // La población no se devuelve: Protomaps rellena estimaciones (200, 1000) que no son datos medidos.
          map: r.map,
          distanceM: dist === null ? null : Math.round(dist),
        }
        return { hit, score: scorePlace(query, names, r.detail, r.pop, dist) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((x) => x.hit)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}
