import { describe, expect, it } from 'vitest'
import { buildMessages, clip, excerpt, keywords, relevance, searchTerms, stem, SYSTEM_PROMPT } from '../src/assistant.ts'

describe('asistente (RAG)', () => {
  it('palabras clave sin palabras vacías ni acentos', () => {
    expect(keywords('¿Cómo potabilizo agua si no puedo hervirla?')).toEqual(['potabilizo', 'agua', 'hervirla'])
    expect(keywords('¿Qué hago si alguien tiene hipotermia?')).toEqual(['hipotermia'])
    expect(keywords('¿Cuáles son los síntomas de la deshidratación?')).toEqual(['sintomas', 'deshidratacion'])
    expect(searchTerms('¿Cuáles son los síntomas de la deshidratación?')).toBe('síntomas deshidratación')
  })

  it('raíz aproximada empareja formas verbales', () => {
    expect(stem('potabilizo')).toBe(stem('potabilizar'))
    expect(relevance(['potabilizo', 'agua'], 'Potabilizar agua', 'Hervir el agua…')).toBe(7)
    expect(relevance(['hipotermia'], 'Nepal', 'Montañas altas')).toBe(0)
  })

  it('clip no parte palabras y marca el recorte', () => {
    expect(clip('uno dos tres cuatro cinco', 100)).toBe('uno dos tres cuatro cinco')
    const c = clip('palabra '.repeat(50), 40)
    expect(c.endsWith('…')).toBe(true)
    expect(c.length).toBeLessThanOrEqual(41)
  })

  it('excerpt se centra en la palabra buscada, sin acentos', () => {
    const text = `${'relleno '.repeat(200)}Para potabilizar el agua hierve un minuto. ${'final '.repeat(50)}`
    const e = excerpt(text, 'potabilización agua', 120)
    expect(e).toContain('potabilizar')
    expect(e.startsWith('…')).toBe(true)
  })

  it('excerpt elige la zona con más palabras distintas, no la primera aparición', () => {
    const text = `La deshidratación es la pérdida de agua corporal. ${'Historia y causas varias. '.repeat(80)}Síntomas de la deshidratación: sed intensa, boca seca, orina oscura. ${'Otros datos. '.repeat(40)}`
    const e = excerpt(text, '¿Cuáles son los síntomas de la deshidratación?', 200)
    expect(e).toContain('Síntomas de la deshidratación: sed intensa')
    expect(e.startsWith('…')).toBe(true)
  })

  it('excerpt prefiere la primera zona con las palabras juntas, aunque luego se repitan', () => {
    const text = `Intro. ${'x '.repeat(300)}Los síntomas de la deshidratación son: náuseas y fatiga. ${'y '.repeat(300)}Más síntomas de deshidratación grave. ${'deshidratación '.repeat(5)}${'z '.repeat(300)}`
    expect(excerpt(text, '¿Cuáles son los síntomas de la deshidratación?', 200)).toContain('náuseas y fatiga')
  })

  it('excerpt conserva posiciones con texto en NFD y no empareja dentro de palabras', () => {
    const nfd = 'Agua corriente. '.normalize('NFD') + 'x '.repeat(300) + 'Hipotermia grave: abrigar.'.normalize('NFD')
    expect(excerpt(nfd, 'hipotermia', 60)).toContain('Hipotermia grave')
    expect(excerpt(`paraguas ${'y '.repeat(300)}agua limpia`, 'agua', 30)).toContain('agua limpia')
  })

  it('el prompt obliga a usar solo las fuentes y numera las citas', () => {
    const m = buildMessages('¿Cómo potabilizo agua?', [
      { n: 1, title: 'Potabilizar agua', href: '/emergencias/agua-potable', source: 'protocol', text: 'Hervir 1 minuto.' },
      { n: 2, title: 'Agua potable (Wikipedia)', href: '/kiwix/viewer#x/Agua', source: 'zim', text: 'Agua apta para el consumo.' },
    ])
    expect(m[0]?.content).toBe(SYSTEM_PROMPT)
    expect(SYSTEM_PROMPT).toMatch(/SOLO con la información de las FUENTES/)
    expect(SYSTEM_PROMPT).toMatch(/No lo encuentro en la biblioteca/)
    expect(SYSTEM_PROMPT).toMatch(/112/)
    expect(m[1]?.content).toContain('[1] Potabilizar agua\nHervir 1 minuto.')
    expect(m[1]?.content).toContain('[2] Agua potable (Wikipedia)')
    expect(m[1]?.content.endsWith('PREGUNTA: ¿Cómo potabilizo agua?')).toBe(true)
  })
})
