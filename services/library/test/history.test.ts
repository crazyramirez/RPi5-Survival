import { describe, expect, it } from 'vitest'
import { LibraryDb } from '../src/db.ts'

describe('historial del asistente', () => {
  const entry = (q: string) => ({
    question: q,
    answer: `Respuesta a ${q} [1]`,
    sources: [{ n: 1, title: 'Hipotermia', href: '/emergencias/hipotermia', source: 'protocol' as const }],
    model: 'Qwen3-4B-Instruct-2507-Q4_0.gguf',
    ms: 85_400,
  })

  it('guarda, lista del más reciente al más antiguo y recupera con sus fuentes', () => {
    const db = new LibraryDb(':memory:')
    const a = db.addAskHistory(entry('¿agua?'), 200)
    const b = db.addAskHistory(entry('¿fuego?'), 200)
    expect(db.listAskHistory(10).map((e) => e.id)).toEqual([b, a])
    const got = db.getAskHistory(a)
    expect(got?.question).toBe('¿agua?')
    expect(got?.sources[0]?.href).toBe('/emergencias/hipotermia')
    expect(got?.model).toBe('Qwen3-4B-Instruct-2507-Q4_0.gguf')
    expect(Date.parse(got?.createdAt ?? '')).not.toBeNaN()
    db.close()
  })

  it('conserva solo las N más recientes', () => {
    const db = new LibraryDb(':memory:')
    for (let i = 0; i < 7; i++) db.addAskHistory(entry(`p${i}`), 5)
    expect(db.listAskHistory(100).map((e) => e.question)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2'])
    db.close()
  })

  it('borra una consulta o todo el historial', () => {
    const db = new LibraryDb(':memory:')
    const a = db.addAskHistory(entry('uno'), 200)
    db.addAskHistory(entry('dos'), 200)
    expect(db.deleteAskHistory(a)).toBe(true)
    expect(db.deleteAskHistory(a)).toBe(false)
    expect(db.getAskHistory(a)).toBeUndefined()
    expect(db.clearAskHistory()).toBe(1)
    expect(db.listAskHistory(10)).toEqual([])
    db.close()
  })
})
