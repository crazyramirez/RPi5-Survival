/**
 * Recolectores de estado. Cada uno devuelve un Probe honesto:
 * 'ok' solo con una medida real; 'unavailable' con motivo si no hay hardware/herramienta.
 */
import os from 'node:os'
import { join } from 'node:path'
import { statfs } from 'node:fs/promises'
import type {
  BatteryInfo,
  CpuInfo,
  DisplayOutput,
  FanInfo,
  InputDeviceInfo,
  MainsInfo,
  MemoryInfo,
  MountUsage,
  NetworkInfo,
  NetworkInterface,
  PlatformInfo,
  PowerInfo,
  Probe,
  RtcInfo,
  SdHealthInfo,
  SerialInfo,
  ServiceUnitState,
  SoftwareInfo,
  TimeInfo,
} from '@survival-os/shared-types'
import { androidDevice, isAndroid, parseLoadavg } from './android.ts'
import { isLinux, notLinux, ok, unavailable, failed } from './probe.ts'
import { exists, listDir, readBytes, readText, run } from './sys.ts'
import {
  parseDeviceTreeString,
  parseDeviceTreeU32,
  parseDrmModes,
  parseInputDevices,
  parseKeyValue,
  parseMeminfo,
  parseNmcliTerse,
  parsePmsetBatt,
  parsePmicAdc,
  parseSdHealth,
  parseSystemctlShow,
  parseThrottled,
  parseW32tmLeap,
  parseWinPowerStatus,
  timeSourceFrom,
  upsFrom,
} from './parsers.ts'

/** Umbral por debajo del cual se considera que no hay pila RTC instalada. */
const RTC_BATTERY_MIN_V = 1.0

export async function collectPlatform(): Promise<PlatformInfo> {
  if (isAndroid()) {
    const a = await androidDevice()
    return {
      os: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      kernel: os.release(),
      model: a ? `${[a.manufacturer, a.model].filter(Boolean).join(' ')} · Android ${a.release}` : null,
    }
  }
  const model = await readText('/proc/device-tree/model')
  return {
    os: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    kernel: os.release(),
    model: model ? parseDeviceTreeString(model) : null,
  }
}

export function collectUptime(): Probe<{ seconds: number }> {
  return ok({ seconds: Math.round(os.uptime()) })
}

export async function collectCpu(): Promise<Probe<CpuInfo>> {
  if (isAndroid()) {
    // os.loadavg() devuelve ceros si Android bloquea /proc/loadavg: se lee directamente o no se informa.
    const load = parseLoadavg(await readText('/proc/loadavg'))
    if (!load) return unavailable('Android no permite a las apps leer la carga del procesador')
    const raw = await readText('/sys/class/thermal/thermal_zone0/temp')
    const milli = raw ? Number.parseInt(raw.trim(), 10) : Number.NaN
    return ok({ temperatureC: Number.isFinite(milli) && milli > 0 ? Math.round(milli / 100) / 10 : null, load1: round2(load[0]), load5: round2(load[1]), load15: round2(load[2]), cores: os.availableParallelism() })
  }
  if (!isLinux()) return notLinux()
  const raw = await readText('/sys/class/thermal/thermal_zone0/temp')
  const milli = raw ? Number.parseInt(raw.trim(), 10) : Number.NaN
  const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg()
  return ok({
    temperatureC: Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null,
    load1: round2(load1),
    load5: round2(load5),
    load15: round2(load15),
    cores: os.availableParallelism(),
  })
}

export async function collectFan(): Promise<Probe<FanInfo>> {
  if (!isLinux()) return notLinux()
  const base = '/sys/devices/platform/cooling_fan/hwmon'
  const hw = (await listDir(base)).find((d) => d.startsWith('hwmon'))
  if (!hw) return unavailable('Sin ventilador PWM detectado')
  const rpm = await readText(`${base}/${hw}/fan1_input`)
  const pwm = await readText(`${base}/${hw}/pwm1`)
  const rpmN = rpm ? Number.parseInt(rpm.trim(), 10) : Number.NaN
  if (!Number.isFinite(rpmN)) return unavailable('Ventilador sin tacómetro legible')
  const pwmN = pwm ? Number.parseInt(pwm.trim(), 10) : Number.NaN
  return ok({ rpm: rpmN, pwm: Number.isFinite(pwmN) ? pwmN : null })
}

export async function collectMemory(): Promise<Probe<MemoryInfo>> {
  if (isAndroid()) {
    const parsed = parseMeminfo((await readText('/proc/meminfo')) ?? '')
    return ok(parsed ?? { totalBytes: os.totalmem(), availableBytes: os.freemem() })
  }
  if (!isLinux()) return ok({ totalBytes: os.totalmem(), availableBytes: os.freemem() })
  const text = await readText('/proc/meminfo')
  const parsed = text ? parseMeminfo(text) : null
  return parsed ? ok(parsed) : failed('/proc/meminfo ilegible')
}

export async function collectStorage(mounts: string[]): Promise<Probe<MountUsage[]>> {
  const results: MountUsage[] = []
  for (const mount of mounts) {
    try {
      const s = await statfs(mount)
      results.push({
        mount,
        totalBytes: s.blocks * s.bsize,
        availableBytes: s.bavail * s.bsize,
      })
    } catch {
      // Punto de montaje ausente: se omite (no se inventa).
    }
  }
  return results.length ? ok(results) : unavailable('Ningún punto de montaje configurado es accesible')
}

/** Lectura única del PMIC por ciclo (la comparten power y rtc). */
export async function readPmic(): Promise<Record<string, number> | null> {
  if (!isLinux()) return null
  const res = await run('vcgencmd', ['pmic_read_adc'])
  if (!res.ok) return null
  const parsed = parsePmicAdc(res.stdout)
  return Object.keys(parsed).length ? parsed : null
}

export async function collectPower(pmic: Record<string, number> | null): Promise<Probe<PowerInfo>> {
  if (!isLinux()) return notLinux()
  const throttledRes = await run('vcgencmd', ['get_throttled'])
  if (!throttledRes.ok && !pmic) return unavailable('vcgencmd no disponible: sin telemetría de alimentación')
  const maxCurrent = await readBytes('/proc/device-tree/chosen/power/max_current')
  return ok({
    inputVoltageV: pmic?.EXT5V_V !== undefined ? round2(pmic.EXT5V_V) : null,
    supplyMaxCurrentMa: maxCurrent ? parseDeviceTreeU32(maxCurrent) : null,
    throttle: throttledRes.ok ? parseThrottled(throttledRes.stdout) : null,
  })
}

const UPS_STATUS_PATH = '/run/survival-os/ups.json'

/**
 * Batería principal: solo se informa con un medidor real. Primero el kernel
 * (/sys/class/power_supply/<x>/type == Battery con 'capacity'); si no, la UPS X120x
 * leída por survival-ups. Nunca se estima.
 */
/**
 * Equipo anfitrión de la versión portable (ADR 0016): batería y cargador del portátil en Windows y macOS.
 * Una sola consulta cada 30 s (PowerShell tarda ~0,5 s).
 */
let hostPowerCache: { at: number; battery: Probe<BatteryInfo>; mains: Probe<MainsInfo> } | null = null
async function hostPower(): Promise<{ battery: Probe<BatteryInfo>; mains: Probe<MainsInfo> }> {
  if (hostPowerCache && Date.now() - hostPowerCache.at < 30_000) return hostPowerCache
  let battery: Probe<BatteryInfo> = unavailable('Sin dato de batería del sistema')
  let mains: Probe<MainsInfo> = unavailable('Sin dato de alimentación del sistema')
  if (process.platform === 'win32') {
    const res = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::PowerStatus | Select-Object PowerLineStatus,BatteryChargeStatus,BatteryLifePercent | ConvertTo-Json -Compress'],
      8000,
    )
    if (res.ok) {
      const p = parseWinPowerStatus(res.stdout.trim())
      battery = p.noBattery ? unavailable('Equipo sin batería') : p.percent !== null ? ok({ percent: p.percent, voltageV: null }) : battery
      mains = p.present !== null ? ok({ present: p.present }) : mains
    }
  } else if (process.platform === 'darwin') {
    const res = await run('pmset', ['-g', 'batt'], 5000)
    if (res.ok) {
      const p = parsePmsetBatt(res.stdout)
      battery = p.percent !== null ? ok({ percent: p.percent, voltageV: null }) : unavailable('Equipo sin batería')
      mains = p.present !== null ? ok({ present: p.present }) : mains
    }
  }
  hostPowerCache = { at: Date.now(), battery, mains }
  return hostPowerCache
}

/** Linux sin UPS (portátil con la versión portable): adaptador de corriente del kernel. */
async function linuxMainsAdapter(): Promise<Probe<MainsInfo> | null> {
  const base = '/sys/class/power_supply'
  for (const dev of await listDir(base)) {
    const type = (await readText(`${base}/${dev}/type`))?.trim()
    if (type !== 'Mains') continue
    const online = (await readText(`${base}/${dev}/online`))?.trim()
    if (online === '1' || online === '0') return ok({ present: online === '1' })
  }
  return null
}

export async function collectBattery(): Promise<Probe<BatteryInfo>> {
  if (process.platform === 'win32' || process.platform === 'darwin') return (await hostPower()).battery
  if (isAndroid()) {
    const a = await androidDevice()
    if (!a) return unavailable('La app Android no responde')
    if (!a.power.present) return unavailable('Dispositivo sin batería')
    return a.power.percent !== null ? ok({ percent: a.power.percent, voltageV: a.power.voltageV }) : unavailable('Android no informa del nivel de batería')
  }
  if (!isLinux()) return notLinux()
  const base = '/sys/class/power_supply'
  for (const dev of await listDir(base)) {
    const type = (await readText(`${base}/${dev}/type`))?.trim()
    if (type !== 'Battery') continue
    const cap = await readText(`${base}/${dev}/capacity`)
    const n = cap ? Number.parseInt(cap.trim(), 10) : Number.NaN
    const uv = Number.parseInt((await readText(`${base}/${dev}/voltage_now`))?.trim() ?? '', 10)
    if (Number.isFinite(n) && n >= 0 && n <= 100) return ok({ percent: n, voltageV: Number.isFinite(uv) ? round2(uv / 1e6) : null })
  }
  const ups = upsFrom(await readText(UPS_STATUS_PATH), Date.now()).battery
  return ups ?? unavailable('Sin medidor de batería instalado')
}

/** Red eléctrica en la entrada de la UPS X120x (survival-ups). Sin UPS → 'unavailable', nunca se supone. */
export async function collectMains(): Promise<Probe<MainsInfo>> {
  if (process.platform === 'win32' || process.platform === 'darwin') return (await hostPower()).mains
  if (isAndroid()) {
    const a = await androidDevice()
    return a ? ok({ present: a.power.plugged !== null }) : unavailable('La app Android no responde')
  }
  if (!isLinux()) return notLinux()
  const ups = upsFrom(await readText(UPS_STATUS_PATH), Date.now()).mains
  if (ups.state === 'ok') return ups
  return (await linuxMainsAdapter()) ?? ups
}

export async function collectRtc(pmic: Record<string, number> | null): Promise<Probe<RtcInfo>> {
  if (!isLinux()) return notLinux()
  const present = await exists('/sys/class/rtc/rtc0')
  if (!present) return ok({ present: false, batteryVoltageV: null, hasBattery: null })
  const v = pmic?.BATT_V
  return ok({
    present: true,
    batteryVoltageV: v !== undefined ? round2(v) : null,
    hasBattery: v !== undefined ? v >= RTC_BATTERY_MIN_V : null,
  })
}

export async function collectTime(rtc: Probe<RtcInfo>): Promise<Probe<TimeInfo>> {
  if (process.platform === 'win32') {
    // Windows mantiene la hora con su servicio NTP (w32time): verificada solo si informa sincronización.
    const res = await run('w32tm', ['/query', '/status'], 5000)
    const ntp = res.ok ? parseW32tmLeap(res.stdout) : null
    return ok({ ...timeSourceFrom(ntp, false, null, Date.now()), ntpSynchronized: ntp, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null })
  }
  if (isAndroid()) {
    // Android: hora de red del sistema (13+) y comprobación con el GNSS de la tablet, que la app deja en
    // <privado>/timesync.json con el formato de survival-timesync (ADR 0011). Una app no puede ajustar el reloj.
    const a = await androidDevice()
    const ntp = a?.networkTimeOk ?? null
    const sync = await readText(join(process.env.SURVIVAL_ANDROID_PRIVATE ?? '', 'timesync.json'))
    return ok({ ...timeSourceFrom(ntp, false, sync, Date.now()), ntpSynchronized: ntp, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null })
  }
  if (process.platform === 'darwin') {
    // macOS no expone el estado de sincronización sin administrador: no se afirma (fuente «sin verificar»).
    return ok({ ...timeSourceFrom(null, false, null, Date.now()), ntpSynchronized: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null })
  }
  if (!isLinux()) return notLinux()
  const res = await run('timedatectl', ['show', '-p', 'NTPSynchronized', '-p', 'Timezone'])
  const kv = res.ok ? parseKeyValue(res.stdout) : {}
  const ntp = kv.NTPSynchronized === undefined ? null : kv.NTPSynchronized === 'yes'
  const rtcWithBattery = rtc.state === 'ok' && rtc.value.hasBattery === true
  // GNSS/LoRa: survival-timesync deja su última comprobación en /run (ADR 0011).
  const ts = timeSourceFrom(ntp, rtcWithBattery, await readText('/run/survival-os/timesync.json'), Date.now())
  return ok({ ...ts, ntpSynchronized: ntp, timezone: kv.Timezone ?? null })
}

export async function collectNetwork(): Promise<Probe<NetworkInfo>> {
  const nets = os.networkInterfaces()
  const linux = isLinux()
  const names = linux ? (await listDir('/sys/class/net')).filter((n) => n !== 'lo') : Object.keys(nets)

  let connections = new Map<string, string>()
  if (linux) {
    const res = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device'])
    if (res.ok) {
      connections = new Map(
        parseNmcliTerse(res.stdout)
          .filter((r) => r[2] === 'connected' && r[3])
          .map((r) => [r[0] ?? '', r[3] ?? '']),
      )
    }
  }

  const interfaces: NetworkInterface[] = []
  for (const name of names) {
    const addrs = (nets[name] ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address)
    if (!linux && addrs.length === 0) continue
    let kind: NetworkInterface['kind'] = 'other'
    let up = addrs.length > 0
    if (linux) {
      if (await exists(`/sys/class/net/${name}/wireless`)) kind = 'wifi'
      else if (/^(eth|en)/.test(name)) kind = 'ethernet'
      up = (await readText(`/sys/class/net/${name}/operstate`))?.trim() === 'up'
      if (name.startsWith('p2p-') || name.startsWith('docker') || name.startsWith('veth')) continue
    }
    interfaces.push({ name, kind, up, ipv4: addrs, connection: connections.get(name) ?? null })
  }
  const mode = interfaces.some((i) => i.up && i.ipv4.length > 0) ? 'local' : 'offline'
  let wifiRadio: NetworkInfo['wifiRadio'] = null
  if (linux) {
    const r = await run('nmcli', ['radio', 'wifi'])
    if (r.ok) wifiRadio = r.stdout.trim() === 'enabled' ? 'enabled' : r.stdout.trim() === 'disabled' ? 'disabled' : null
  }
  return ok({ mode, interfaces, wifiRadio })
}

export async function collectDisplay(): Promise<Probe<DisplayOutput[]>> {
  if (!isLinux()) return notLinux()
  const base = '/sys/class/drm'
  const outputs: DisplayOutput[] = []
  for (const entry of await listDir(base)) {
    const m = /^card\d+-(.+)$/.exec(entry)
    if (!m?.[1] || m[1].startsWith('Writeback')) continue
    const status = (await readText(`${base}/${entry}/status`))?.trim()
    if (!status) continue
    const modes = await readText(`${base}/${entry}/modes`)
    outputs.push({ name: m[1], connected: status === 'connected', modes: modes ? parseDrmModes(modes) : [] })
  }
  return outputs.length ? ok(outputs) : unavailable('Sin salidas DRM')
}

export async function collectInput(): Promise<Probe<InputDeviceInfo[]>> {
  if (!isLinux()) return notLinux()
  const text = await readText('/proc/bus/input/devices')
  return text === null ? failed('/proc/bus/input/devices ilegible') : ok(parseInputDevices(text))
}

export async function collectSerial(): Promise<Probe<SerialInfo>> {
  // Portable (ADR 0016): puertos COM de Windows y /dev/cu.* de macOS, como los lista serial-hub.
  if (process.platform === 'win32') {
    const res = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', String.raw`Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' } | ForEach-Object { $_.Name }`],
      8000,
    )
    if (!res.ok) return unavailable('No se pudieron listar los puertos COM')
    const ports = res.stdout
      .split(/\r?\n/)
      .map((l) => /\((COM\d+)\)/.exec(l)?.[1])
      .filter((p): p is string => !!p)
      .sort()
    return ok({ usbPorts: ports })
  }
  if (process.platform === 'darwin') {
    const ports = (await listDir('/dev')).filter((n) => /^cu\.(usbmodem|usbserial|SLAB_USBtoUART|wchusbserial)/.test(n)).sort().map((n) => `/dev/${n}`)
    return ok({ usbPorts: ports })
  }
  if (isAndroid()) {
    const a = await androidDevice()
    return a ? ok({ usbPorts: [...a.serialPorts].sort() }) : unavailable('La app Android no responde')
  }
  if (!isLinux()) return notLinux()
  const ports = (await listDir('/dev'))
    .filter((n) => /^tty(USB|ACM)\d+$/.test(n))
    .sort()
    .map((n) => `/dev/${n}`)
  return ok({ usbPorts: ports })
}

/** Unidades del sistema que la UI debe mostrar (las inexistentes salen como 'not-found'). */
export const WATCHED_UNITS = [
  'survival-web',
  'survival-device-api',
  'survival-library',
  'survival-kiwix',
  'survival-navigation',
  'survival-vault',
  'survival-esp32-gateway',
  'gpsd',
]

export async function collectServices(): Promise<Probe<ServiceUnitState[]>> {
  if (!isLinux()) return notLinux()
  const res = await run('systemctl', ['show', '-p', 'Id,LoadState,ActiveState,SubState', ...WATCHED_UNITS.map((u) => `${u}.service`)])
  if (!res.ok) return unavailable('systemctl no disponible')
  return ok(parseSystemctlShow(res.stdout))
}

export const SD_HEALTH_FILE = process.env.SURVIVAL_SD_HEALTH_FILE ?? '/run/survival-os/sd-health.json'

/** Lee los contadores publicados por el vigilante (root). Sin fichero → no disponible. */
export async function collectSdHealth(): Promise<Probe<SdHealthInfo>> {
  if (!isLinux()) return notLinux()
  const text = await readText(SD_HEALTH_FILE)
  if (!text) return unavailable('Contadores de la microSD aún no publicados por el vigilante')
  const parsed = parseSdHealth(text)
  return parsed ? ok(parsed) : failed('Formato de sd-health.json no reconocido')
}

async function hasBinary(name: string): Promise<boolean> {
  for (const dir of ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/sbin', '/bin', '/opt/survival-os/runtime/kiwix-tools']) {
    if (await exists(`${dir}/${name}`)) return true
  }
  return false
}

export async function collectSoftware(): Promise<Probe<SoftwareInfo>> {
  if (!isLinux()) return notLinux()
  const [gpsd, kiwixServe, cryptsetup] = await Promise.all([
    hasBinary('gpsd'),
    hasBinary('kiwix-serve'),
    hasBinary('cryptsetup'),
  ])
  return ok({ gpsd, kiwixServe, cryptsetup })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
