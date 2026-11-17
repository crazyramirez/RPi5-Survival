import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

  it('añade preguntas de seguimiento a la misma consulta, en orden', () => {
    const db = new LibraryDb(':memory:')
    const a = db.addAskHistory(entry('¿quemadura?'), 200)
    expect(db.getAskHistory(a)?.turns).toBeUndefined()
    expect(db.appendAskTurn(a, entry('¿y si es un niño?'))).toBe(true)
    expect(db.appendAskTurn(a, entry('¿y si hay ampollas?'))).toBe(true)
    expect(db.getAskHistory(a)?.turns?.map((x) => x.question)).toEqual(['¿y si es un niño?', '¿y si hay ampollas?'])
    expect(db.listAskHistory(1)[0]?.turns?.[0]?.sources[0]?.href).toBe('/emergencias/hipotermia')
    expect(db.appendAskTurn(9999, entry('x'))).toBe(false)
    db.close()
  })

  it('migra una base de datos anterior sin la columna de seguimientos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sos-hist-'))
    const file = join(dir, 'library.db')
    const old = new DatabaseSync(file)
    old.exec('CREATE TABLE ask_history (id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, sources TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, ms INTEGER NOT NULL)')
    old.prepare("INSERT INTO ask_history (question, answer, sources, model, created_at, ms) VALUES ('vieja', 'r', '[]', NULL, '2026-01-01T00:00:00Z', 5)").run()
    old.close()
    const db = new LibraryDb(file)
    const [e] = db.listAskHistory(10)
    expect(e?.question).toBe('vieja')
    expect(db.appendAskTurn(e!.id, entry('nueva'))).toBe(true)
    expect(db.getAskHistory(e!.id)?.turns?.length).toBe(1)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
