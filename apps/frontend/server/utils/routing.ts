/**
 * Rutas sin conexión (ADR 0010): utilidades puras (testeables sin Nitro ni BRouter).
 */
import type { RouteMode, RouteResult } from '@survival-os/shared-types'

export const BROUTER_URL = process.env.SURVIVAL_BROUTER_URL ?? 'http://127.0.0.1:17777'
export const ROUTING_DIR = process.env.SURVIVAL_ROUTING_DIR ?? (process.platform === 'linux' ? '/var/lib/survival-os/routing' : '.data/routing')

/** Perfiles estándar de BRouter 1.7.10 (incluidos en profiles2/). */
export const PROFILES: Record<RouteMode, string> = {
  foot: 'hiking-mountain',
  bike: 'trekking',
  car: 'car-fast',
}

export interface LatLon {
  lat: number
  lon: number
}

/** «lat,lon» → punto válido o null. */
export function parsePoint(v: unknown): LatLon | null {
  if (typeof v !== 'string' || v.length > 64) return null
  const m = /^\s*(-?\d{1,2}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)\s*$/.exec(v)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

export function parseMode(v: unknown): RouteMode | null {
  return v === 'foot' || v === 'bike' || v === 'car' ? v : null
}

/** URL de BRouter. lonlats va en orden lon,lat (formato de BRouter). */
export function brouterUrl(from: LatLon, to: LatLon, mode: RouteMode, format: 'geojson' | 'gpx', base = BROUTER_URL): string {
  const fmt = (p: LatLon): string => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`
  const q = new URLSearchParams({ lonlats: `${fmt(from)}|${fmt(to)}`, profile: PROFILES[mode], alternativeidx: '0', format })
  return `${base}/brouter?${q.toString().replace(/%7C/g, '|').replace(/%2C/g, ',')}`
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** Distancia geodésica (m) de una polilínea [lon, lat, …]. */
export function lineLengthM(coords: number[][]): number {
  const R = 6371008.8
  const rad = Math.PI / 180
  let d = 0
  for (let i = 1; i < coords.length; i++) {
    const [lon1 = 0, lat1 = 0] = coords[i - 1]!
    const [lon2 = 0, lat2 = 0] = coords[i]!
    const dLat = (lat2 - lat1) * rad
    const dLon = (lon2 - lon1) * rad
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
    d += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
  }
  return d
}

/**
 * GeoJSON de BRouter → resultado. Usa las propiedades que da BRouter («track-length», «total-time»,
 * «filtered ascend»); si faltan, la distancia se calcula de la geometría y el resto queda null (sin inventar).
 */
export function parseBrouterGeoJson(body: unknown, mode: RouteMode): RouteResult {
  const fc = body as { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[] }
  const f = fc?.features?.[0]
  const coords = f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates) ? (f.geometry.coordinates as unknown[]) : null
  if (!coords || coords.length < 2) throw new Error('BRouter no devolvió una ruta')
  const clean = coords
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 2 && c.every((x) => typeof x === 'number' && Number.isFinite(x)))
    .map((c) => c.slice(0, 3))
  if (clean.length < 2) throw new Error('Ruta sin geometría válida')
  const p = f?.properties ?? {}
  return {
    mode,
    profile: PROFILES[mode],
    coordinates: clean,
    distanceM: num(p['track-length']) ?? Math.round(lineLengthM(clean)),
    timeS: num(p['total-time']),
    ascentM: num(p['filtered ascend']),
  }
}
