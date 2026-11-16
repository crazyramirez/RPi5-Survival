/** Tipos de country-maps.mjs (lo importa también el servidor web en TypeScript). */
export interface CountryZone {
  bbox: [number, number, number, number]
  areaKm2: number
  far?: boolean
}
export interface Country {
  id: string
  iso2: string | null
  names: { es: string; en: string; fr: string; it: string }
  zones: CountryZone[]
}
export function countryMaxZoom(landKm2: number): number
export function estimateMapBytes(landKm2: number, maxzoom: number): number
export function countryZones(country: Country): CountryZone[]
export function countryLand(country: Country): number
export function routingTiles(country: Country): string[]
export const ROUTING_TILE_BYTES: number
export function countryName(country: Country, lang?: string): string
