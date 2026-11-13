import type { DeviceStatus } from '@survival-os/shared-types'
import type { MessageKey } from '../locales/es'
import type { MessageParams } from './i18n'
import { formatBytes, formatNumber } from './format'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted'

export interface Alert {
  id: string
  tone: Tone
  key: MessageKey
  params?: MessageParams
}

export interface AlertContext {
  apiDown: boolean
  /** Segundos desde la última lectura correcta; null si nunca la hubo. */
  ageSeconds: number | null
}

export const TEMP_WARN_C = 70
export const TEMP_CRITICAL_C = 80
export const STALE_AFTER_S = 45
export const DISK_WARN_RATIO = 0.1
export const DISK_CRITICAL_RATIO = 0.05
/** Sin red y con esta carga o menos, la alerta de batería pasa a peligro. */
export const BATTERY_LOW_PCT = 20

const ORDER: Record<Tone, number> = { danger: 0, warn: 1, info: 2, ok: 3, muted: 4 }

/**
 * Deriva alertas únicamente de datos medidos. Sin datos → sin alertas inventadas
 * (salvo la propia falta de datos).
 */
export function deriveAlerts(status: DeviceStatus | null, ctx: AlertContext): Alert[] {
  const alerts: Alert[] = []

  if (ctx.apiDown) alerts.push({ id: 'api-down', tone: 'danger', key: 'alert.apiDown' })
  else if (ctx.ageSeconds !== null && ctx.ageSeconds > STALE_AFTER_S) {
    alerts.push({ id: 'stale', tone: 'warn', key: 'alert.stale', params: { s: Math.round(ctx.ageSeconds) } })
  }

  if (!status) return alerts

  if (status.power.state === 'ok' && status.power.value.throttle) {
    const t = status.power.value.throttle
    if (t.underVoltageNow) alerts.push({ id: 'uv-now', tone: 'danger', key: 'alert.underVoltageNow' })
    else if (t.underVoltageOccurred) alerts.push({ id: 'uv-past', tone: 'warn', key: 'alert.underVoltagePast' })
    if (t.throttledNow || t.softTempLimitNow) alerts.push({ id: 'throttled', tone: 'warn', key: 'alert.throttledNow' })
  }

  if (status.cpu.state === 'ok' && status.cpu.value.temperatureC !== null) {
    const c = status.cpu.value.temperatureC
    if (c >= TEMP_CRITICAL_C) alerts.push({ id: 'temp', tone: 'danger', key: 'alert.tempCritical', params: { t: formatNumber(c) } })
    else if (c >= TEMP_WARN_C) alerts.push({ id: 'temp', tone: 'warn', key: 'alert.tempHigh', params: { t: formatNumber(c) } })
  }

  if (status.storage.state === 'ok') {
    for (const m of status.storage.value) {
      if (m.totalBytes <= 0) continue
      const ratio = m.availableBytes / m.totalBytes
      if (ratio < DISK_WARN_RATIO) {
        alerts.push({
          id: `disk-${m.mount}`,
          tone: ratio < DISK_CRITICAL_RATIO ? 'danger' : 'warn',
          key: 'alert.diskLow',
          params: { mount: m.mount, free: formatBytes(m.availableBytes) },
        })
      }
    }
  }

  if (status.sdHealth?.state === 'ok') {
    const h = status.sdHealth.value
    const total = h.dataTimeouts + h.commandTimeouts + h.requestTimeouts + h.crcErrors
    if (total > 0) {
      alerts.push({
        id: 'sd-errors',
        tone: h.requestTimeouts > 0 || h.crcErrors > 0 ? 'danger' : 'warn',
        key: 'alert.sdErrors',
        params: { n: total },
      })
    }
  }

  if (status.time.state === 'ok' && status.time.value.source === 'unverified') {
    alerts.push({ id: 'time', tone: 'warn', key: 'alert.timeUnverified' })
  }
  if (status.rtc.state === 'ok' && status.rtc.value.present && status.rtc.value.hasBattery === false) {
    alerts.push({ id: 'rtc', tone: 'info', key: 'alert.rtcNoBattery' })
  }

  // UPS: solo con lectura real de la red (GPIO6) y, si la hay, del medidor de batería.
  if (status.mains?.state === 'ok' && !status.mains.value.present) {
    const pct = status.battery.state === 'ok' ? status.battery.value.percent : null
    if (pct !== null && pct <= BATTERY_LOW_PCT) alerts.push({ id: 'battery', tone: 'danger', key: 'alert.batteryLow', params: { p: pct } })
    else if (pct !== null) alerts.push({ id: 'battery', tone: 'warn', key: 'alert.onBatteryPct', params: { p: pct } })
    else alerts.push({ id: 'battery', tone: 'warn', key: 'alert.onBattery' })
  }

  if (status.input.state === 'ok' && !status.input.value.some((d) => d.kind === 'touchscreen')) {
    alerts.push({ id: 'touch', tone: 'warn', key: 'alert.noTouch' })
  }

  return alerts.sort((a, b) => ORDER[a.tone] - ORDER[b.tone])
}
