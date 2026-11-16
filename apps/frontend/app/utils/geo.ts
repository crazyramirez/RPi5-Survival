import { distanceM } from './waypoints'

/** Radio medio de la Tierra (m), el mismo de distanceM. */
const R = 6_371_008.8
const rad = (d: number): number => (d * Math.PI) / 180

export type LonLat = [number, number]

/** Longitud de una línea quebrada (m), por tramos de círculo máximo. */
export function pathLengthM(points: LonLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1]!
    const [lon2, lat2] = points[i]!
    total += distanceM(lat1, lon1, lat2, lon2)
  }
  return total
}

/**
 * Área (m²) del polígono cerrado por los puntos sobre la esfera (fórmula de Chamberlain y Duquette, la que
 * usan Turf y OpenLayers). Error < 0,5 % frente al elipsoide en superficies de uso práctico.
 */
export function polygonAreaM2(points: LonLat[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [lon1, lat1] = points[i]!
    const [lon2, lat2] = points[(i + 1) % points.length]!
    sum += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((sum * R * R) / 2)
}

/** «850 m²», «2,4 ha», «13,5 km²» en el formato numérico del idioma. */
export function formatArea(m2: number, locale: string): string {
  const n = (v: number, d: number): string => v.toLocaleString(locale, { maximumFractionDigits: d })
  if (m2 < 10_000) return `${n(Math.round(m2), 0)} m²`
  if (m2 < 1_000_000) return `${n(m2 / 10_000, 2)} ha`
  return `${n(m2 / 1_000_000, m2 < 10_000_000 ? 2 : 1)} km²`
}
