import { describe, expect, it } from 'vitest'
import type { VaultFile } from '@survival-os/shared-types'
import { addTags, extBadge, filterFiles, kindCounts, reviewState, sortFiles, splitName, tagsInUse, vaultKind } from '../app/utils/vault-browser'

const file = (name: string, mime: string, sizeBytes: number, addedAt: string, tags: string[] = []): VaultFile => ({
  id: name, name, mime, sizeBytes, sha256: '', tags, reviewDate: null, addedAt,
})
const files = [
  file('Pasaporte.jpg', 'image/jpeg', 2_000_000, '2026-11-01T10:00:00Z', ['viaje', 'identidad']),
  file('Seguro médico.pdf', 'application/pdf', 300_000, '2026-11-10T10:00:00Z', ['salud']),
  file('notas.txt', 'text/plain', 1_000, '2026-10-01T10:00:00Z'),
  file('copia.zip', 'application/zip', 9_000_000, '2026-11-05T10:00:00Z', ['viaje']),
  file('DNI 10.png', 'image/png', 500_000, '2026-11-12T10:00:00Z', ['identidad']),
  file('DNI 9.png', 'image/png', 500_000, '2026-11-11T10:00:00Z', ['identidad']),
]

describe('explorador de la bóveda', () => {
  it('clasifica por tipo y cuenta cada tipo', () => {
    expect(vaultKind('image/webp')).toBe('image')
    expect(vaultKind('application/pdf')).toBe('pdf')
    expect(vaultKind('text/markdown')).toBe('text')
    expect(vaultKind('application/zip')).toBe('other')
    expect(kindCounts(files)).toEqual({ all: 6, image: 3, pdf: 1, text: 1, other: 1 })
  })

  it('busca en nombre y etiquetas sin distinguir tildes ni mayúsculas, con todas las palabras', () => {
    expect(filterFiles(files, { query: 'medico' }).map((f) => f.name)).toEqual(['Seguro médico.pdf'])
    expect(filterFiles(files, { query: 'VIAJE' }).map((f) => f.name)).toEqual(['Pasaporte.jpg', 'copia.zip'])
    expect(filterFiles(files, { query: 'viaje pasa' }).map((f) => f.name)).toEqual(['Pasaporte.jpg'])
    expect(filterFiles(files, { kind: 'image', tag: 'viaje' }).map((f) => f.name)).toEqual(['Pasaporte.jpg'])
    expect(filterFiles(files, { query: '  ', kind: 'all' })).toHaveLength(6)
  })

  it('ordena por recientes, nombre natural, tamaño y tipo', () => {
    expect(sortFiles(files, 'recent')[0]!.name).toBe('DNI 10.png')
    expect(sortFiles(files, 'name').map((f) => f.name).slice(0, 3)).toEqual(['copia.zip', 'DNI 9.png', 'DNI 10.png'])
    expect(sortFiles(files, 'size')[0]!.name).toBe('copia.zip')
    expect(sortFiles(files, 'type').map((f) => vaultKind(f.mime))).toEqual(['image', 'image', 'image', 'pdf', 'text', 'other'])
    expect(files[0]!.name).toBe('Pasaporte.jpg') // no altera la lista original
  })

  it('nombre y extensión', () => {
    expect(splitName('Seguro médico.pdf')).toEqual({ base: 'Seguro médico', ext: '.pdf' })
    expect(splitName('LEEME')).toEqual({ base: 'LEEME', ext: '' })
    expect(splitName('.oculto')).toEqual({ base: '.oculto', ext: '' })
    expect(extBadge('foto.jpeg')).toBe('JPEG')
    expect(extBadge('sin-extension')).toBe('')
  })

  it('etiquetas: sin repetir, recortadas y con el límite del servicio', () => {
    expect(addTags(['viaje'], ' salud , Viaje,,familia ')).toEqual(['viaje', 'salud', 'familia'])
    expect(addTags([], 'x'.repeat(40))[0]).toHaveLength(30)
    expect(addTags(Array.from({ length: 10 }, (_, i) => `t${i}`), 'otra')).toHaveLength(10)
    expect(tagsInUse(files)).toEqual(['identidad', 'viaje', 'salud'])
  })

  it('fecha de revisión: vencida, próxima (30 días) o más adelante', () => {
    const today = new Date(2026, 10, 18)
    expect(reviewState(null, today)).toBeNull()
    expect(reviewState('2026-11-17', today)).toBe('overdue')
    expect(reviewState('2026-11-18', today)).toBe('soon')
    expect(reviewState('2026-12-18', today)).toBe('soon')
    expect(reviewState('2026-12-19', today)).toBe('later')
  })
})
