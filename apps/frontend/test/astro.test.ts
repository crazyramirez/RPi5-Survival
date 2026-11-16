import { describe, expect, it } from 'vitest'
import { moonInfo, sunTimes } from '../app/utils/astro'

/** Minutos UTC del día de una fecha. */
const utcMin = (d: Date | null): number => (d ? d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 : Number.NaN)

describe('Sol', () => {
  it('Madrid, solsticio de verano de 2026: salida ≈ 06:44 y puesta ≈ 21:48 (hora peninsular, UTC+2)', () => {
    const s = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 40.4168, -3.7038)
    expect(Math.abs(utcMin(s.sunrise) - (4 * 60 + 44))).toBeLessThan(3)
    expect(Math.abs(utcMin(s.sunset) - (19 * 60 + 48))).toBeLessThan(3)
    expect(Math.abs(utcMin(s.noon) - (12 * 60 + 16))).toBeLessThan(3)
    expect(s.polar).toBeNull()
    expect(s.daylightHours).toBeGreaterThan(15)
    // El crepúsculo civil, antes de la salida y después de la puesta.
    expect(s.dawn!.getTime()).toBeLessThan(s.sunrise!.getTime())
    expect(s.dusk!.getTime()).toBeGreaterThan(s.sunset!.getTime())
  })

  it('Madrid, solsticio de invierno: salida ≈ 08:33 y puesta ≈ 17:51 (UTC+1)', () => {
    const s = sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), 40.4168, -3.7038)
    expect(Math.abs(utcMin(s.sunrise) - (7 * 60 + 33))).toBeLessThan(3)
    expect(Math.abs(utcMin(s.sunset) - (16 * 60 + 51))).toBeLessThan(3)
  })

  it('sol de medianoche y noche polar: sin salida ni puesta, con el motivo', () => {
    const summer = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 78.22, 15.65) // Longyearbyen
    expect(summer).toMatchObject({ sunrise: null, sunset: null, polar: 'day', daylightHours: 24 })
    const winter = sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), 78.22, 15.65)
    expect(winter).toMatchObject({ sunrise: null, sunset: null, polar: 'night', daylightHours: 0 })
  })
})

describe('Luna', () => {
  it('luna llena del 5 de noviembre de 2025 (13:19 UTC) y nueva del 20 de noviembre de 2025 (06:47 UTC)', () => {
    const full = moonInfo(new Date(Date.UTC(2025, 10, 5, 13, 19)))
    expect(full.name).toBe('full')
    expect(full.illumination).toBeGreaterThan(0.97)
    const nw = moonInfo(new Date(Date.UTC(2025, 10, 20, 6, 47)))
    expect(nw.name).toBe('new')
    expect(nw.illumination).toBeLessThan(0.03)
  })

  it('próximas fases dentro del mes sinódico', () => {
    const now = new Date(Date.UTC(2026, 10, 16))
    const m = moonInfo(now)
    for (const d of [m.nextFull, m.nextNew]) {
      expect(d.getTime()).toBeGreaterThan(now.getTime())
      expect(d.getTime() - now.getTime()).toBeLessThanOrEqual(29.6 * 86_400_000)
    }
  })
})
