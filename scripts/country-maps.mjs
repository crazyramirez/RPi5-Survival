/**
 * Mapas y rutas de cualquier país (ADR 0018). Lo comparten el motor de descargas (content-engine.mjs) y el
 * servidor web (buscador de países): mismos zooms, tamaños estimados y cuadrículas en los dos lados.
 * Los países salen de content/countries.json (Natural Earth, scripts/build-countries.mjs).
 */

/** Zoom máximo según la superficie: nivel de calle (15) en países como España; menos en los enormes. */
export function countryMaxZoom(landKm2) {
  if (landKm2 < 700_000) return 15
  if (landKm2 < 2_500_000) return 14
  if (landKm2 < 8_000_000) return 13
  return 12
}

/**
 * Tamaño aproximado de la extracción Protomaps. Calibrado con las extracciones reales: España peninsular
 * (499 040 km², z15) = 3,4 GB y Canarias (7133 km², z15) = 63 MB → unos 7 kB por km² de tierra a z15;
 * cada nivel menos deja aproximadamente el 45 % del anterior.
 */
export function estimateMapBytes(landKm2, maxzoom) {
  return Math.round(5e6 + landKm2 * 7000 * 0.45 ** Math.max(0, 15 - maxzoom))
}

/** Zonas que se descargan con el país: todas menos los territorios lejanos (`far`). */
export function countryZones(country) {
  return (country?.zones ?? []).filter((z) => !z.far)
}

/** Superficie de tierra de las zonas que se descargan. */
export function countryLand(country) {
  return countryZones(country).reduce((n, z) => n + (z.areaKm2 ?? 0), 0)
}

/** Cuadrículas BRouter de 5°×5° que cubren las zonas (nombre = esquina suroeste: W10_N35, E5_S25). */
export function routingTiles(country) {
  const out = new Set()
  for (const z of countryZones(country)) {
    const [w, s, e, n] = z.bbox
    for (let lon = Math.floor(w / 5) * 5; lon < e; lon += 5) {
      for (let lat = Math.floor(s / 5) * 5; lat < n; lat += 5) {
        const lo = lon < 0 ? `W${-lon}` : `E${lon}`
        const la = lat < 0 ? `S${-lat}` : `N${lat}`
        out.add(`${lo}_${la}`)
      }
    }
  }
  return [...out].sort()
}

/** Las cuadrículas BRouter pesan de media unos 120 MB (las de mar no existen y se omiten). */
export const ROUTING_TILE_BYTES = 120e6

/** Nombre del país en un idioma (es, en, fr, it), con el español de reserva. */
export function countryName(country, lang = 'es') {
  return country?.names?.[lang] || country?.names?.es || country?.id?.toUpperCase() || ''
}
