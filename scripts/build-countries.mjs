#!/usr/bin/env node
/**
 * Genera content/countries.json: países y territorios para el buscador de mapas offline (ADR 0018).
 *   - Natural Earth 1:50m «admin 0 countries» (dominio público): nombre en es/en/fr/it, código ISO y zonas.
 *     Un país con partes separadas (España y Canarias, EE. UU. y Alaska) se divide en varias zonas
 *     rectangulares para no descargar mar ni países vecinos. Las zonas a más de 20° de la principal
 *     (territorios de ultramar) se marcan `far` y no se descargan con el país.
 *   - Zonas horarias de IANA (zone.tab, dominio público): zona → país, para proponer el país sin Internet.
 * Se ejecuta a mano cuando cambien los datos:  node scripts/build-countries.mjs
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
const TZ = 'https://raw.githubusercontent.com/eggert/tz/main/zone.tab'
const OUT = join(import.meta.dirname, '..', 'content', 'countries.json')

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'survival-os-build' } })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r
}

/** Área aproximada (km²) de un anillo lon/lat: fórmula del área sobre la esfera. */
function ringArea(ring) {
  const R = 6371
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    s += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180))
  }
  return Math.abs((s * R * R) / 2)
}

function bboxOf(ring) {
  let w = 180, s = 90, e = -180, n = -90
  for (const [x, y] of ring) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y)
  }
  return [w, s, e, n]
}

const gap = (a, b) => Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]), Math.max(a[1], b[1]) - Math.min(a[3], b[3]))
const merge = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]

/** Agrupa las partes cercanas (< 2,5°), descarta islotes (< 500 km²) y marca las zonas lejanas. */
function zones(polys) {
  const total = polys.reduce((n, p) => n + p.area, 0)
  let groups = polys.sort((a, b) => b.area - a.area).map((p) => ({ bbox: p.bbox, area: p.area }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < groups.length && !changed; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (gap(groups[i].bbox, groups[j].bbox) < 2.5) {
          groups[i] = { bbox: merge(groups[i].bbox, groups[j].bbox), area: groups[i].area + groups[j].area }
          groups.splice(j, 1)
          changed = true
          break
        }
      }
    }
  }
  groups = groups.filter((g, i) => i === 0 || g.area >= 500)
  void total
  const pad = 0.05
  const main = groups[0]?.bbox
  return groups.map((g, i) => ({
    ...(i > 0 && main && gap(main, g.bbox) > 20 ? { far: true } : {}),
    bbox: [g.bbox[0] - pad, g.bbox[1] - pad, g.bbox[2] + pad, g.bbox[3] + pad].map((v, k) => Math.round(Math.max(k % 2 ? -85 : -180, Math.min(k % 2 ? 85 : 180, v)) * 100) / 100),
    areaKm2: Math.round(g.area),
  }))
}

const geo = await (await get(NE)).json()
const countries = []
for (const f of geo.features) {
  const p = f.properties
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => ({ bbox: bboxOf(poly[0]), area: ringArea(poly[0]) }))
  const iso2 = [p.ISO_A2_EH, p.ISO_A2].find((c) => /^[A-Z]{2}$/.test(c ?? '')) ?? null
  const id = String(p.ADM0_A3 || p.SOV_A3 || '').toLowerCase()
  if (!/^[a-z]{3}$/.test(id)) continue
  const name = (k) => String(p[k] || p.NAME_EN || p.NAME).trim()
  countries.push({
    id,
    iso2,
    names: { es: name('NAME_ES'), en: name('NAME_EN'), fr: name('NAME_FR'), it: name('NAME_IT'), de: name('NAME_DE'), zh: name('NAME_ZH'), ja: name('NAME_JA') },
    zones: zones(polys),
  })
}
countries.sort((a, b) => a.names.es.localeCompare(b.names.es, 'es'))

const tz = {}
for (const line of (await (await get(TZ)).text()).split('\n')) {
  if (!line || line.startsWith('#')) continue
  const [cc, , zone] = line.split('\t')
  if (cc && zone) tz[zone] = cc
}

writeFileSync(OUT, `${JSON.stringify({
  source: 'Natural Earth 1:50m admin 0 countries (dominio público) · IANA zone.tab (dominio público)',
  generated: new Date().toISOString().slice(0, 10),
  countries,
  timezones: tz,
})}\n`)
console.log(`${countries.length} países/territorios, ${Object.keys(tz).length} zonas horarias → ${OUT}`)
