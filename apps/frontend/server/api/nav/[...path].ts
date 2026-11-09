import { proxyToLocal } from '../../utils/proxy'

/** /api/nav/** → servicio navigation (127.0.0.1:8784). */
export default defineEventHandler((event) => {
  const { navigationUrl } = useRuntimeConfig(event)
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  if (path.includes('..')) throw createError({ statusCode: 400 })
  return proxyToLocal(event, `${navigationUrl}/${path}${getRequestURL(event).search}`, { allowWrite: true })
})
