import type { WaypointKind } from '@survival-os/shared-types'

export const WAYPOINT_KINDS: WaypointKind[] = ['agua', 'refugio', 'hospital', 'farmacia', 'peligro', 'personal']

export const WAYPOINT_COLORS: Record<WaypointKind, string> = {
  agua: '#2f8bff',
  refugio: '#8a5a2b',
  hospital: '#e53935',
  farmacia: '#2e9d4f',
  peligro: '#ff9800',
  personal: '#8e44ad',
}

const toRad = (d: number): number => (d * Math.PI) / 180
const toDeg = (r: number): number => (r * 180) / Math.PI

/** Rumbo inicial (°, 0 = norte) de A a B sobre la esfera. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
export function cardinal(deg: number): string {
  return POINTS[Math.round(deg / 45) % 8] ?? 'N'
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: m < 10_000 ? 2 : 1 })} km`
}
