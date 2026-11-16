/**
 * App Android (ADR 0020): datos del dispositivo que solo la API de Android conoce (modelo, batería, cargador),
 * leídos del puente nativo de la app (SURVIVAL_ANDROID_BRIDGE). Nunca se inventa: sin puente o sin dato → null.
 */

export interface AndroidPower {
  /** 0–100 según BatteryManager; null si el sistema no lo informa. */
  percent: number | null
  voltageV: number | null
  temperatureC: number | null
  /** Fuente de carga conectada (ac, usb, wireless, dock) o null si no hay ninguna. */
  plugged: string | null
  /** El sistema informa de batería (false en dispositivos sin ella). */
  present: boolean
}

export interface AndroidDeviceInfo {
  manufacturer: string
  model: string
  release: string
  sdk: number
  power: AndroidPower
  serialPorts: string[]
  /** Android 13+: la hora de red del sistema (NTP) coincide con el reloj; null si Android no lo expone. */
  networkTimeOk: boolean | null
}

export const isAndroid = (): boolean => process.platform === 'android'

let cache: { at: number; info: AndroidDeviceInfo | null } | null = null

/** Datos del puente (caché de 10 s). null si el puente no responde. */
export async function androidDevice(): Promise<AndroidDeviceInfo | null> {
  if (cache && Date.now() - cache.at < 10_000) return cache.info
  const base = process.env.SURVIVAL_ANDROID_BRIDGE
  let info: AndroidDeviceInfo | null = null
  if (base) {
    try {
      const res = await fetch(`${base}/device/info`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) info = parseAndroidDevice(await res.json())
    } catch {
      info = null
    }
  }
  cache = { at: Date.now(), info }
  return info
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 120) : '')

/** Valida la respuesta del puente (puede venir de otra versión de la app). */
export function parseAndroidDevice(raw: unknown): AndroidDeviceInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const p = (r.power && typeof r.power === 'object' ? r.power : {}) as Record<string, unknown>
  const percent = num(p.percent)
  return {
    manufacturer: str(r.manufacturer),
    model: str(r.model),
    release: str(r.release),
    sdk: num(r.sdk) ?? 0,
    power: {
      percent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
      voltageV: num(p.voltageV),
      temperatureC: num(p.temperatureC),
      plugged: typeof p.plugged === 'string' && p.plugged ? p.plugged : null,
      present: p.present === true,
    },
    serialPorts: Array.isArray(r.serialPorts) ? r.serialPorts.filter((x): x is string => typeof x === 'string').slice(0, 32) : [],
    networkTimeOk: typeof r.networkTimeOk === 'boolean' ? r.networkTimeOk : null,
  }
}

/** /proc/loadavg → [1, 5, 15] min, o null (Android lo bloquea en muchas versiones; os.loadavg() daría ceros). */
export function parseLoadavg(text: string | null): [number, number, number] | null {
  if (!text) return null
  const parts = text.trim().split(/\s+/).slice(0, 3).map(Number)
  return parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0) ? (parts as [number, number, number]) : null
}
