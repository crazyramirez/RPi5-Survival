import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changelogSections, renderChangelogMd } from '../app/utils/changelog'

const md = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')

describe('Novedades (CHANGELOG.md)', () => {
  it('lee la sección de una versión con su fecha y título', () => {
    const [s] = changelogSections(md, '0.11.7')
    expect(s?.version).toBe('0.11.7')
    expect(s?.date).toBe('2026-11-16')
    expect(s?.title).toBe('Aviso de versión nueva')
    expect(s?.html).toContain('<h4>Añadido</h4>')
    expect(s?.html).toContain('<strong>')
  })
  it('desde una versión anterior: las intermedias, la más nueva primero', () => {
    expect(changelogSections(md, '0.11.7', '0.11.4').map((s) => s.version)).toEqual(['0.11.7', '0.11.6', '0.11.5'])
  })
  it('viñetas anidadas y HTML escapado', () => {
    const html = renderChangelogMd('### Hecho\n- uno <b>x</b>\n  - dos `c`\n- tres')
    expect(html).toBe('<h4>Hecho</h4><ul><li>uno &lt;b&gt;x&lt;/b&gt;<ul><li>dos <code>c</code></li></ul></li><li>tres</li></ul>')
  })
})
