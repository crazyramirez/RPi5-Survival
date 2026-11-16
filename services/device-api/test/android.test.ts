import { describe, expect, it } from 'vitest'
import { parseAndroidDevice, parseLoadavg } from '../src/android.ts'

describe('device-api en Android (ADR 0020)', () => {
  it('valida la respuesta del puente sin inventar', () => {
    const d = parseAndroidDevice({
      manufacturer: 'realme',
      model: 'RMP2105',
      release: '12',
      sdk: 31,
      power: { present: true, percent: 87, voltageV: 4.21, temperatureC: 29.5, plugged: 'usb' },
      serialPorts: ['usb:1003', 'android:gnss', 7],
    })
    expect(d).toEqual({
      manufacturer: 'realme',
      model: 'RMP2105',
      release: '12',
      sdk: 31,
      power: { percent: 87, voltageV: 4.21, temperatureC: 29.5, plugged: 'usb', present: true },
      serialPorts: ['usb:1003', 'android:gnss'],
      networkTimeOk: null,
    })
    const bad = parseAndroidDevice({ power: { percent: 140, plugged: null } })
    expect(bad?.power.percent).toBeNull()
    expect(bad?.power.plugged).toBeNull()
    expect(bad?.power.present).toBe(false)
    expect(parseAndroidDevice(null)).toBeNull()
  })
  it('carga del procesador solo si /proc/loadavg se puede leer', () => {
    expect(parseLoadavg('0.52 0.61 0.70 2/1234 5678\n')).toEqual([0.52, 0.61, 0.7])
    expect(parseLoadavg(null)).toBeNull()
    expect(parseLoadavg('basura')).toBeNull()
  })
})
