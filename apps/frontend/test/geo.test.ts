import { describe, expect, it } from 'vitest'
import { formatArea, pathLengthM, polygonAreaM2, type LonLat } from '../app/utils/geo'

describe('medición en el mapa', () => {
  it('longitud de un trazado: suma de tramos', () => {
    // 1° de latitud ≈ 111,19 km con el radio medio.
    expect(pathLengthM([[0, 0], [0, 1]])).toBeCloseTo(111_195, -1)
    expect(pathLengthM([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(2 * 111_195, -1)
    expect(pathLengthM([[0, 0]])).toBe(0)
    expect(pathLengthM([])).toBe(0)
  })

  it('área de un cuadrado de 1 km junto a Madrid (≈ 1 km²) e independiente del sentido', () => {
    const lat = 40.4
    const dLat = 1000 / 111_195
    const dLon = 1000 / (111_195 * Math.cos((lat * Math.PI) / 180))
    const sq: LonLat[] = [[-3.7, lat], [-3.7 + dLon, lat], [-3.7 + dLon, lat + dLat], [-3.7, lat + dLat]]
    expect(polygonAreaM2(sq) / 1e6).toBeCloseTo(1, 2)
    expect(polygonAreaM2([...sq].reverse())).toBeCloseTo(polygonAreaM2(sq), 3)
    expect(polygonAreaM2(sq.slice(0, 2))).toBe(0)
  })

  it('formatea m², ha y km²', () => {
    expect(formatArea(850.4, 'es-ES')).toBe('850 m²')
    expect(formatArea(24_000, 'es-ES')).toBe('2,4 ha')
    expect(formatArea(13_500_000, 'es-ES')).toBe('13,5 km²')
    expect(formatArea(24_000, 'en-GB')).toBe('2.4 ha')
  })
})
