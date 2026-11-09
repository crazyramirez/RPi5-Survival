import type { DeviceStatus } from '@survival-os/shared-types'
import { deriveAlerts } from '~/utils/alerts'

/** Intervalo de sondeo. Conservador: el estado cambia lentamente y la SD/CPU no deben trabajar de más. */
export const POLL_INTERVAL_MS = 10_000

/** Historial en memoria (no se persiste): 90 muestras × 10 s = 15 min. Solo valores medidos; null si no hubo medida. */
export const HISTORY_MAX = 90
export interface StatusSample {
  at: number
  tempC: number | null
  /** Carga 1 min relativa a los núcleos (1 = todos ocupados). */
  load: number | null
  /** Fracción de memoria en uso (0–1). */
  mem: number | null
}

function sampleOf(s: DeviceStatus, at: number): StatusSample {
  const cpu = s.cpu.state === 'ok' ? s.cpu.value : null
  const mem = s.memory.state === 'ok' ? s.memory.value : null
  return {
    at,
    tempC: cpu?.temperatureC ?? null,
    load: cpu && cpu.cores > 0 ? cpu.load1 / cpu.cores : null,
    mem: mem && mem.totalBytes > 0 ? (mem.totalBytes - mem.availableBytes) / mem.totalBytes : null,
  }
}

/** Estado del dispositivo compartido por toda la UI. El sondeo lo inicia el plugin cliente. */
export function useDeviceStatus() {
  const status = useState<DeviceStatus | null>('device:status', () => null)
  const apiDown = useState<boolean>('device:apiDown', () => false)
  const lastOkAt = useState<number | null>('device:lastOkAt', () => null)
  const history = useState<StatusSample[]>('device:history', () => [])
  const now = useNow()

  async function refresh(): Promise<void> {
    try {
      status.value = await $fetch<DeviceStatus>('/api/device/status', { timeout: 6000, retry: 0 })
      apiDown.value = false
      lastOkAt.value = Date.now()
      history.value = [...history.value, sampleOf(status.value, lastOkAt.value)].slice(-HISTORY_MAX)
    } catch {
      // Se conserva el último dato, pero se marca como no fiable.
      apiDown.value = true
    }
  }

  const ageSeconds = computed(() => (lastOkAt.value === null ? null : (now.value.getTime() - lastOkAt.value) / 1000))
  const alerts = computed(() => deriveAlerts(status.value, { apiDown: apiDown.value, ageSeconds: ageSeconds.value }))

  return { status, apiDown, lastOkAt, ageSeconds, alerts, history, refresh }
}
