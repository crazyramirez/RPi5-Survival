import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontMatter, renderMarkdown } from '../../../services/library/src/markdown'
import { buildGuideDocument, guideHeadingText, guideTitleParts } from '../app/utils/guide-reader'
import { protocolReaderProfile } from '../app/utils/protocol-reader'

const root = fileURLToPath(new URL('../../../content/protocols/', import.meta.url))
const files = readdirSync(root).filter((name) => name.endsWith('.md')).sort()
const plain = (html: string): string => guideHeadingText(html).replace(/\s+/g, ' ').trim()

describe('lector: integridad del contenido real', () => {
  for (const lang of ['', 'en', 'fr', 'it']) {
    it(`conserva el texto, el orden y las listas de las 41 fichas (${lang || 'es'})`, () => {
      for (const file of files) {
        const { meta, body } = parseFrontMatter(readFileSync(join(root, lang, file), 'utf8'))
        const html = renderMarkdown(body)
        const document = buildGuideDocument(html)
        expect(document.sections.map((section) => section.title), file).toEqual([...body.matchAll(/^## (.+)$/gm)].map((m) => plain(renderMarkdown(`## ${m[1]!}`))))
        const rebuilt = document.introHtml + document.sections.map((section) => `<h3>${section.headingHtml}</h3>${section.html}`).join('')
        expect(plain(rebuilt), file).toBe(plain(html))
        expect([...rebuilt.matchAll(/<(ol|ul|li|blockquote|table)\b/g)].map((m) => m[1]), file).toEqual([...html.matchAll(/<(ol|ul|li|blockquote|table)\b/g)].map((m) => m[1]))
        const known = protocolReaderProfile(meta.id!)
        if (known.sections.length) {
          expect(known.sections, file).toHaveLength(document.sections.length)
          expect(protocolReaderProfile(meta.id!, document.sections.map((section) => section.title)).sections, file).toEqual(known.sections)
        }
      }
    })
  }

  it('separa ingredientes y uso, ramas, métodos, fases e inventarios sin crear una secuencia universal', () => {
    expect(protocolReaderProfile('deshidratacion-suero-oral').sections).toEqual(['warning', 'recipe', 'steps', 'warning'])
    expect(protocolReaderProfile('atragantamiento').sections).toEqual(['condition', 'condition', 'warning'])
    expect(protocolReaderProfile('agua-potable').sections).toEqual(['prose', 'method', 'method', 'method', 'warning'])
    expect(protocolReaderProfile('inundacion').sections).toEqual(['phase', 'phase', 'phase'])
    expect(protocolReaderProfile('kit-emergencia-72h').sections.slice(0, 4)).toEqual(['inventory', 'inventory', 'inventory', 'inventory'])
  })

  it('las guías nuevas no reciben pasos, estado médico ni teléfono por defecto', () => {
    expect(protocolReaderProfile('manual-radio')).toEqual({ sections: [], tone: 'neutral', medical: false, contact: false })
    expect(protocolReaderProfile('kit-emergencia-72h').medical).toBe(false)
    expect(protocolReaderProfile('agua-potable').contact).toBe(false)
  })

  it('admite texto sin encabezados, tablas, código, títulos repetidos y subapartados', () => {
    expect(buildGuideDocument('<p>Lectura sin apartados.</p>')).toEqual({ introHtml: '<p>Lectura sin apartados.</p>', sections: [] })
    const html = renderMarkdown('## A & B\n\n| Dato | Valor |\n|---|---|\n| x | 1 |\n\n### Detalle\n\n```\n<h3>no es un título</h3>\n```\n\n## A & B\n\nFin')
    const document = buildGuideDocument(html)
    expect(document.sections.map((section) => [section.id, section.title, section.level])).toEqual([
      ['guide-section-1', 'A & B', 0], ['guide-section-2', 'Detalle', 1], ['guide-section-3', 'A & B', 0],
    ])
    expect(document.sections[0]?.html).toContain('<table>')
    expect(document.sections[1]?.html).toContain('&lt;h3&gt;no es un título&lt;/h3&gt;')
  })

  it('un índice cambiado o reordenado deja de recibir estilos editoriales antiguos', () => {
    expect(protocolReaderProfile('rcp-adulto', ['Cuándo', 'Advertencias', 'Pasos']).sections).toEqual([])
    expect(protocolReaderProfile('rcp-adulto', ['Ingredientes', 'Pasos', 'Advertencias']).sections).toEqual([])
    expect(protocolReaderProfile('rcp-adulto', ['Cuándo', 'Pasos', 'Advertencias']).sections).toEqual(['prose', 'steps', 'warning'])
    expect(protocolReaderProfile('manual-nuevo', ['Herramientas', 'Preparación']).sections).toEqual([])
  })

  it('conserva íntegro el título al separar un subtítulo largo', () => {
    const title = 'RCP en adultos (reanimación cardiopulmonar)'
    const parts = guideTitleParts(title)
    expect(`${parts.title} ${parts.subtitle}`).toBe(title)
    expect(guideTitleParts('Uso del desfibrilador (DEA)')).toEqual({ title: 'Uso del desfibrilador (DEA)', subtitle: '' })
  })
})
