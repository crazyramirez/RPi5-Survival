import { describe, expect, it } from 'vitest'
import { validateManifestEntry } from '../src/index'

describe('validateManifestEntry', () => {
  const valid = {
    id: 'demo',
    kind: 'document' as const,
    title: 'Documento sintético',
    language: 'es',
    version: '1',
    source: 'data-samples (sintético)',
    retrievedAt: '2026-11-08',
    license: 'CC0-1.0',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    path: 'docs/demo.md',
  }

  it('acepta una entrada completa', () => {
    expect(validateManifestEntry(valid)).toEqual([])
  })

  it('exige licencia y checksum válido', () => {
    const problems = validateManifestEntry({ ...valid, license: '', sha256: 'xyz' })
    expect(problems).toContain('falta license')
    expect(problems).toContain('sha256 inválido')
  })

  it('rechaza rutas absolutas o con ..', () => {
    expect(validateManifestEntry({ ...valid, path: '/etc/passwd' })).toContain('path debe ser relativo y sin ".."')
    expect(validateManifestEntry({ ...valid, path: '../x' })).toContain('path debe ser relativo y sin ".."')
  })
})
