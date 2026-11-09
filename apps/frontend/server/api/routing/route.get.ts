import type { RouteResult } from '@survival-os/shared-types'
import { brouterUrl, parseBrouterGeoJson, parseMode, parsePoint } from '../../utils/routing'

/**
 * Ruta sin conexión entre dos puntos (BRouter local).
 *   GET /api/routing/route?from=lat,lon&to=lat,lon&mode=foot|bike|car[&format=gpx]
 * Solo lectura; BRouter escucha en loopback y nunca sale a Internet.
 */
export default defineEventHandler(async (event): Promise<RouteResult | string> => {
  const q = getQuery(event)
  const from = parsePoint(q.from)
  const to = parsePoint(q.to)
  const mode = parseMode(q.mode)
  if (!from || !to || !mode) throw createError({ statusCode: 400, statusMessage: 'Parámetros de ruta no válidos' })
  const gpx = q.format === 'gpx'
  let res: Response
  try {
    res = await fetch(brouterUrl(from, to, mode, gpx ? 'gpx' : 'geojson'), { signal: AbortSignal.timeout(70_000) })
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'El motor de rutas no responde (Mantenimiento → Rutas)' })
  }
  const text = await res.text()
  if (!res.ok) {
    // BRouter explica en texto plano por qué no hay ruta (p. ej. fuera de las cuadrículas instaladas).
    throw createError({ statusCode: 422, statusMessage: `Sin ruta: ${text.trim().slice(0, 160) || 'BRouter no encontró camino'}` })
  }
  if (gpx) {
    setHeader(event, 'content-type', 'application/gpx+xml; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="ruta-${mode}.gpx"`)
    setHeader(event, 'cache-control', 'no-store')
    return text
  }
  try {
    return parseBrouterGeoJson(JSON.parse(text), mode)
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: err instanceof Error ? err.message : 'Respuesta de BRouter no válida' })
  }
})
