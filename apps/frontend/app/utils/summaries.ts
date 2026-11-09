import type { DeviceStatus, NavStatus } from '@survival-os/shared-types'
import type { MessageKey } from '../locales/es'
import type { MessageParams } from './i18n'
import type { Tone } from './alerts'
import { TEMP_WARN_C } from './alerts'

export type ModuleId = 'maps' | 'navigation' | 'library' | 'emergency' | 'vault' | 'comms' | 'tools' | 'system'

export interface ModuleSummary {
  key: MessageKey
  params?: MessageParams
  tone: Tone
}

/** Línea de estado de cada módulo para la pantalla de inicio, derivada de datos reales. */
export interface SummaryExtras {
  nav: NavStatus | null
  /** Paquetes cartográficos instalados; null = desconocido. */
  maps: number | null
}

export function moduleSummaries(status: DeviceStatus | null, extras: SummaryExtras = { nav: null, maps: null }): Record<ModuleId, ModuleSummary | null> {
  if (!status) {
    return { maps: null, navigation: null, library: null, emergency: null, vault: null, comms: null, tools: null, system: null }
  }

  const kiwix = status.software.state === 'ok' && status.software.value.kiwixServe

  let comms: ModuleSummary = { key: 'summary.comms.offline', tone: 'muted' }
  if (status.network.state === 'ok') {
    const active = status.network.value.interfaces.filter((i) => i.up && i.ipv4.length > 0).length
    if (active > 0) comms = { key: 'summary.comms', params: { n: active }, tone: 'info' }
  }

  let tools: ModuleSummary = { key: 'summary.tools.none', tone: 'muted' }
  if (status.serial.state === 'ok' && status.serial.value.usbPorts.length > 0) {
    tools = { key: 'summary.tools', params: { n: status.serial.value.usbPorts.length }, tone: 'info' }
  }

  let system: ModuleSummary = { key: 'summary.system.ok', tone: 'ok' }
  const throttle = status.power.state === 'ok' ? status.power.value.throttle : null
  const temp = status.cpu.state === 'ok' ? status.cpu.value.temperatureC : null
  if (status.power.state !== 'ok' || !throttle) system = { key: 'summary.system.warn', tone: 'muted' }
  if (
    throttle?.underVoltageNow ||
    throttle?.underVoltageOccurred ||
    throttle?.throttledNow ||
    (temp !== null && temp >= TEMP_WARN_C)
  ) {
    system = { key: 'summary.system.warn', tone: 'warn' }
  }

  return {
    maps: extras.maps ? { key: 'summary.maps.count', params: { n: extras.maps }, tone: 'ok' } : { key: 'summary.maps', tone: 'muted' },
    // Solo «posición disponible» con fijación real; el respaldo LoRa se nombra como tal (datos honestos).
    navigation: extras.nav?.recording
      ? { key: 'summary.navigation.recording', tone: 'warn' }
      : extras.nav?.gnss.state === 'ok' && extras.nav.gnss.value.fix !== 'none'
        ? { key: 'summary.navigation.gnss', tone: 'ok' }
        : extras.nav?.fallback?.state === 'ok'
          ? { key: 'summary.navigation.lora', tone: 'warn' }
          : extras.nav?.gnss.state === 'ok'
            ? { key: 'summary.navigation.noFix', tone: 'warn' }
            : { key: 'summary.navigation.noGnss', tone: 'muted' },
    library: kiwix ? { key: 'summary.library.kiwix', tone: 'info' } : { key: 'summary.library.empty', tone: 'muted' },
    emergency: { key: 'summary.emergency', tone: 'info' },
    vault: { key: 'summary.vault', tone: 'muted' },
    comms,
    tools,
    system,
  }
}
