import { describe, expect, it } from 'vitest'
import { buildMessages, clip, excerpt, GENERAL_PROMPTS, keywords, priorAnswer, relevance, repetitionCut, retrievalQuery, searchTerms, stem, SYSTEM_PROMPT, SYSTEM_PROMPTS } from '../src/assistant.ts'

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

  it('el prompt pone la biblioteca primero, numera las citas y marca lo que no sale de ella', () => {
    const m = buildMessages('¿Cómo potabilizo agua?', [
      { n: 1, title: 'Potabilizar agua', href: '/emergencias/agua-potable', source: 'protocol', text: 'Hervir 1 minuto.' },
      { n: 2, title: 'Agua potable (Wikipedia)', href: '/kiwix/viewer#x/Agua', source: 'zim', text: 'Agua apta para el consumo.' },
    ])
    expect(m[0]?.content).toBe(SYSTEM_PROMPT)
    expect(SYSTEM_PROMPT).toMatch(/pueden no tener relación con la pregunta/)
    expect(SYSTEM_PROMPT).toMatch(/al final de la frase que la usa/)
    expect(SYSTEM_PROMPT).toMatch(/Nunca escribas números de cita sueltos/)
    expect(SYSTEM_PROMPT).toMatch(/Fuera de la biblioteca:/)
    expect(SYSTEM_PROMPT).toMatch(/no inventes/)
    expect(SYSTEM_PROMPT).toMatch(/112/)
    expect(m[1]?.content).toContain('[1] Potabilizar agua\nHervir 1 minuto.')
    expect(m[1]?.content).toContain('[2] Agua potable (Wikipedia)')
    expect(m[1]?.content.startsWith('PREGUNTA: ¿Cómo potabilizo agua?\n\nFUENTES:')).toBe(true)
    expect(m[1]?.content.endsWith('PREGUNTA: ¿Cómo potabilizo agua?')).toBe(true)
  })

  it('sin fuentes, conocimiento general: solo la pregunta y un prompt que lo dice', () => {
    const m = buildMessages('¿Cuándo se escribió el Quijote?', [], 'es')
    expect(m).toEqual([
      { role: 'system', content: GENERAL_PROMPTS.es },
      { role: 'user', content: '¿Cuándo se escribió el Quijote?' },
    ])
    for (const l of ['es', 'en', 'fr', 'it'] as const) {
      expect(GENERAL_PROMPTS[l]).toMatch(/112/)
      expect(SYSTEM_PROMPTS[l]).toMatch(/\[1\]/)
    }
  })

  it('corta los bucles del modelo (la misma línea o frase por tercera vez)', () => {
    // Visto en la Pi con Qwen 2.5 1.5B: «[1] [2] [3] [4]» hasta agotar los tokens.
    expect(repetitionCut('[1] [2] [3] [4]\n\n[1] [2] [3] [4]\n\n[1] [2] [3] [4]\n')).toBe('[1] [2] [3] [4]')
    const loop = 'Usa una lámpara. Si no es seguro, mantén las luces encendidas. Si no es seguro, mantén las luces encendidas. Si no es seguro, mantén las luces encendidas.'
    expect(repetitionCut(loop)).toBe('Usa una lámpara. Si no es seguro, mantén las luces encendidas.')
    // Dos veces todavía no; ni frases cortas («Paso 1.») ni la última frase a medias.
    expect(repetitionCut('Hierve el agua. Hierve el agua. Hierve el ag')).toBeNull()
    expect(repetitionCut('1. Sí.\n2. Sí.\n3. Sí.\n')).toBeNull()
    expect(repetitionCut('Llama al 112. Abriga a la persona [1]. Dale bebidas calientes [2].')).toBeNull()
  })

  it('conversación: las preguntas anteriores van antes de la nueva, sin citas ni fuentes', () => {
    const prior = [{ question: '¿Cómo trato una quemadura?', answer: 'Enfría con agua 20 minutos [1]. No revientes las ampollas [2].' }]
    const src = [{ n: 1, title: 'Quemaduras', href: '/emergencias/quemaduras', source: 'protocol' as const, text: 'En niños, acude antes al médico.' }]
    const m = buildMessages('¿Y si es un niño?', src, 'es', prior)
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(m[0]?.content).toContain('preguntas y respuestas anteriores de esta conversación')
    expect(m[1]?.content).toBe('¿Cómo trato una quemadura?')
    expect(m[2]?.content).toBe('Enfría con agua 20 minutos. No revientes las ampollas.')
    expect(m[3]?.content).toContain('[1] Quemaduras')
    // Sin conversación, el prompt no cambia (y sin fuentes tampoco lleva el aviso).
    expect(buildMessages('x', src, 'es')[0]?.content).toBe(SYSTEM_PROMPTS.es)
    const g = buildMessages('¿Y en verano?', [], 'en', prior)
    expect(g.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(g[0]?.content.startsWith(GENERAL_PROMPTS.en)).toBe(true)
  })

  it('conversación: la búsqueda suma la pregunta anterior y las respuestas se recortan', () => {
    expect(retrievalQuery('¿y si es un niño?', [])).toBe('¿y si es un niño?')
    expect(retrievalQuery('¿y si es un niño?', [{ question: 'a', answer: 'b' }, { question: '¿quemadura?', answer: 'c' }])).toBe('¿y si es un niño? ¿quemadura?')
    expect(keywords(retrievalQuery('¿y si es un niño?', [{ question: '¿Cómo trato una quemadura?', answer: '' }]))).toEqual(['nino', 'trato', 'quemadura'])
    expect(priorAnswer('x '.repeat(1000)).length).toBeLessThanOrEqual(701)
  })
})
