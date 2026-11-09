import { proxyToLocal } from '../../utils/proxy'

/** /api/library/** → servicio library (127.0.0.1:8782). */
export default defineEventHandler((event) => {
  const { libraryUrl } = useRuntimeConfig(event)
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  if (path.includes('..')) throw createError({ statusCode: 400 })
  const query = getRequestURL(event).search
  // El asistente genera la respuesta poco a poco: puede tardar minutos en la CPU de la Pi.
  const timeoutMs = path === 'ask' ? 900_000 : 120_000
  return proxyToLocal(event, `${libraryUrl}/${path}${query}`, { allowWrite: true, timeoutMs })
})
