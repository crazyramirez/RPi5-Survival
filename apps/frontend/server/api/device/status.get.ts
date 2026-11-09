import type { DeviceStatus } from '@survival-os/shared-types'

/**
 * Proxy de solo lectura hacia device-api (loopback). El navegador nunca
 * habla directamente con servicios del sistema.
 */
export default defineEventHandler(async (event) => {
  const { deviceApiUrl } = useRuntimeConfig(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    return await $fetch<DeviceStatus>(`${deviceApiUrl}/status`, { timeout: 5000, retry: 0 })
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'device-api no disponible' })
  }
})
