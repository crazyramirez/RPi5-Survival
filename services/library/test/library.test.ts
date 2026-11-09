import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LibraryDb, toFtsQuery } from '../src/db.ts'
import { indexDocs, titleFor } from '../src/indexer.ts'
import { parseCatalog, parseSearchRss, rankZimHits } from '../src/kiwix.ts'
import { escapeHtml, htmlToText, parseFrontMatter, renderMarkdown } from '../src/markdown.ts'
import { loadProtocols } from '../src/protocols.ts'

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const fixture = (p: string): string => readFileSync(here(`./fixtures/${p}`), 'utf8')

describe('renderMarkdown (seguro)', () => {
  it('escapa HTML incrustado', () => {
    const html = renderMarkdown('Hola <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('descarta enlaces javascript: y data:', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href')
    expect(renderMarkdown('[x](data:text/html,hi)')).not.toContain('href')
    expect(renderMarkdown('[ok](/emergencias/rcp)')).toContain('href="/emergencias/rcp"')
  })
  it('estructura: encabezados, listas, cita, negrita', () => {
    const html = renderMarkdown('# T\n\n## Pasos\n1. Uno\n2. **Dos**\n\n- a\n- b\n\n> Aviso')
    expect(html).toContain('<h2>T</h2>')
    expect(html).toContain('<h3>Pasos</h3>')
    expect(html).toContain('<ol><li>Uno</li><li><strong>Dos</strong></li></ol>')
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(html).toContain('<blockquote>Aviso</blockquote>')
  })
  it('escapeHtml y htmlToText', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    expect(htmlToText('<p>Hola</p><script>mal()</script><p>mundo &amp; más</p>')).toBe('Hola\nmundo & más')
  })
  it('front matter', () => {
    const { meta, body } = parseFrontMatter('---\nid: x\ntitle: Un: título\n---\nCuerpo')
    expect(meta).toEqual({ id: 'x', title: 'Un: título' })
    expect(body).toBe('Cuerpo')
  })
})

describe('protocolos incluidos', () => {
  it('todos tienen id, título, categoría, fecha de revisión y fuentes', async () => {
    const { protocols, errors } = await loadProtocols(here('../../../content/protocols'))
    expect(errors).toEqual([])
    expect(protocols.length).toBeGreaterThanOrEqual(8)
    for (const p of protocols) {
      expect(p.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.sources.length).toBeGreaterThan(10)
      expect(p.html).toContain('<blockquote>') // aviso de carácter orientativo
    }
    expect(new Set(protocols.map((p) => p.id)).size).toBe(protocols.length)
  })
})

describe('índice FTS5', () => {
  it('toFtsQuery neutraliza operadores', () => {
    expect(toFtsQuery('agua pot')).toBe('"agua" "pot"*')
    expect(toFtsQuery('a" OR 1=1 --')).toBe('"a" "OR" "1" "1"')
    expect(toFtsQuery('  ¿?  ')).toBeNull()
  })

  it('indexa md/txt/html, busca sin acentos, actualiza y elimina', async () => {
    const db = new LibraryDb(':memory:')
    const r1 = await indexDocs(db, here('./fixtures/docs'), 1e6)
    expect(r1.added).toBe(3)
    expect(db.searchDocs('carbon', 5)[0]?.title).toBe('Filtro de agua casero')
    expect(db.searchDocs('guia', 5)[0]?.title).toBe('nudos')
    const senales = db.searchDocs('triangulo', 5)[0]
    expect(senales?.title).toBe('Señales de socorro')
    expect(db.searchDocs('alert', 5)).toEqual([]) // el <script> no se indexa
    const r2 = await indexDocs(db, here('./fixtures/docs'), 1e6)
    expect(r2.added + r2.updated).toBe(0) // incremental
    db.close()
  })

  it('favoritos', () => {
    const db = new LibraryDb(':memory:')
    db.putFavorite({ id: 'protocol:rcp', title: 'RCP', href: '/emergencias/rcp-adulto' })
    expect(db.listFavorites()).toHaveLength(1)
    db.deleteFavorite('protocol:rcp')
    expect(db.listFavorites()).toHaveLength(0)
    db.close()
  })

  it('titleFor', () => {
    expect(titleFor('md', '---\ntitle: Desde meta\n---\n# H', 'x.md')).toBe('Desde meta')
    expect(titleFor('txt', '', '/d/guia_de-campo.txt')).toBe('guia de campo')
  })
})

describe('kiwix-serve', () => {
  it('catálogo OPDS', () => {
    const books = parseCatalog(fixture('catalog.xml'), '/kiwix')
    expect(books).toEqual([
      {
        id: 'wikipedia_es_medicine_nopic_2026-10',
        name: 'wikipedia_es_medicine',
        title: 'Wikipedia Médica',
        description: 'Artículos de medicina',
        language: 'spa',
        articleCount: 6789,
        flavour: 'nopic',
        icon: '/kiwix/catalog/v2/illustration/1/?size=48',
        readerPath: '/kiwix/viewer#wikipedia_es_medicine_nopic_2026-10',
      },
    ])
  })
  it('resultados de búsqueda RSS', () => {
    const [book] = parseCatalog(fixture('catalog.xml'), '/kiwix')
    const hits = parseSearchRss(fixture('search.xml'), book!, '/kiwix')
    expect(hits[0]).toMatchObject({
      source: 'zim',
      title: 'Deshidratación',
      snippet: 'La [[deshidratación]] es la pérdida de agua',
      href: '/kiwix/viewer#wikipedia_es_medicine_nopic_2026-10/Deshidrataci%C3%B3n',
      bookTitle: 'Wikipedia Médica',
    })
  })
})

describe('rankZimHits', () => {
  const h = (title: string, book: string) => ({ source: 'zim' as const, title, snippet: '', href: `/${book}/${title}`, bookTitle: book })
  it('título exacto primero y libros intercalados', () => {
    const viajes = [h('Mal de montaña', 'Wikiviajes'), h('Campo Grande', 'Wikiviajes'), h('Arcos', 'Wikiviajes')]
    const medica = [h('Golpe de calor', 'Médica'), h('Deshidratación', 'Médica')]
    const r = rankZimHits('deshidratacion', [viajes, medica]).map((x) => x.title)
    expect(r[0]).toBe('Deshidratación')
    expect(r.slice(1, 4)).toEqual(['Mal de montaña', 'Golpe de calor', 'Campo Grande'])
  })
})
