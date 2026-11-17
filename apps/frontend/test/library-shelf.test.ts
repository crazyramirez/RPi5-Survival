import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DocSummary, LibraryShelfMap, ZimBook } from '@survival-os/shared-types'
import { classifyBooks, groupBooks, groupManuals, groupOwnDocs, MANUAL_TOPICS, matches, splitDocs, zimBaseName } from '../app/utils/library-shelf'

const doc = (id: number, path: string, title = path, extra: Partial<DocSummary> = {}): DocSummary => ({
  id, path, title, kind: 'pdf', sizeBytes: 10, modifiedAt: '2026-01-01T00:00:00Z', searchable: true, ...extra,
})
const book = (id: string, title: string): ZimBook => ({
  id, name: id, title, description: '', language: 'spa', articleCount: null, flavour: '', icon: null, readerPath: `/kiwix/${id}`,
})
const map: LibraryShelfMap = {
  groups: [],
  zims: [{ id: 'wikipedia', name: 'wikipedia_es_all', group: 'saber', title: 'Wikipedia', description: '' }],
  manuals: [
    { id: 'single', topic: 'agua', title: 'Agua', description: '', publisher: 'OMS', lang: 'es', file: 'single.pdf', parts: null },
    { id: 'book', topic: 'medicina', title: 'Libro', description: '', publisher: null, lang: 'es', file: null, parts: [{ file: '01.pdf', title: 'Portada' }, { file: '02.pdf', title: '1 Capítulo' }] },
  ],
}

describe('biblioteca por categorías', () => {
  it('reconoce el ZIM por su nombre base y deja los ajenos en «otros»', () => {
    expect(zimBaseName('wikipedia_es_all_nopic_2026-01')).toBe('wikipedia_es_all')
    const shelf = classifyBooks([book('wikipedia_es_all_nopic_2026-01', 'Wikipedia'), book('mio_2026-01', 'Mío')], map)
    expect(shelf.map((b) => b.group)).toEqual(['saber', 'otros'])
    expect(groupBooks(shelf).map((g) => g.id)).toEqual(['saber', 'otros'])
  })

  it('agrupa los capítulos de un libro en una sola entrada, en orden', () => {
    const { manuals, own } = splitDocs([
      doc(1, 'manuales/book/02.pdf', 'Libro · 1 Capítulo'),
      doc(2, 'manuales/single.pdf'),
      doc(3, 'manuales/book/01.pdf', 'Libro · Portada'),
      doc(4, 'notas/receta.md'),
      doc(5, 'manuales/viejo.pdf', 'Viejo'),
    ], map)
    expect(own.map((d) => d.id)).toEqual([4])
    const lib = manuals.find((m) => m.id === 'book')!
    expect(lib.docs.map((d) => d.id)).toEqual([3, 1])
    expect(lib.chapterTitles).toEqual(['Portada', '1 Capítulo'])
    expect(lib.sizeBytes).toBe(20)
    expect(groupManuals(manuals).map((g) => g.id)).toEqual(['medicina', 'agua', 'otros'])
  })

  it('agrupa los documentos propios por carpeta, la raíz primero', () => {
    const folders = groupOwnDocs([doc(1, 'z/a.pdf'), doc(2, 'suelto.txt'), doc(3, 'b/c.md')], 'name')
    expect(folders.map((f) => f.id)).toEqual(['', 'b', 'z'])
  })

  it('filtra sin tildes ni mayúsculas', () => {
    expect(matches('organo', 'Órganos y salud')).toBe(true)
    expect(matches('agua lluvia', 'Captación de agua de lluvia')).toBe(true)
    expect(matches('fuego', 'Agua')).toBe(false)
  })

  it('cada manual del catálogo tiene un tema conocido', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../../content/catalog.json', import.meta.url), 'utf8')) as { items: { id: string; kind: string; topic?: string }[] }
    const bad = catalog.items.filter((i) => i.kind === 'doc' && !(MANUAL_TOPICS as readonly string[]).includes(i.topic ?? ''))
    expect(bad.map((i) => i.id)).toEqual([])
  })
})
