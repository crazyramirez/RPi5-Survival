import type { DeviceStatus } from '@survival-os/shared-types'
import { safeProbe } from './probe.ts'
import {
  collectBattery,
  collectCpu,
  collectDisplay,
  collectFan,
  collectInput,
  collectMains,
  collectMemory,
  collectNetwork,
  collectPlatform,
  collectPower,
  collectRtc,
  collectSdHealth,
  collectSerial,
  collectServices,
  collectSoftware,
  collectStorage,
  collectTime,
  collectUptime,
  readPmic,
} from './collectors.ts'

export async function collectStatus(mounts: string[]): Promise<DeviceStatus> {
  const pmic = await readPmic().catch(() => null)
  const rtc = await safeProbe(() => collectRtc(pmic))
  const [platform, uptime, cpu, fan, memory, storage, power, battery, mains, time, network, display, input, serial, software, services, sdHealth] =
    await Promise.all([
      collectPlatform(),
      safeProbe(collectUptime),
      safeProbe(collectCpu),
      safeProbe(collectFan),
      safeProbe(collectMemory),
      safeProbe(() => collectStorage(mounts)),
      safeProbe(() => collectPower(pmic)),
      safeProbe(collectBattery),
      safeProbe(collectMains),
      safeProbe(() => collectTime(rtc)),
      safeProbe(collectNetwork),
      safeProbe(collectDisplay),
      safeProbe(collectInput),
      safeProbe(collectSerial),
      safeProbe(collectSoftware),
      safeProbe(collectServices),
      safeProbe(collectSdHealth),
    ])
  return {
    collectedAt: new Date().toISOString(),
    platform,
    uptime,
    cpu,
    fan,
    memory,
    storage,
    power,
    battery,
    mains,
    rtc,
    time,
    network,
    display,
    input,
    serial,
    software,
    services,
    sdHealth,
  }
}

/**
 * Caché con deduplicación de peticiones concurrentes: varias pestañas o
 * sondeos simultáneos no multiplican las llamadas a vcgencmd/sysfs.
 */
export function createStatusCache(mounts: string[], ttlMs: number) {
  let last: { at: number; value: DeviceStatus } | null = null
  let inflight: Promise<DeviceStatus> | null = null
  return async function get(): Promise<DeviceStatus> {
    const now = Date.now()
    if (last && now - last.at < ttlMs) return last.value
    if (!inflight) {
      inflight = collectStatus(mounts)
        .then((value) => {
          last = { at: Date.now(), value }
          return value
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }
}
