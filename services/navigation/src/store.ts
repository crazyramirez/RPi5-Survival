import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TrackPoint, TrackSummary, Waypoint, WaypointKind } from '@survival-os/shared-types'
import { isValidLatLon, pathLengthM } from './geo.ts'

export const WAYPOINT_KINDS: WaypointKind[] = ['agua', 'refugio', 'hospital', 'farmacia', 'peligro', 'personal']
const MAX_WAYPOINTS = 5000

/** Escritura atómica: fichero temporal + rename (sobrevive a cortes de luz sin dejar JSON a medias). */
async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export class NavStore {
  private readonly dir: string
  private readonly wpFile: string
  private readonly tracksDir: string

  constructor(dir: string) {
    this.dir = dir
    this.wpFile = join(dir, 'waypoints.json')
    this.tracksDir = join(dir, 'tracks')
  }

  async init(): Promise<void> {
    await mkdir(this.tracksDir, { recursive: true })
  }

  async listWaypoints(): Promise<Waypoint[]> {
    try {
      const data = JSON.parse(await readFile(this.wpFile, 'utf8')) as unknown
      return Array.isArray(data) ? (data as Waypoint[]) : []
    } catch {
      return []
    }
  }

  async addWaypoint(input: { name: unknown; kind: unknown; latitude: unknown; longitude: unknown; note?: unknown; origin: Waypoint['origin'] }): Promise<Waypoint> {
    if (!isValidLatLon(input.latitude, input.longitude)) throw Object.assign(new Error('coordenadas inválidas'), { status: 400 })
    const kind = WAYPOINT_KINDS.includes(input.kind as WaypointKind) ? (input.kind as WaypointKind) : 'personal'
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : 'Punto'
    const list = await this.listWaypoints()
    if (list.length >= MAX_WAYPOINTS) throw Object.assign(new Error('límite de puntos alcanzado'), { status: 409 })
    const wp: Waypoint = {
      id: randomUUID(),
      name,
      kind,
      latitude: Math.round((input.latitude as number) * 1e7) / 1e7,
      longitude: Math.round((input.longitude as number) * 1e7) / 1e7,
      note: typeof input.note === 'string' ? input.note.slice(0, 500) : '',
      origin: input.origin,
      createdAt: new Date().toISOString(),
    }
    list.push(wp)
    await writeAtomic(this.wpFile, JSON.stringify(list, null, 1))
    return wp
  }

  async deleteWaypoint(id: string): Promise<boolean> {
    const list = await this.listWaypoints()
    const next = list.filter((w) => w.id !== id)
    if (next.length === list.length) return false
    await writeAtomic(this.wpFile, JSON.stringify(next, null, 1))
    return true
  }

  // ---------------- Tracks: <id>.json (metadatos) + <id>.jsonl (puntos, solo se añade)

  private metaPath(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw Object.assign(new Error('id inválido'), { status: 400 })
    return join(this.tracksDir, `${id}.json`)
  }

  async createTrack(name: string, origin: TrackSummary['origin']): Promise<TrackSummary> {
    const t: TrackSummary = {
      id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`,
      name: name.slice(0, 80),
      startedAt: new Date().toISOString(),
      endedAt: null,
      points: 0,
      distanceM: 0,
      origin,
    }
    await writeAtomic(this.metaPath(t.id), JSON.stringify(t))
    return t
  }

  async appendPoints(t: TrackSummary, points: TrackPoint[], addedDistanceM: number): Promise<void> {
    if (!points.length) return
    await appendFile(this.metaPath(t.id).replace(/\.json$/, '.jsonl'), points.map((p) => JSON.stringify(p)).join('\n') + '\n')
    t.points += points.length
    t.distanceM = Math.round(t.distanceM + addedDistanceM)
    await writeAtomic(this.metaPath(t.id), JSON.stringify(t))
  }

  async finishTrack(t: TrackSummary): Promise<void> {
    t.endedAt = new Date().toISOString()
    await writeAtomic(this.metaPath(t.id), JSON.stringify(t))
  }

  async getTrack(id: string): Promise<TrackSummary | null> {
    const path = this.metaPath(id) // lanza 400 si el id no es válido
    try {
      return JSON.parse(await readFile(path, 'utf8')) as TrackSummary
    } catch {
      return null
    }
  }

  async trackPoints(id: string): Promise<TrackPoint[]> {
    try {
      const text = await readFile(this.metaPath(id).replace(/\.json$/, '.jsonl'), 'utf8')
      const pts: TrackPoint[] = []
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          pts.push(JSON.parse(line) as TrackPoint)
        } catch {
          // Última línea truncada tras un corte de luz: se descarta.
        }
      }
      return pts
    } catch {
      return []
    }
  }

  async listTracks(): Promise<TrackSummary[]> {
    const files = (await readdir(this.tracksDir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
    const out: TrackSummary[] = []
    for (const f of files) {
      const t = await this.getTrack(f.replace(/\.json$/, ''))
      if (t) out.push(t)
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async deleteTrack(id: string): Promise<void> {
    const meta = this.metaPath(id)
    await rm(meta, { force: true })
    await rm(meta.replace(/\.json$/, '.jsonl'), { force: true })
  }

  async importTrack(name: string, points: TrackPoint[]): Promise<TrackSummary> {
    const t = await this.createTrack(name, 'gpx')
    await this.appendPoints(t, points, pathLengthM(points))
    await this.finishTrack(t)
    return t
  }
}
