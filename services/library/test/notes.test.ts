import { describe, expect, it } from 'vitest'
import { LibraryDb, noteTasks } from '../src/db.ts'

describe('notas', () => {
  it('crea, lista (fijadas primero) y lee con tareas y vista previa', () => {
    const db = new LibraryDb(':memory:')
    const a = db.createNote({ title: 'Mochila', body: '- [x] Agua 3 L\n- [ ] Linterna\nRevisar el sábado' })
    const b = db.createNote({ title: 'Diario', body: '[08:30] Corte de luz', pinned: true })
    expect(db.listNotes().map((n) => n.id)).toEqual([b.id, a.id])
    expect(a.tasks).toEqual({ done: 1, total: 2 })
    expect(a.preview).toBe('Agua 3 L · Linterna · Revisar el sábado')
    expect(db.getNote(a.id)?.body).toContain('Linterna')
    db.close()
  })

  it('actualiza y reindexa; fijar no cambia la fecha de edición', () => {
    const db = new LibraryDb(':memory:')
    const n = db.createNote({ title: 'Agua', body: 'Bidones en el garaje' })
    expect(db.searchNotes('garaje', 5).map((x) => x.id)).toEqual([n.id])
    const pinned = db.updateNote(n.id, { pinned: true })!
    expect(pinned.pinned).toBe(true)
    expect(pinned.updatedAt).toBe(n.updatedAt)
    db.updateNote(n.id, { body: 'Bidones en el trastero' })
    expect(db.searchNotes('garaje', 5)).toEqual([])
    expect(db.searchNotes('TRASTERO', 5)[0]?.snippet).toContain('[[trastero]]')
    expect(db.updateNote(9999, { title: 'x' })).toBeUndefined()
    db.close()
  })

  it('el asistente encuentra notas con cualquiera de las palabras clave', () => {
    const db = new LibraryDb(':memory:')
    db.createNote({ title: 'Medicinas', body: 'Insulina en la nevera de la cocina' })
    expect(db.searchNotesAny(['donde', 'insulina'], 1).map((x) => x.title)).toEqual(['Medicinas'])
    db.close()
  })

  it('borra la nota y su índice', () => {
    const db = new LibraryDb(':memory:')
    const n = db.createNote({ title: 'Temporal', body: 'borrar' })
    expect(db.deleteNote(n.id)).toBe(true)
    expect(db.deleteNote(n.id)).toBe(false)
    expect(db.searchNotes('borrar', 5)).toEqual([])
    db.close()
  })

  it('cuenta tareas con - o * y x mayúscula o minúscula; ignora casillas mal escritas', () => {
    expect(noteTasks('- [ ] a\n* [X] b\n- [x] c\n-[ ] no\n- [] no')).toEqual({ done: 2, total: 3 })
  })
})
