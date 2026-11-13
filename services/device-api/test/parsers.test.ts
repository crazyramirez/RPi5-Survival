import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseDeviceTreeU32,
  parseDrmModes,
  parseInputDevices,
  parseKeyValue,
  parseMeminfo,
  parseNmcliTerse,
  parsePmicAdc,
  parseSdHealth,
  parseSystemctlShow,
  parseThrottled,
  timeSourceFrom,
  upsFrom,
} from '../src/parsers.ts'

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseThrottled', () => {
  it('sin incidencias (Pi 5 real, fuente 5 A)', () => {
    const f = parseThrottled('throttled=0x0\n')
    expect(f).not.toBeNull()
    expect(f?.underVoltageNow).toBe(false)
    expect(f?.underVoltageOccurred).toBe(false)
    expect(f?.raw).toBe('0x0')
  })

  it('undervoltage actual y pasado', () => {
    const f = parseThrottled(fixture('throttled-undervoltage.txt'))
    expect(f?.underVoltageNow).toBe(true)
    expect(f?.throttledNow).toBe(true)
    expect(f?.underVoltageOccurred).toBe(true)
    expect(f?.throttledOccurred).toBe(true)
    expect(f?.armFreqCappedNow).toBe(false)
  })

  it('formato desconocido → null (no inventar)', () => {
    expect(parseThrottled('error')).toBeNull()
    expect(parseThrottled('')).toBeNull()
  })
})

describe('parsePmicAdc', () => {
  const adc = parsePmicAdc(fixture('pmic-read-adc.txt'))
  it('lee tensión de entrada 5 V', () => {
    expect(adc.EXT5V_V).toBeGreaterThan(4.5)
    expect(adc.EXT5V_V).toBeLessThan(5.5)
  })
  it('lee BATT_V = 0 (sin pila RTC en el equipo auditado)', () => {
    expect(adc.BATT_V).toBe(0)
  })
  it('lee corrientes', () => {
    expect(adc.VDD_CORE_A).toBeGreaterThan(0)
  })
  it('ignora basura', () => {
    expect(parsePmicAdc('foo\nbar=1V\n')).toEqual({})
  })
})

describe('parseMeminfo', () => {
  it('convierte kB a bytes', () => {
    const m = parseMeminfo(fixture('meminfo.txt'))
    expect(m?.totalBytes).toBe(8256560 * 1024)
    expect(m?.availableBytes).toBeGreaterThan(0)
    expect(m!.availableBytes).toBeLessThanOrEqual(m!.totalBytes)
  })
  it('incompleto → null', () => {
    expect(parseMeminfo('MemTotal: 10 kB\n')).toBeNull()
  })
})

describe('parseInputDevices', () => {
  const devices = parseInputDevices(fixture('input-devices.txt'))

  it('detecta el táctil Waveshare como touchscreen', () => {
    const touch = devices.filter((d) => d.kind === 'touchscreen')
    expect(touch).toHaveLength(1)
    expect(touch[0]).toMatchObject({ name: 'WaveShare WS170120', vendorId: '0eef', productId: '0005' })
  })

  it('detecta teclado y puntero del mini teclado USB', () => {
    expect(devices.some((d) => d.kind === 'keyboard' && d.name === 'mini keyboard')).toBe(true)
    expect(devices.some((d) => d.kind === 'pointer' && d.name === 'mini keyboard Mouse')).toBe(true)
  })

  it('excluye dispositivos internos (HDMI CEC, botón power)', () => {
    expect(devices.some((d) => d.name.startsWith('vc4-hdmi'))).toBe(false)
    expect(devices.some((d) => d.name === 'pwr_button')).toBe(false)
  })

  it('Consumer Control no es pantalla táctil aunque tenga ABS', () => {
    const cc = devices.find((d) => d.name.includes('Consumer Control'))
    expect(cc?.kind).toBe('other')
  })
})

describe('parseNmcliTerse', () => {
  it('respeta los dos puntos escapados', () => {
    const rows = parseNmcliTerse(fixture('nmcli-device.txt'))
    expect(rows[0]).toEqual(['wlan0', 'wifi', 'connected', 'Red:Casa'])
    expect(rows[3]).toEqual(['eth0', 'ethernet', 'unavailable', ''])
  })
})

describe('parseKeyValue', () => {
  it('timedatectl show', () => {
    const kv = parseKeyValue(fixture('timedatectl-show.txt'))
    expect(kv.NTPSynchronized).toBe('yes')
    expect(kv.Timezone).toBe('Europe/Madrid')
  })
})

describe('parseDeviceTreeU32', () => {
  it('max_current 5000 mA big-endian', () => {
    expect(parseDeviceTreeU32(Buffer.from([0x00, 0x00, 0x13, 0x88]))).toBe(5000)
  })
  it('longitud incorrecta → null', () => {
    expect(parseDeviceTreeU32(Buffer.from([1, 2]))).toBeNull()
  })
})

describe('parseDrmModes', () => {
  it('panel 7" reporta 1024x600 como primer modo y elimina duplicados', () => {
    const modes = parseDrmModes(fixture('drm-modes-hdmi-a-2.txt'))
    expect(modes[0]).toBe('1024x600')
    expect(new Set(modes).size).toBe(modes.length)
  })
})

describe('parseSystemctlShow', () => {
  it('unidades activas e inexistentes', () => {
    expect(parseSystemctlShow(fixture('systemctl-show.txt'))).toEqual([
      { unit: 'survival-web', active: 'active', sub: 'running' },
      { unit: 'gpsd', active: 'not-found', sub: 'dead' },
    ])
  })
})

describe('parseSdHealth', () => {
  it('contadores reales del equipo auditado', () => {
    expect(parseSdHealth('{"commandTimeouts":6,"dataTimeouts":24,"requestTimeouts":2,"crcErrors":0,"at":"2026-11-08T19:00:00+01:00"}'))
      .toEqual({ commandTimeouts: 6, dataTimeouts: 24, requestTimeouts: 2, crcErrors: 0, readAt: '2026-11-08T19:00:00+01:00' })
  })
  it('rechaza datos inválidos', () => {
    expect(parseSdHealth('{"commandTimeouts":-1,"dataTimeouts":0,"requestTimeouts":0,"crcErrors":0,"at":"x"}')).toBeNull()
    expect(parseSdHealth('no json')).toBeNull()
  })
})

describe('timeSourceFrom (hora de respaldo, ADR 0011)', () => {
  const now = Date.parse('2026-11-09T14:00:00Z')
  const st = (o: Record<string, unknown>): string => JSON.stringify(o)
  it('NTP manda aunque haya comprobación LoRa', () => {
    expect(timeSourceFrom(true, false, st({ verifiedBy: 'lora', verifiedAt: '2026-11-09T13:59:00Z' }), now).source).toBe('ntp')
  })
  it('LoRa reciente: fuente LoRa con nodo y último ajuste', () => {
    const r = timeSourceFrom(false, false, st({ verifiedBy: 'lora', verifiedAt: '2026-11-09T13:59:00Z', node: '!1a2b3c4d', lastStep: { at: '2026-11-09T13:00:00Z', source: 'lora', deltaS: 3600.5 } }), now)
    expect(r).toEqual({ source: 'lora', verifiedAt: '2026-11-09T13:59:00Z', node: '!1a2b3c4d', lastStep: { at: '2026-11-09T13:00:00Z', source: 'lora', deltaS: 3600.5 } })
  })
  it('comprobación de hace más de 12 h, futura o basura: no verificada (o RTC con pila)', () => {
    expect(timeSourceFrom(false, false, st({ verifiedBy: 'lora', verifiedAt: '2026-11-08T01:00:00Z' }), now).source).toBe('unverified')
    expect(timeSourceFrom(false, false, st({ verifiedBy: 'gnss', verifiedAt: '2026-11-10T00:00:00Z' }), now).source).toBe('unverified')
    expect(timeSourceFrom(false, true, '{roto', now).source).toBe('rtc')
    expect(timeSourceFrom(null, false, null, now)).toEqual({ source: 'unverified', verifiedAt: null, node: null, lastStep: null })
  })
  it('fuente desconocida o nodo mal formado: se ignoran', () => {
    expect(timeSourceFrom(false, false, st({ verifiedBy: 'iphone', verifiedAt: '2026-11-09T13:59:00Z' }), now).source).toBe('unverified')
    expect(timeSourceFrom(false, false, st({ verifiedBy: 'lora', verifiedAt: '2026-11-09T13:59:00Z', node: '<b>x' }), now).node).toBeNull()
  })
})

describe('upsFrom (UPS X120x, survival-ups)', () => {
  const now = Date.parse('2026-11-12T23:00:00Z')
  const st = (o: Record<string, unknown>): string => JSON.stringify({ checkedAt: '2026-11-12T22:59:40Z', ...o })
  it('sin archivo: red no disponible y la batería cae al motivo genérico', () => {
    const r = upsFrom(null, now)
    expect(r.battery).toBeNull()
    expect(r.mains.state).toBe('unavailable')
  })
  it('red presente y medidor sin respuesta (caso real de la Pi, 2026-11-12)', () => {
    const r = upsFrom(st({ mains: true, mainsError: null, battery: null, batteryError: 'Medidor de la UPS (I²C 0x36) sin respuesta' }), now)
    expect(r.mains).toMatchObject({ state: 'ok', value: { present: true } })
    expect(r.battery).toEqual({ state: 'unavailable', reason: 'Medidor de la UPS (I²C 0x36) sin respuesta' })
  })
  it('funcionando con batería y medidor leído', () => {
    const r = upsFrom(st({ mains: false, battery: { percent: 87.5, voltageV: 4.125 } }), now)
    expect(r.mains).toMatchObject({ state: 'ok', value: { present: false } })
    expect(r.battery).toMatchObject({ state: 'ok', value: { percent: 88, voltageV: 4.13 }, at: '2026-11-12T22:59:40Z' })
  })
  it('GPIO6 al aire: la red no se supone', () => {
    const r = upsFrom(st({ mains: null, mainsError: 'GPIO6 al aire: no hay UPS X120x o no hace contacto' }), now)
    expect(r.mains).toEqual({ state: 'unavailable', reason: 'GPIO6 al aire: no hay UPS X120x o no hace contacto' })
  })
  it('lectura caducada (> 2 min) o ilegible: nada se da por bueno', () => {
    const old = upsFrom(JSON.stringify({ checkedAt: '2026-11-12T22:50:00Z', mains: true, battery: { percent: 50, voltageV: 3.9 } }), now)
    expect(old.mains.state).toBe('unavailable')
    expect(old.battery?.state).toBe('unavailable')
    expect(upsFrom('{no json', now).mains.state).toBe('unavailable')
    expect(upsFrom(JSON.stringify({ mains: true }), now).mains.state).toBe('unavailable')
  })
  it('porcentaje imposible o tipos erróneos: no disponible', () => {
    expect(upsFrom(st({ battery: { percent: 140, voltageV: 4 } }), now).battery?.state).toBe('unavailable')
    expect(upsFrom(st({ battery: { percent: '80' } }), now).battery?.state).toBe('unavailable')
    expect(upsFrom(st({ mains: 'yes' }), now).mains.state).toBe('unavailable')
  })
})
