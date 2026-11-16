import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ContentCatalogItem } from '@survival-os/shared-types'
import { FREE_MARGIN, autoFit, orderForInstall } from '../app/utils/content'
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
      expect(i.approxBytes, i.id).toBeGreaterThan(0)
      expect(i.license, i.id).toBeTruthy()
    }
  })
  it('español por defecto: lo que tiene equivalente en español no viene marcado', () => {
    for (const i of catalog.items) {
      expect(['es', 'en', 'mul'].includes(i.lang), i.id).toBe(true)
      if (i.equivalentOf) {
        expect(i.default, i.id).toBe(false)
        expect(ids).toContain(i.equivalentOf)
      }
    }
  })
  it('componentes fijados con SHA-256 para los cinco sistemas', () => {
    for (const [name, c] of Object.entries<{ assets: Record<string, { url: string; sha256: string }> }>(catalog.components)) {
      const keys = Object.keys(c.assets)
      if (keys.includes('any')) expect(keys, name).toEqual(['any'])
      else expect(keys.sort(), name).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win-x64'])
      for (const a of Object.values(c.assets)) {
        expect(a.url, name).toMatch(/^https:\/\//)
        expect(a.sha256, name).toMatch(/^[0-9a-f]{64}$/)
      }
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
