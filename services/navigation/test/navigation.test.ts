import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { NavFix } from '@survival-os/shared-types'
import { haversineM, isValidLatLon, pathLengthM } from '../src/geo.ts'
import { applyMessage, emptyState, MIN_SPEED_FOR_COURSE, toFix } from '../src/gpsd.ts'
import { parseGpx, trackToGpx, waypointsToGpx } from '../src/gpx.ts'
import { DEFAULT_POLICY, shouldRecord } from '../src/recorder.ts'
import { NavStore } from '../src/store.ts'

// Mensajes con el formato del protocolo JSON de gpsd 3.2x.
const TPV_3D = {
  class: 'TPV', device: '/dev/ttyACM0', mode: 3, time: '2026-11-08T17:00:00.000Z',
  lat: 40.416775, lon: -3.70379, altMSL: 657.2, alt: 708.1, epx: 3.1, epy: 4.2, speed: 2.5, track: 87.3,
}
const SKY = { class: 'SKY', device: '/dev/ttyACM0', nSat: 14, uSat: 9, satellites: [] }

describe('gpsd → NavFix', () => {
  it('sin TPV no hay fix (no se inventa)', () => {
    expect(toFix(emptyState())).toBeNull()
  })

  it('fix 3D completo', () => {
    const s = emptyState()
    applyMessage(s, { class: 'DEVICES', devices: [{ path: '/dev/ttyACM0' }] }, 1000)
    applyMessage(s, SKY, 1000)
    applyMessage(s, TPV_3D, 1000)
    const f = toFix(s, 3000)
    expect(s.devices).toEqual(['/dev/ttyACM0'])
    expect(f).toMatchObject({ fix: '3d', latitude: 40.416775, longitude: -3.70379, altitudeM: 657.2, satellitesUsed: 9, satellitesVisible: 14, courseDeg: 87.3, ageSeconds: 2 })
    expect(f?.horizontalErrorM).toBeCloseTo(5.2, 1)
  })

  it('sin fijación (mode 1): sin coordenadas aunque gpsd envíe lat/lon antiguas', () => {
    const s = emptyState()
    applyMessage(s, { ...TPV_3D, mode: 1 })
    const f = toFix(s)
    expect(f?.fix).toBe('none')
    expect(f?.latitude).toBeNull()
    expect(f?.courseDeg).toBeNull()
  })

  it('parado: sin rumbo (el GPS no es una brújula)', () => {
    const s = emptyState()
    applyMessage(s, { ...TPV_3D, speed: MIN_SPEED_FOR_COURSE / 2 })
    expect(toFix(s)?.courseDeg).toBeNull()
  })

  it('2D: sin altitud', () => {
    const s = emptyState()
    applyMessage(s, { ...TPV_3D, mode: 2 })
    expect(toFix(s)?.altitudeM).toBeNull()
  })

  it('dispositivo desconectado', () => {
    const s = emptyState()
    applyMessage(s, { class: 'DEVICE', path: '/dev/ttyACM0', activated: '2026-01-01' })
    applyMessage(s, { class: 'DEVICE', path: '/dev/ttyACM0', activated: 0 })
    expect(s.devices).toEqual([])
  })
})

describe('geo', () => {
  it('haversine Madrid–Barcelona ≈ 505 km', () => {
    expect(haversineM(40.4168, -3.7038, 41.3874, 2.1686) / 1000).toBeCloseTo(505, -1)
  })
  it('validación', () => {
    expect(isValidLatLon(91, 0)).toBe(false)
    expect(isValidLatLon(0, 181)).toBe(false)
    expect(isValidLatLon('1', 0)).toBe(false)
    expect(isValidLatLon(40, -3)).toBe(true)
  })
  it('longitud de ruta', () => {
    expect(pathLengthM([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0, lon: 0.002 }])).toBeCloseTo(222.4, 0)
  })
})

describe('GPX', () => {
  it('ida y vuelta de track y waypoints', () => {
    const pts = [
      { lat: 40.1, lon: -3.1, ele: 650, time: '2026-11-08T10:00:00Z' },
      { lat: 40.2, lon: -3.2, ele: null, time: null },
    ]
    const back = parseGpx(trackToGpx('Ruta <prueba>', pts))
    expect(back.tracks[0]?.name).toBe('Ruta <prueba>')
    expect(back.tracks[0]?.points).toEqual(pts)
    const wps = parseGpx(
      waypointsToGpx([{ id: '1', name: 'Fuente & río', kind: 'agua', latitude: 40.5, longitude: -3.5, note: 'n', origin: 'usuario', createdAt: '2026-11-08T00:00:00Z' }]),
    )
    expect(wps.waypoints[0]).toEqual({ name: 'Fuente & río', lat: 40.5, lon: -3.5, note: 'n' })
  })
  it('rechaza coordenadas inválidas y no ejecuta nada', () => {
    const r = parseGpx('<gpx><wpt lat="999" lon="0"><name>x</name></wpt><wpt lat="1" lon="2"/><trk><trkseg><trkpt lat="a" lon="b"/></trkseg></trk></gpx>')
    expect(r.waypoints).toHaveLength(1)
    expect(r.rejected).toBe(2)
    expect(r.tracks).toHaveLength(0)
  })
})

describe('política de grabación', () => {
  const fix = (lat: number, lon: number, extra: Partial<NavFix> = {}): NavFix => ({
    fix: '3d', latitude: lat, longitude: lon, altitudeM: null, speedMs: 1, courseDeg: null, horizontalErrorM: 5,
    satellitesUsed: 8, satellitesVisible: 12, time: null, ageSeconds: 0, ...extra,
  })
  it('primer punto se graba; repeticiones cercanas o rápidas no', () => {
    const first = shouldRecord(fix(40, -3), null, 0, DEFAULT_POLICY)
    expect(first.record).toBe(true)
    const last = { point: first.point!, at: 0 }
    expect(shouldRecord(fix(40.00001, -3), last, 60_000, DEFAULT_POLICY).record).toBe(false) // ~1 m
    expect(shouldRecord(fix(40.001, -3), last, 2_000, DEFAULT_POLICY).record).toBe(false) // demasiado pronto
    const ok = shouldRecord(fix(40.001, -3), last, 20_000, DEFAULT_POLICY)
    expect(ok.record).toBe(true)
    expect(ok.distanceM).toBeCloseTo(111, 0)
  })
  it('descarta sin fijación, datos viejos o imprecisos', () => {
    expect(shouldRecord(fix(40, -3, { fix: 'none' }), null, 0, DEFAULT_POLICY).record).toBe(false)
    expect(shouldRecord(fix(40, -3, { ageSeconds: 30 }), null, 0, DEFAULT_POLICY).record).toBe(false)
    expect(shouldRecord(fix(40, -3, { horizontalErrorM: 200 }), null, 0, DEFAULT_POLICY).record).toBe(false)
  })
})

describe('NavStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nav-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('waypoints: alta, validación, baja', async () => {
    const s = new NavStore(dir)
    await s.init()
    const w = await s.addWaypoint({ name: 'Fuente', kind: 'agua', latitude: 40.123456789, longitude: -3.5, origin: 'usuario' })
    expect(w.latitude).toBe(40.1234568)
    await expect(s.addWaypoint({ name: 'x', kind: 'agua', latitude: 100, longitude: 0, origin: 'usuario' })).rejects.toThrow()
    const odd = await s.addWaypoint({ name: '', kind: 'malicioso', latitude: 1, longitude: 1, origin: 'usuario' })
    expect(odd).toMatchObject({ name: 'Punto', kind: 'personal' })
    expect(await s.listWaypoints()).toHaveLength(2)
    expect(await s.deleteWaypoint(w.id)).toBe(true)
    expect(await s.listWaypoints()).toHaveLength(1)
  })

  it('tracks: crear, añadir, cerrar, leer; ids peligrosos rechazados', async () => {
    const s = new NavStore(dir)
    await s.init()
    const t = await s.createTrack('Prueba', 'gnss')
    await s.appendPoints(t, [{ lat: 1, lon: 1, ele: null, time: null }], 0)
    await s.appendPoints(t, [{ lat: 1.001, lon: 1, ele: null, time: null }], 111)
    await s.finishTrack(t)
    const back = await s.getTrack(t.id)
    expect(back).toMatchObject({ points: 2, distanceM: 111, name: 'Prueba' })
    expect(back?.endedAt).not.toBeNull()
    expect(await s.trackPoints(t.id)).toHaveLength(2)
    await expect(s.getTrack('../../etc/passwd')).rejects.toThrow()
    await s.deleteTrack(t.id)
    expect(await s.listTracks()).toHaveLength(0)
  })
})
