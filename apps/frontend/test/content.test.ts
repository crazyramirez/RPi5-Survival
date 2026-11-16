import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ContentCatalogItem } from '@survival-os/shared-types'
import { FREE_MARGIN, autoFit, downloadPlan, orderForInstall, orderPlan, type ContentLang } from '../app/utils/content'
// @ts-expect-error módulo .mjs sin tipos
import { platformKey, profilePaths } from '../../../scripts/content-engine.mjs'

const GB = 1024 ** 3
const catalog = JSON.parse(readFileSync(new URL('../../../content/catalog.json', import.meta.url), 'utf8'))
const item = (id: string, priority: 1 | 2 | 3, gb: number): ContentCatalogItem => ({
  id, kind: 'zim', group: 'g', lang: 'es', priority, default: true, approxBytes: gb * GB, license: '', title: id, description: '', equivalentOf: null, variants: null,
})

describe('ajuste al espacio libre', () => {
  it('si cabe todo, no desmarca nada', () => {
    expect(autoFit([item('a', 1, 1), item('b', 3, 1)], 10 * GB).dropped).toHaveLength(0)
  })
  it('desmarca primero la prioridad 3 y lo más grande', () => {
    const r = autoFit([item('esencial', 1, 3), item('extra-grande', 3, 8), item('extra', 3, 1), item('reco', 2, 2)], 8 * GB)
    expect(r.dropped.map((i) => i.id)).toEqual(['extra-grande'])
    expect(r.keep.reduce((n, i) => n + i.approxBytes, 0) + FREE_MARGIN).toBeLessThanOrEqual(8 * GB)
  })
  it('nunca desmarca lo imprescindible', () => {
    const r = autoFit([item('esencial', 1, 50), item('reco', 2, 1)], 10 * GB)
    expect(r.keep.map((i) => i.id)).toEqual(['esencial'])
  })
  it('sin dato de espacio no toca la selección', () => {
    expect(autoFit([item('a', 3, 100)], null).dropped).toHaveLength(0)
  })
  it('descarga primero lo imprescindible y lo pequeño', () => {
    expect(orderForInstall([item('c', 2, 1), item('a', 1, 5), item('b', 1, 1)]).map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('catálogo de descargas (content/catalog.json)', () => {
  const ids = catalog.items.map((i: { id: string }) => i.id)
  it('ids únicos y aceptados por el validador de la API', () => {
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/)
  })
  it('cada elemento pertenece a un grupo y tiene tamaño y licencia', () => {
    const groups = new Set(catalog.groups.map((g: { id: string }) => g.id))
    for (const i of catalog.items) {
      expect(groups.has(i.group), i.id).toBe(true)
      // Las plantillas de país no tienen tamaño propio (depende del país elegido).
      if (!i.template) expect(i.approxBytes, i.id).toBeGreaterThan(0)
      expect(i.license, i.id).toBeTruthy()
    }
  })
  it('idiomas (ADR 0018): equivalentes que apuntan a un tema existente, uno por idioma', () => {
    const seen = new Set<string>()
    for (const i of catalog.items) {
      expect(['es', 'en', 'fr', 'it', 'mul'].includes(i.lang), i.id).toBe(true)
      if (i.equivalentOf) {
        expect(ids).toContain(i.equivalentOf)
        const key = `${i.equivalentOf}/${i.lang}`
        expect(seen.has(key), key).toBe(false)
        seen.add(key)
      }
    }
  })
  it('componentes fijados con SHA-256 para los cinco sistemas', () => {
    for (const [name, c] of Object.entries<{ assets: Record<string, { url: string; sha256: string }>; optional?: boolean }>(catalog.components)) {
      const keys = Object.keys(c.assets)
      if (keys.includes('any')) expect(keys, name).toEqual(['any'])
      // Los opcionales (p. ej. pdftotext de Xpdf) pueden no existir para algún sistema: se usa el del sistema.
      else if (c.optional) expect(keys.length, name).toBeGreaterThan(0)
      else expect(keys.sort(), name).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win-x64'])
      for (const a of Object.values(c.assets)) {
        expect(a.url, name).toMatch(/^https:\/\//)
        expect(a.sha256, name).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })
  it('manuales PDF con URL https, SHA-256 fijado, tamaño y nombre de fichero seguro', () => {
    for (const i of catalog.items.filter((x: { kind: string }) => x.kind === 'doc')) {
      // Un PDF o un libro por capítulos: cada fichero con URL https, SHA-256, tamaño y nombre seguro.
      const files = i.doc.parts ?? [i.doc]
      expect(files.length, i.id).toBeGreaterThan(0)
      for (const f of files) {
        expect(f.url, i.id).toMatch(/^https:\/\//)
        expect(f.sha256, i.id).toMatch(/^[0-9a-f]{64}$/)
        expect(f.bytes, i.id).toBeGreaterThan(0)
        expect(f.file, i.id).toMatch(/^[a-z0-9-]{1,90}\.pdf$/)
      }
      expect(i.group, i.id).toBe('manuales')
    }
  })
  it('modelos del asistente con SHA-256 y el elemento llm apunta a uno existente', () => {
    for (const m of Object.values<{ sha256: string }>(catalog.models)) expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
    for (const i of catalog.items.filter((x: { kind: string }) => x.kind === 'llm')) expect(catalog.models[i.llm.model]).toBeTruthy()
  })
})

describe('motor: plataforma y rutas', () => {
  it('detecta el sistema', () => {
    expect(platformKey('win32', 'x64')).toBe('win-x64')
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('linux', 'ia32')).toBeNull()
  })
  it('perfil Pi en /var/lib/survival-os; portable dentro de data/', () => {
    expect(profilePaths('pi', '/x').zimDir).toBe('/var/lib/survival-os/library/zim')
    // Misma estructura que la Pi: el servicio de biblioteca busca en <datos>/library/zim.
    expect(profilePaths('portable', '/r').zimDir).toMatch(/[\\/]r[\\/]data[\\/]library[\\/]zim$/)
  })
})

describe('plan de descarga por idioma y país (ADR 0018)', () => {
  const items = catalog.items.filter((i: { template?: string }) => !i.template) as ContentCatalogItem[]
  const plan = (ui: ContentLang, country: { id: string; name: string; mapBytes: number; routingBytes: number } | null, mode: 'recommended' | 'all' = 'recommended') =>
    downloadPlan(items, new Set(), ui, country, mode).map((i) => i.id)
  const esp = { id: 'esp', name: 'España', mapBytes: 1, routingBytes: 1 }
  const fra = { id: 'fra', name: 'Francia', mapBytes: 9e9, routingBytes: 2e9 }

  it('español: Wikipedia en español, no sus equivalentes; mapas propios de España', () => {
    const p = plan('es', esp)
    expect(p).toContain('wikipedia')
    expect(p).not.toContain('wikipedia-en')
    expect(p).not.toContain('wikipedia-fr')
    expect(p).toContain('mapa-espana')
    expect(p).toContain('mapa-canarias')
    expect(p.some((id) => id.startsWith('mapa-pais:'))).toBe(false)
  })
  it('francés en Francia: Wikipedia en francés, lo que no existe en francés en inglés, mapa de Francia', () => {
    const p = plan('fr', fra)
    expect(p).toContain('wikipedia-fr')
    expect(p).not.toContain('wikipedia')
    expect(p).toContain('medlineplus-en') // no hay MedlinePlus en francés
    expect(p).toContain('mapa-pais:fra')
    expect(p).toContain('rutas-pais:fra')
    expect(p).not.toContain('mapa-espana')
    expect(p).toContain('mapa-mundo')
  })
  it('nunca contenidos en un idioma que el usuario no ha elegido (salvo inglés)', () => {
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const ui of ['en', 'fr', 'it'] as const) {
      for (const id of plan(ui, null, 'all')) {
        const it = byId.get(id)
        if (it && !['maps', 'routing', 'llm'].includes(it.kind)) expect([ui, 'en', 'mul'], `${ui}: ${id}`).toContain(it.lang)
      }
    }
  })
  it('«Descargarlo todo» incluye todos los modelos y deja el recomendado el último (queda activo)', () => {
    const all = downloadPlan(items, new Set(), 'es', esp, 'all')
    const llm = all.filter((i) => i.kind === 'llm').map((i) => i.id)
    expect(llm.length).toBeGreaterThanOrEqual(3)
    const ordered = orderPlan(all).map((i) => i.id)
    expect(ordered[ordered.length - 1]).toBe('asistente')
    // Los juegos también entran en «Descargarlo todo» (en cualquier idioma).
    expect(all.map((i) => i.id)).toContain('juegos')
    expect(downloadPlan(items, new Set(), 'fr', null, 'all').map((i) => i.id)).toContain('juegos')
  })
  it('lo instalado no se vuelve a pedir', () => {
    const p = downloadPlan(items, new Set(['wikipedia', 'mapa-espana']), 'es', esp, 'all').map((i) => i.id)
    expect(p).not.toContain('wikipedia')
    expect(p).not.toContain('mapa-espana')
  })
})
