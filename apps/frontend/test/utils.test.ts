import { describe, expect, it } from 'vitest'
import type { DeviceStatus } from '@survival-os/shared-types'
import { deriveAlerts } from '../app/utils/alerts'
import { parseDecimalDegrees, parseMapQuery, toDms } from '../app/utils/coords'
import { formatBytes, formatDuration } from '../app/utils/format'
import { interpolate, translate } from '../app/utils/i18n'
import { moduleSummaries } from '../app/utils/summaries'
import { allowPrivateRequest, isLoopbackAddress, isPrivatePath } from '../server/utils/net'

const at = '2026-11-08T17:00:00.000Z'

/** Estado sintético coherente con el equipo auditado (sin datos personales). */
function baseStatus(): DeviceStatus {
  return {
    collectedAt: at,
    platform: { os: 'linux', arch: 'arm64', hostname: 'test', kernel: '6.12', model: 'Raspberry Pi 5 Model B Rev 1.0' },
    uptime: { state: 'ok', value: { seconds: 3600 }, at },
    cpu: { state: 'ok', value: { temperatureC: 58, load1: 0.4, load5: 0.3, load15: 0.3, cores: 4 }, at },
    fan: { state: 'ok', value: { rpm: 2440, pwm: 125 }, at },
    memory: { state: 'ok', value: { totalBytes: 8e9, availableBytes: 7e9 }, at },
    storage: { state: 'ok', value: [{ mount: '/', totalBytes: 117e9, availableBytes: 104e9 }], at },
    power: {
      state: 'ok',
      value: {
        inputVoltageV: 5.07,
        supplyMaxCurrentMa: 5000,
        throttle: {
          raw: '0x0', underVoltageNow: false, armFreqCappedNow: false, throttledNow: false, softTempLimitNow: false,
          underVoltageOccurred: false, armFreqCappedOccurred: false, throttledOccurred: false, softTempLimitOccurred: false,
        },
      },
      at,
    },
    battery: { state: 'unavailable', reason: 'Sin medidor de batería instalado' },
    rtc: { state: 'ok', value: { present: true, batteryVoltageV: 0, hasBattery: false }, at },
    time: { state: 'ok', value: { source: 'ntp', ntpSynchronized: true, timezone: 'Europe/Madrid', verifiedAt: null, node: null, lastStep: null }, at },
    network: { state: 'ok', value: { mode: 'local', interfaces: [{ name: 'wlan0', kind: 'wifi', up: true, ipv4: ['10.0.0.2'], connection: 'Test' }], wifiRadio: 'enabled' }, at },
    display: { state: 'ok', value: [{ name: 'HDMI-A-2', connected: true, modes: ['1024x600'] }], at },
    input: { state: 'ok', value: [{ name: 'WaveShare WS170120', vendorId: '0eef', productId: '0005', kind: 'touchscreen' }], at },
    serial: { state: 'ok', value: { usbPorts: [] }, at },
    software: { state: 'ok', value: { gpsd: false, kiwixServe: false, cryptsetup: false }, at },
    services: { state: 'ok', value: [], at },
    sdHealth: { state: 'ok', value: { commandTimeouts: 0, dataTimeouts: 0, requestTimeouts: 0, crcErrors: 0, readAt: at }, at },
  }
}

describe('deriveAlerts', () => {
  it('equipo sano: solo aviso informativo de RTC sin pila', () => {
    const alerts = deriveAlerts(baseStatus(), { apiDown: false, ageSeconds: 2 })
    expect(alerts.map((a) => a.id)).toEqual(['rtc'])
    expect(alerts[0]?.tone).toBe('info')
  })

  it('undervoltage actual es peligro y va primero', () => {
    const s = baseStatus()
    if (s.power.state === 'ok' && s.power.value.throttle) {
      s.power.value.throttle.underVoltageNow = true
      s.power.value.throttle.underVoltageOccurred = true
    }
    const alerts = deriveAlerts(s, { apiDown: false, ageSeconds: 1 })
    expect(alerts[0]).toMatchObject({ id: 'uv-now', tone: 'danger' })
    expect(alerts.some((a) => a.id === 'uv-past')).toBe(false)
  })

  it('temperatura alta y crítica', () => {
    const s = baseStatus()
    if (s.cpu.state === 'ok') s.cpu.value.temperatureC = 72
    expect(deriveAlerts(s, { apiDown: false, ageSeconds: 1 }).find((a) => a.id === 'temp')?.tone).toBe('warn')
    if (s.cpu.state === 'ok') s.cpu.value.temperatureC = 85
    expect(deriveAlerts(s, { apiDown: false, ageSeconds: 1 }).find((a) => a.id === 'temp')?.tone).toBe('danger')
  })

  it('poco disco', () => {
    const s = baseStatus()
    if (s.storage.state === 'ok') s.storage.value[0]!.availableBytes = 3e9
    expect(deriveAlerts(s, { apiDown: false, ageSeconds: 1 }).find((a) => a.id === 'disk-/')?.tone).toBe('danger')
  })

  it('hora no verificada', () => {
    const s = baseStatus()
    if (s.time.state === 'ok') s.time.value.source = 'unverified'
    expect(deriveAlerts(s, { apiDown: false, ageSeconds: 1 }).some((a) => a.id === 'time')).toBe(true)
  })

  it('sin táctil detectado', () => {
    const s = baseStatus()
    if (s.input.state === 'ok') s.input.value = []
    expect(deriveAlerts(s, { apiDown: false, ageSeconds: 1 }).some((a) => a.id === 'touch')).toBe(true)
  })

  it('API caída sin datos: una única alerta, nada inventado', () => {
    expect(deriveAlerts(null, { apiDown: true, ageSeconds: null })).toEqual([
      { id: 'api-down', tone: 'danger', key: 'alert.apiDown' },
    ])
  })

  it('datos antiguos', () => {
    expect(deriveAlerts(null, { apiDown: false, ageSeconds: 120 })[0]?.id).toBe('stale')
  })
})

describe('moduleSummaries', () => {
  it('sin estado → todos null (UI muestra "Leyendo…")', () => {
    expect(Object.values(moduleSummaries(null)).every((v) => v === null)).toBe(true)
  })
  it('refleja datos reales', () => {
    const m = moduleSummaries(baseStatus())
    expect(m.navigation?.key).toBe('summary.navigation.noGnss')
    expect(m.comms).toMatchObject({ key: 'summary.comms', params: { n: 1 } })
    expect(m.system?.tone).toBe('ok')
    expect(m.library?.key).toBe('summary.library.empty')
  })
  it('navegación: solo «posición disponible» con fijación real; el respaldo LoRa se nombra como tal', () => {
    const at = '2026-11-09T10:00:00Z'
    const gnss = (fix: 'none' | '3d') => ({ state: 'ok', at, value: { fix } }) as never
    const fb = { state: 'ok', at, value: {} } as never
    const nav = (g: unknown, f?: unknown) => ({ nav: { recording: null, devices: [], simulated: false, gnss: g, fallback: f } as never, maps: null })
    expect(moduleSummaries(baseStatus(), nav(gnss('3d'))).navigation?.key).toBe('summary.navigation.gnss')
    expect(moduleSummaries(baseStatus(), nav(gnss('none'), fb)).navigation).toMatchObject({ key: 'summary.navigation.lora', tone: 'warn' })
    expect(moduleSummaries(baseStatus(), nav(gnss('none'))).navigation?.key).toBe('summary.navigation.noFix')
    expect(moduleSummaries(baseStatus(), nav({ state: 'unavailable', reason: 'x' })).navigation?.key).toBe('summary.navigation.noGnss')
  })
  it('sistema en aviso si hubo undervoltage', () => {
    const s = baseStatus()
    if (s.power.state === 'ok' && s.power.value.throttle) s.power.value.throttle.underVoltageOccurred = true
    expect(moduleSummaries(s).system?.tone).toBe('warn')
  })
})

describe('coords', () => {
  it('parsea punto y coma decimal', () => {
    expect(parseDecimalDegrees('40.4168', 'lat')).toBeCloseTo(40.4168)
    expect(parseDecimalDegrees('-3,7038', 'lon')).toBeCloseTo(-3.7038)
  })
  it('rechaza fuera de rango y basura', () => {
    expect(parseDecimalDegrees('91', 'lat')).toBeNull()
    expect(parseDecimalDegrees('181', 'lon')).toBeNull()
    expect(parseDecimalDegrees('abc', 'lat')).toBeNull()
    expect(parseDecimalDegrees('1e3', 'lat')).toBeNull()
  })
  it('convierte a GMS con hemisferio', () => {
    expect(toDms(40.4168, 'lat')).toBe('40° 25′ 00,5″ N')
    expect(toDms(-3.7038, 'lon')).toBe('3° 42′ 13,7″ O')
  })
  it('no produce 60″ por redondeo', () => {
    expect(toDms(10.999999, 'lat')).toBe('11° 00′ 00,0″ N')
  })
})

describe('format', () => {
  it('bytes SI', () => {
    expect(formatBytes(104e9)).toBe('104 GB')
    expect(formatBytes(1.5e9)).toBe('1,5 GB')
    expect(formatBytes(-1)).toBe('—')
  })
  it('duración', () => {
    expect(formatDuration(59)).toBe('0 min')
    expect(formatDuration(3 * 3600 + 120)).toBe('3 h 2 min')
    expect(formatDuration(2 * 86400 + 3600)).toBe('2 d 1 h')
  })
})

describe('i18n', () => {
  it('interpola parámetros', () => {
    expect(interpolate('Hola {x}', { x: 1 })).toBe('Hola 1')
    expect(interpolate('Hola {y}', { x: 1 })).toBe('Hola {y}')
  })
  it('traduce claves', () => {
    expect(translate('bar.battery.unavailable')).toBe('Batería: no disponible')
  })
})

describe('red y rutas privadas', () => {
  it('loopback', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.68.10')).toBe(false)
    expect(isLoopbackAddress('::ffff:192.168.1.5')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
  it('detecta rutas privadas, también ofuscadas', () => {
    for (const p of ['/boveda', '/boveda/', '/boveda/x', '/api/vault/unlock', '//boveda', '/./boveda', '/%62oveda', '/BOVEDA?x=1']) {
      expect(isPrivatePath(p), p).toBe(true)
    }
    for (const p of ['/', '/bovedas', '/api/health', '/sistema']) {
      expect(isPrivatePath(p), p).toBe(false)
    }
  })
  it('deniega remoto y peticiones reenviadas por proxy', () => {
    expect(allowPrivateRequest('127.0.0.1', {})).toBe(true)
    expect(allowPrivateRequest('192.168.68.20', {})).toBe(false)
    expect(allowPrivateRequest('127.0.0.1', { 'x-forwarded-for': '192.168.68.20' })).toBe(false)
  })
})

describe('parseMapQuery (enlaces /mapas?lat=&lon=&z=)', () => {
  it('centro y zoom válidos', () => {
    expect(parseMapQuery({ lat: '40.4168', lon: '-3.7038', z: '15' })).toEqual({ center: [-3.7038, 40.4168], zoom: 15 })
    expect(parseMapQuery({ lat: '40.4', lon: '-3.7' })).toEqual({ center: [-3.7, 40.4], zoom: 14 })
  })
  it('ausente, vacío, no numérico o fuera de rango: null; zoom acotado', () => {
    expect(parseMapQuery({})).toBeNull()
    expect(parseMapQuery({ lat: '', lon: '' })).toBeNull()
    expect(parseMapQuery({ lat: 'x', lon: '1' })).toBeNull()
    expect(parseMapQuery({ lat: '91', lon: '0' })).toBeNull()
    expect(parseMapQuery({ lat: ['1'], lon: '2' })).toBeNull()
    expect(parseMapQuery({ lat: '1', lon: '2', z: '40' })?.zoom).toBe(18)
  })
})
