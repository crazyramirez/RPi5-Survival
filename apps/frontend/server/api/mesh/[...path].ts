import { proxyToLocal } from '../../utils/proxy'

/** /api/mesh/** → pasarela Meshtastic (127.0.0.1:8787). Escritura (envío) con cabecera de acción. */
export default defineEventHandler((event) => {
  const { meshUrl } = useRuntimeConfig(event)
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  if (!/^(status|nodes|channels|messages|send|track|refresh)$/.test(path)) throw createError({ statusCode: 404 })
  const query = getRequestURL(event).search
  return proxyToLocal(event, `${meshUrl}/${path}${query}`, { allowWrite: true, timeoutMs: 15_000 })
})
