import { request } from 'node:http'
import { assertTrustedAction } from '../../utils/system'

/**
 * /api/vault/** → servicio vault por socket Unix. La ruta ya está restringida a
 * loopback por el middleware private-guard; las escrituras exigen cabecera de acción.
 * Las respuestas nunca se cachean (no-store) para no dejar copias en el navegador.
 */
export default defineEventHandler(async (event) => {
  const { vaultSocket } = useRuntimeConfig(event)
  const method = event.method
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) throw createError({ statusCode: 405 })
  if (method !== 'GET' && method !== 'HEAD') assertTrustedAction(event)
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  if (path.includes('..')) throw createError({ statusCode: 400 })
  const target = `/${path}${getRequestURL(event).search}`
  const req = event.node.req
  const res = event.node.res

  await new Promise<void>((resolve) => {
    const headers: Record<string, string> = { 'content-type': req.headers['content-type'] ?? 'application/octet-stream' }
    if (req.headers['content-length']) headers['content-length'] = req.headers['content-length']
    const upstream = request({ socketPath: vaultSocket, path: target, method, headers, timeout: 600_000 }, (up) => {
      res.statusCode = up.statusCode ?? 502
      for (const h of ['content-type', 'content-length', 'content-disposition']) {
        const v = up.headers[h]
        if (v) res.setHeader(h, v)
      }
      res.setHeader('cache-control', 'no-store, max-age=0')
      up.pipe(res)
      up.on('end', () => resolve())
      up.on('error', () => resolve())
    })
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 503
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Servicio de bóveda no disponible' }))
      }
      resolve()
    })
    if (method === 'GET' || method === 'HEAD') upstream.end()
    else req.pipe(upstream)
  })
})
