import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countryLand, countryMaxZoom, countryZones, estimateMapBytes, routingTiles } from '../../../scripts/country-maps.mjs'
import { expandCountry, loadCatalog } from '../../../scripts/content-engine.mjs'

const data = JSON.parse(readFileSync(new URL('../../../content/countries.json', import.meta.url), 'utf8'))
const byId = (id: string) => data.countries.find((c: { id: string }) => c.id === id)

describe('países para mapas offline (ADR 0018)', () => {
  it('más de 200 países con nombre en los cuatro idiomas y zonas válidas', () => {
    expect(data.countries.length).toBeGreaterThan(200)
    for (const c of data.countries) {
      for (const l of ['es', 'en', 'fr', 'it']) expect(c.names[l], `${c.id} ${l}`).toBeTruthy()
      expect(c.zones.length, c.id).toBeGreaterThan(0)
      for (const z of c.zones) {
        const [w, s, e, n] = z.bbox
        expect(w < e && s < n, c.id).toBe(true)
      }
    }
  })
  it('España: península + Canarias (sin mar entre medias); Francia sin ultramar', () => {
    expect(countryZones(byId('esp')).length).toBe(2)
    const fra = countryZones(byId('fra'))
    expect(fra.length).toBe(1)
    expect(fra[0].bbox[0]).toBeGreaterThan(-6) // la Guayana Francesa (-54°) queda fuera
  })
  it('tamaño estimado calibrado con la extracción real de España (3,4 GB a z15)', () => {
    const esp = byId('esp')
    const main = countryZones(esp)[0]
    expect(countryMaxZoom(countryLand(esp))).toBe(15)
    const est = estimateMapBytes(main.areaKm2, 15)
    expect(est).toBeGreaterThan(2.5e9)
    expect(est).toBeLessThan(4.5e9)
  })
  it('países enormes con menos zoom para que quepan', () => {
    expect(countryMaxZoom(countryLand(byId('rus')))).toBeLessThan(14)
  })
  it('cuadrículas BRouter de España iguales a las del catálogo', () => {
    const tiles = routingTiles(byId('esp'))
    for (const t of ['W10_N35', 'W10_N40', 'W5_N35', 'W5_N40', 'E0_N35', 'E0_N40', 'W20_N25', 'W15_N25']) expect(tiles).toContain(t)
  })
  it('el motor expande «mapa-pais:ita» y «rutas-pais:ita»', () => {
    const cat = loadCatalog()
    const map = expandCountry(cat.items.find((i: { id: string }) => i.id === 'mapa-pais'), 'ita', data.countries)
    expect(map.id).toBe('mapa-pais:ita')
    expect(map.maps.zones[0].region).toBe('pais-ita')
    expect(map.approxBytes).toBeGreaterThan(1e9)
    const routes = expandCountry(cat.items.find((i: { id: string }) => i.id === 'rutas-pais'), 'ita', data.countries)
    expect(routes.routing.tiles.length).toBeGreaterThan(3)
    expect(expandCountry(cat.items.find((i: { id: string }) => i.id === 'mapa-pais'), 'zzz', data.countries)).toBeNull()
  })
})
