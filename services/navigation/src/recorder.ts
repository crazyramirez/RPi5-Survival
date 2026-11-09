import type { NavFix, TrackPoint } from '@survival-os/shared-types'
import { haversineM } from './geo.ts'

export interface RecorderPolicy {
  /** Intervalo mínimo entre puntos (s). Conservador por defecto para ahorrar SD y batería. */
  intervalSeconds: number
  /** Distancia mínima (m) para registrar un punto nuevo (filtra el ruido estando parado). */
  minDistanceM: number
  /** Error horizontal máximo aceptado (m); peor precisión → se descarta. */
  maxErrorM: number
}

export const DEFAULT_POLICY: RecorderPolicy = { intervalSeconds: 10, minDistanceM: 10, maxErrorM: 50 }

/** Decide si un fix nuevo debe añadirse al track. Función pura (testeable). */
export function shouldRecord(
  fix: NavFix,
  last: { point: TrackPoint; at: number } | null,
  now: number,
  policy: RecorderPolicy,
): { record: boolean; distanceM: number; point?: TrackPoint } {
  if (fix.fix === 'none' || fix.latitude === null || fix.longitude === null) return { record: false, distanceM: 0 }
  if (fix.ageSeconds !== null && fix.ageSeconds > 5) return { record: false, distanceM: 0 }
  if (fix.horizontalErrorM !== null && fix.horizontalErrorM > policy.maxErrorM) return { record: false, distanceM: 0 }
  const point: TrackPoint = { lat: fix.latitude, lon: fix.longitude, ele: fix.altitudeM, time: fix.time }
  if (!last) return { record: true, distanceM: 0, point }
  if ((now - last.at) / 1000 < policy.intervalSeconds) return { record: false, distanceM: 0 }
  const d = haversineM(last.point.lat, last.point.lon, point.lat, point.lon)
  if (d < policy.minDistanceM) return { record: false, distanceM: 0 }
  return { record: true, distanceM: d, point }
}
