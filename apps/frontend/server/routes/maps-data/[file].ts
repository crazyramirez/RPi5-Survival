import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MAP_FILE_RE, mapsDir, parseRange } from '../../utils/maps'

/**
 * Sirve archivos .pmtiles locales con soporte de Range (el protocolo pmtiles lee
 * por rangos). Solo nombres validados dentro del directorio de mapas.
 */
export default defineEventHandler(async (event) => {
  const file = getRouterParam(event, 'file') ?? ''
  if (!MAP_FILE_RE.test(file)) throw createError({ statusCode: 404 })
  const full = join(mapsDir(), file)
  const st = await fs.stat(full).catch(() => null)
  if (!st?.isFile()) throw createError({ statusCode: 404 })

  setResponseHeaders(event, {
    'accept-ranges': 'bytes',
    'content-type': 'application/octet-stream',
    'cache-control': 'private, max-age=86400',
    etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`,
  })
  if (event.method === 'HEAD') {
    setResponseHeader(event, 'content-length', st.size)
    return null
  }
  const range = parseRange(getRequestHeader(event, 'range'), st.size)
  if (getRequestHeader(event, 'range') && !range) {
    setResponseStatus(event, 416)
    setResponseHeader(event, 'content-range', `bytes */${st.size}`)
    return null
  }
  const { start, end } = range ?? { start: 0, end: st.size - 1 }
  if (range) {
    setResponseStatus(event, 206)
    setResponseHeader(event, 'content-range', `bytes ${start}-${end}/${st.size}`)
  }
  setResponseHeader(event, 'content-length', end - start + 1)
  return sendStream(event, createReadStream(full, { start, end }))
})
