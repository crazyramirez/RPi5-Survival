import type { ComponentState, HealthReport } from '@survival-os/shared-types'

type Component = HealthReport['components'][string]

async function probe(url: string): Promise<Component> {
  const started = performance.now()
  try {
    await $fetch(url, { timeout: 2000, retry: 0 })
    return { state: 'ok', latencyMs: Math.round(performance.now() - started) }
  } catch {
    return { state: 'down', detail: 'Sin respuesta en loopback' }
  }
}

/**
 * Salud agregada.
 *  - Núcleo (web + deviceApi) caído → 503 (el vigilante reinicia).
 *  - Servicios opcionales caídos → "degraded" con 200: la interfaz sigue siendo útil.
 */
export default defineEventHandler(async (event): Promise<HealthReport> => {
  const c = useRuntimeConfig(event)
  setResponseHeader(event, 'cache-control', 'no-store')

  const [deviceApi, library, kiwix, navigation, esp32Gateway] = await Promise.all([
    probe(`${c.deviceApiUrl}/health`),
    probe(`${c.libraryUrl}/health`),
    probe(`${c.kiwixUrl}/kiwix/catalog/v2/root.xml`),
    probe(`${c.navigationUrl}/health`),
    probe(`${c.esp32Url}/health`),
  ])
  const components: Record<string, Component> = {
    web: { state: 'ok' },
    deviceApi,
    library,
    kiwix,
    navigation,
    esp32Gateway,
  }
  const coreDown = deviceApi.state !== 'ok'
  const optionalDown = [library, kiwix, navigation, esp32Gateway].some((x) => x.state !== 'ok')
  const status: ComponentState = coreDown ? 'down' : optionalDown ? 'degraded' : 'ok'
  if (coreDown) setResponseStatus(event, 503)

  return { status, version: c.public.version, time: new Date().toISOString(), components }
})
