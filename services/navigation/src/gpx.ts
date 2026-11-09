import type { TrackPoint, Waypoint, WaypointKind } from '@survival-os/shared-types'
import { isValidLatLon } from './geo.ts'

/** GPX 1.1: lectura tolerante (sin dependencias) y escritura estándar. */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function unesc(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

function child(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)
  return m?.[1] !== undefined ? unesc(m[1]).trim() : null
}

function attrs(tag: string): { lat: number; lon: number } | null {
  const lat = Number(/\blat="([^"]+)"/.exec(tag)?.[1])
  const lon = Number(/\blon="([^"]+)"/.exec(tag)?.[1])
  return isValidLatLon(lat, lon) ? { lat, lon } : null
}

export interface ParsedGpx {
  waypoints: { name: string; lat: number; lon: number; note: string }[]
  tracks: { name: string; points: TrackPoint[] }[]
  rejected: number
}

const MAX_POINTS = 200_000

export function parseGpx(xml: string): ParsedGpx {
  const out: ParsedGpx = { waypoints: [], tracks: [], rejected: 0 }
  for (const m of xml.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>|<wpt\b([^>]*)\/>/g)) {
    const pos = attrs(m[1] ?? m[3] ?? '')
    if (!pos) {
      out.rejected++
      continue
    }
    const body = m[2] ?? ''
    out.waypoints.push({ ...pos, name: (child(body, 'name') ?? 'Punto').slice(0, 80), note: (child(body, 'desc') ?? child(body, 'cmt') ?? '').slice(0, 500) })
  }
  let total = 0
  for (const t of xml.matchAll(/<trk\b[^>]*>([\s\S]*?)<\/trk>/g)) {
    const body = t[1] ?? ''
    const points: TrackPoint[] = []
    for (const p of body.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g)) {
      if (total >= MAX_POINTS) break
      const pos = attrs(p[1] ?? p[3] ?? '')
      if (!pos) {
        out.rejected++
        continue
      }
      const inner = p[2] ?? ''
      const ele = Number(child(inner, 'ele'))
      const time = child(inner, 'time')
      points.push({ lat: pos.lat, lon: pos.lon, ele: Number.isFinite(ele) && child(inner, 'ele') !== null ? ele : null, time: time && !Number.isNaN(Date.parse(time)) ? time : null })
      total++
    }
    if (points.length) out.tracks.push({ name: (child(body.replace(/<trkseg[\s\S]*$/, ''), 'name') ?? 'Track importado').slice(0, 80), points })
  }
  return out
}

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Survival OS" xmlns="http://www.topografix.com/GPX/1/1">\n'

export function waypointsToGpx(waypoints: Waypoint[]): string {
  const body = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.latitude.toFixed(7)}" lon="${w.longitude.toFixed(7)}"><name>${esc(w.name)}</name>` +
        `<desc>${esc(w.note)}</desc><type>${esc(w.kind as WaypointKind)}</type><time>${esc(w.createdAt)}</time></wpt>`,
    )
    .join('\n')
  return `${HEADER}${body}\n</gpx>\n`
}

export function trackToGpx(name: string, points: TrackPoint[]): string {
  const pts = points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
        `${p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}${p.time ? `<time>${esc(p.time)}</time>` : ''}</trkpt>`,
    )
    .join('\n')
  return `${HEADER}  <trk><name>${esc(name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`
}
