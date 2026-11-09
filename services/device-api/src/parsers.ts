/**
 * Parsers puros (sin E/S) para salidas de Linux/Raspberry Pi.
 * Probados con fixtures reales capturados del dispositivo (test/fixtures).
 */
import type { InputDeviceInfo, SdHealthInfo, ThrottleFlags } from '@survival-os/shared-types'

/** `vcgencmd get_throttled` → flags. Devuelve null si el formato no es reconocible. */
export function parseThrottled(text: string): ThrottleFlags | null {
  const match = /throttled=(0x[0-9a-fA-F]+)/.exec(text)
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 16)
  if (!Number.isFinite(value)) return null
  const bit = (n: number): boolean => (value & (1 << n)) !== 0
  return {
    raw: match[1].toLowerCase(),
    underVoltageNow: bit(0),
    armFreqCappedNow: bit(1),
    throttledNow: bit(2),
    softTempLimitNow: bit(3),
    underVoltageOccurred: bit(16),
    armFreqCappedOccurred: bit(17),
    throttledOccurred: bit(18),
    softTempLimitOccurred: bit(19),
  }
}

/**
 * `vcgencmd pmic_read_adc` → mapa nombre→valor.
 * Líneas tipo: "   EXT5V_V volt(24)=5.07056000V" o "VDD_CORE_A current(7)=1.90209000A".
 */
export function parsePmicAdc(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s+(?:volt|current)\(\d+\)=([0-9.]+)[VA]\s*$/.exec(line)
    if (m?.[1] && m[2]) {
      const v = Number.parseFloat(m[2])
      if (Number.isFinite(v)) out[m[1]] = v
    }
  }
  return out
}

/** /proc/meminfo → bytes. */
export function parseMeminfo(text: string): { totalBytes: number; availableBytes: number } | null {
  const get = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)
    return m?.[1] ? Number.parseInt(m[1], 10) * 1024 : null
  }
  const total = get('MemTotal')
  const available = get('MemAvailable')
  if (total === null || available === null) return null
  return { totalBytes: total, availableBytes: available }
}

/** Valor big-endian u32 de un fichero binario del device-tree (p. ej. chosen/power/max_current). */
export function parseDeviceTreeU32(buf: Buffer): number | null {
  if (buf.length !== 4) return null
  return buf.readUInt32BE(0)
}

/** Texto del device-tree (termina en \0). */
export function parseDeviceTreeString(text: string): string {
  return text.replace(/\0/g, '').trim()
}

/** `timedatectl show -p NTPSynchronized -p Timezone` → objeto. */
export function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

/**
 * `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device` → filas.
 * En modo -t, ':' dentro de valores se escapa como '\:' y '\' como '\\'.
 */
export function parseNmcliTerse(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const fields: string[] = []
    let cur = ''
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '\\' && i + 1 < line.length) {
        cur += line[i + 1]
        i++
      } else if (ch === ':') {
        fields.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    fields.push(cur)
    rows.push(fields)
  }
  return rows
}

/** Convierte una máscara hexadecimal de /proc/bus/input/devices ("B: EV=1b") en BigInt. */
function hexMask(words: string | undefined): bigint {
  if (!words) return 0n
  // Varias palabras separadas por espacio: la primera es la más significativa (64 bits cada una en aarch64).
  return words
    .trim()
    .split(/\s+/)
    .reduce((acc, w) => (acc << 64n) | BigInt(`0x${w}`), 0n)
}

const EV_ABS = 3n
const INPUT_PROP_DIRECT = 1n

/**
 * /proc/bus/input/devices → dispositivos de usuario (USB=0003, Bluetooth=0005).
 * Clasificación:
 *  - touchscreen: INPUT_PROP_DIRECT + eventos ABS
 *  - pointer: handler mouseN
 *  - keyboard: handler kbd + leds (teclado real, no botones multimedia)
 */
export function parseInputDevices(text: string): InputDeviceInfo[] {
  const devices: InputDeviceInfo[] = []
  const seen = new Set<string>()
  for (const block of text.split(/\n\s*\n/)) {
    const bus = /^I: Bus=([0-9a-f]{4}) Vendor=([0-9a-f]{4}) Product=([0-9a-f]{4})/m.exec(block)
    const name = /^N: Name="(.*)"$/m.exec(block)?.[1]?.trim()
    if (!bus || !name) continue
    const [, busId, vendorId, productId] = bus
    if (busId !== '0003' && busId !== '0005') continue
    const handlers = /^H: Handlers=(.*)$/m.exec(block)?.[1]?.trim().split(/\s+/) ?? []
    const prop = hexMask(/^B: PROP=(.*)$/m.exec(block)?.[1])
    const ev = hexMask(/^B: EV=(.*)$/m.exec(block)?.[1])
    let kind: InputDeviceInfo['kind'] = 'other'
    if ((prop & (1n << INPUT_PROP_DIRECT)) !== 0n && (ev & (1n << EV_ABS)) !== 0n) kind = 'touchscreen'
    else if (handlers.some((h) => /^mouse\d+$/.test(h))) kind = 'pointer'
    else if (handlers.includes('kbd') && handlers.includes('leds')) kind = 'keyboard'
    const key = `${vendorId}:${productId}:${kind}:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    devices.push({ name, vendorId: vendorId ?? '', productId: productId ?? '', kind })
  }
  return devices
}

/**
 * `systemctl show -p Id,LoadState,ActiveState,SubState u1 u2…` → estados.
 * Bloques separados por línea en blanco; unidades inexistentes tienen LoadState=not-found.
 */
export function parseSystemctlShow(text: string): { unit: string; active: string; sub: string }[] {
  const out: { unit: string; active: string; sub: string }[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const kv = parseKeyValue(block)
    if (!kv.Id) continue
    out.push({
      unit: kv.Id.replace(/\.service$/, ''),
      active: kv.LoadState === 'not-found' ? 'not-found' : (kv.ActiveState ?? 'unknown'),
      sub: kv.SubState ?? '',
    })
  }
  return out
}

/** Lista de modos DRM, sin duplicados, manteniendo el orden (el primero suele ser el preferido). */
export function parseDrmModes(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))]
}

/** JSON publicado por scripts/healthcheck.sh → contadores validados. */
export function parseSdHealth(text: string): SdHealthInfo | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const n = (k: string): number | null => (typeof j[k] === 'number' && Number.isInteger(j[k]) && (j[k] as number) >= 0 ? (j[k] as number) : null)
    const ct = n('commandTimeouts'), dt = n('dataTimeouts'), rt = n('requestTimeouts'), crc = n('crcErrors')
    if (ct === null || dt === null || rt === null || crc === null || typeof j.at !== 'string') return null
    return { commandTimeouts: ct, dataTimeouts: dt, requestTimeouts: rt, crcErrors: crc, readAt: j.at }
  } catch {
    return null
  }
}

/** Validez de una comprobación de hora sin red: el reloj de la Pi deriva segundos al día, no más. */
export const TIME_VERIFIED_MAX_MS = 12 * 3600 * 1000

/**
 * Fuente de la hora con el estado de survival-timesync (/run/survival-os/timesync.json, se borra al reiniciar).
 * NTP manda; si no, GNSS o LoRa solo si comprobaron la hora hace menos de 12 h; si no, RTC con pila o «no verificada».
 */
export function timeSourceFrom(
  ntp: boolean | null,
  rtcWithBattery: boolean,
  timesyncJson: string | null,
  nowMs: number,
): { source: 'ntp' | 'gnss' | 'lora' | 'rtc' | 'unverified'; verifiedAt: string | null; node: string | null; lastStep: { at: string; source: 'gnss' | 'lora'; deltaS: number } | null } {
  let st: Record<string, unknown> = {}
  try {
    const j: unknown = timesyncJson ? JSON.parse(timesyncJson) : {}
    if (j && typeof j === 'object' && !Array.isArray(j)) st = j as Record<string, unknown>
  } catch {
    st = {}
  }
  const by = st.verifiedBy === 'gnss' || st.verifiedBy === 'lora' ? st.verifiedBy : null
  const at = typeof st.verifiedAt === 'string' && !Number.isNaN(Date.parse(st.verifiedAt)) ? st.verifiedAt : null
  const fresh = by !== null && at !== null && nowMs - Date.parse(at) <= TIME_VERIFIED_MAX_MS && Date.parse(at) - nowMs < 120_000
  const ls = st.lastStep as Record<string, unknown> | null | undefined
  const lastStep =
    ls && typeof ls.at === 'string' && (ls.source === 'gnss' || ls.source === 'lora') && typeof ls.deltaS === 'number'
      ? { at: ls.at, source: ls.source as 'gnss' | 'lora', deltaS: ls.deltaS }
      : null
  const source = ntp ? 'ntp' : fresh ? by : rtcWithBattery ? 'rtc' : 'unverified'
  return {
    source,
    verifiedAt: fresh ? at : null,
    node: source === 'lora' && typeof st.node === 'string' && /^![0-9a-f]{8}$/.test(st.node) ? st.node : null,
    lastStep,
  }
}
