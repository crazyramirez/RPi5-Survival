import { proxyToLocal } from '../../utils/proxy'

/**
 * /api/library/** → servicio library (127.0.0.1:8782).
 * La ruta se reenvía TAL CUAL llegó (sin decodificar): el parámetro del router viene decodificado y un `%23`
 * convertido en `#` cortaba el id del favorito (todos los artículos del lector acababan en «zim:/kiwix/viewer»).
 */
export default defineEventHandler((event) => {
  const { libraryUrl } = useRuntimeConfig(event)
  const rawPath = (event.node.req.url ?? '').split('?')[0] ?? ''
  const path = rawPath.replace(/^\/api\/library\/*/, '')
  if (path.includes('..') || /%2e%2e/i.test(path)) throw createError({ statusCode: 400 })
  const query = getRequestURL(event).search
  // El asistente genera la respuesta poco a poco: puede tardar minutos en la CPU de la Pi.
  const timeoutMs = path === 'ask' ? 900_000 : 120_000
  return proxyToLocal(event, `${libraryUrl}/${path}${query}`, { allowWrite: true, timeoutMs })
})
