export type Axis = 'lat' | 'lon'

const LIMIT: Record<Axis, number> = { lat: 90, lon: 180 }

/** Acepta "40.4168", "40,4168", "-3.7038". Devuelve null si no es un número válido en rango. */
export function parseDecimalDegrees(input: string, axis: Axis): number | null {
  const normalized = input.trim().replace(',', '.')
  if (!/^[+-]?\d{1,3}(\.\d+)?$/.test(normalized)) return null
  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value) || Math.abs(value) > LIMIT[axis]) return null
  return value
}

/** Grados decimales → "40° 25′ 00,5″ N" (segundos con 1 decimal, coma decimal española). */
export function toDms(value: number, axis: Axis): string | null {
  if (!Number.isFinite(value) || Math.abs(value) > LIMIT[axis]) return null
  const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'O' : 'E'
  // Trabajar en décimas de segundo enteras evita el redondeo a 60″.
  const tenths = Math.round(Math.abs(value) * 36000)
  const deg = Math.floor(tenths / 36000)
  const min = Math.floor((tenths % 36000) / 600)
  const sec = (tenths % 600) / 10
  const secText = sec.toFixed(1).padStart(4, '0').replace('.', ',')
  return `${deg}° ${String(min).padStart(2, '0')}′ ${secText}″ ${hemi}`
}

/**
 * Vista inicial del mapa desde la URL (`/mapas?lat=40.4168&lon=-3.7038&z=14`): enlaces a un punto concreto.
 * Valores ausentes, vacíos o fuera de rango → null (se usa la extensión del mapa).
 */
export function parseMapQuery(q: Record<string, unknown>): { center: [number, number]; zoom: number } | null {
  const num = (v: unknown): number | null => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const lat = num(q.lat)
  const lon = num(q.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const z = num(q.z)
  return { center: [lon, lat], zoom: z === null ? 14 : Math.min(18, Math.max(2, z)) }
}
