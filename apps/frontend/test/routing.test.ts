import { describe, expect, it } from 'vitest'
import { brouterUrl, lineLengthM, parseBrouterGeoJson, parseMode, parsePoint } from '../server/utils/routing'

describe('rutas: validación de parámetros', () => {
  it('acepta lat,lon válidos y rechaza el resto', () => {
    expect(parsePoint('40.4168901,-3.7038506')).toEqual({ lat: 40.4168901, lon: -3.7038506 })
    expect(parsePoint(' 40.4168 , -3.7038 ')).toEqual({ lat: 40.4168, lon: -3.7038 })
    for (const bad of ['', '91,0', '0,181', 'abc', '40.4;-3.7', '1e3,2', '40.1234567890,1', undefined, 5]) expect(parsePoint(bad), String(bad)).toBeNull()
  })
  it('solo modos conocidos', () => {
    expect(parseMode('foot')).toBe('foot')
    expect(parseMode('car')).toBe('car')
    expect(parseMode('plane')).toBeNull()
  })
  it('URL de BRouter en orden lon,lat con el perfil del modo', () => {
    const u = brouterUrl({ lat: 40.4, lon: -3.7 }, { lat: 40.41, lon: -3.69 }, 'foot', 'geojson', 'http://127.0.0.1:17777')
    expect(u).toBe('http://127.0.0.1:17777/brouter?lonlats=-3.700000,40.400000|-3.690000,40.410000&profile=hiking-mountain&alternativeidx=0&format=geojson')
  })
})

describe('rutas: respuesta de BRouter', () => {
  const coords = [
    [-3.7, 40.4, 10],
    [-3.69, 40.4, 15],
    [-3.69, 40.41, 30],
  ]
  it('usa las propiedades de BRouter', () => {
    const r = parseBrouterGeoJson({ features: [{ geometry: { type: 'LineString', coordinates: coords }, properties: { 'track-length': '2004', 'total-time': '1500', 'filtered ascend': '18' } }] }, 'foot')
    expect(r).toMatchObject({ mode: 'foot', profile: 'hiking-mountain', distanceM: 2004, timeS: 1500, ascentM: 18 })
    expect(r.coordinates).toHaveLength(3)
  })
  it('sin propiedades: distancia de la geometría y el resto null (no se inventa)', () => {
    const r = parseBrouterGeoJson({ features: [{ geometry: { type: 'LineString', coordinates: coords }, properties: {} }] }, 'car')
    expect(r.distanceM).toBeGreaterThan(1900)
    expect(r.distanceM).toBeLessThan(2100)
    expect(r.timeS).toBeNull()
    expect(r.ascentM).toBeNull()
  })
  it('rechaza respuestas sin ruta', () => {
    expect(() => parseBrouterGeoJson({ features: [] }, 'foot')).toThrow()
    expect(() => parseBrouterGeoJson({ features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] }, 'foot')).toThrow()
  })
  it('longitud geodésica razonable', () => {
    expect(lineLengthM([[0, 0], [0, 1]])).toBeCloseTo(111195, -2)
  })
})
