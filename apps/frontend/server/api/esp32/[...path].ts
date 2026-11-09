import { proxyToLocal } from '../../utils/proxy'

/** /api/esp32/** → pasarela ESP32 (127.0.0.1:8785). */
export default defineEventHandler((event) => {
  const { esp32Url } = useRuntimeConfig(event)
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  if (path.includes('..')) throw createError({ statusCode: 400 })
  return proxyToLocal(event, `${esp32Url}/${path}`, { allowWrite: true })
})
