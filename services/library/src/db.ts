import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AskHistoryEntry, AskSource, DocKind, DocSummary, Favorite } from '@survival-os/shared-types'

export interface DocRow {
  id: number
  path: string
  title: string
  kind: DocKind
  size: number
  mtime_ms: number
  searchable: number
}

export class LibraryDb {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        searchable INTEGER NOT NULL DEFAULT 1
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title, body, tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        href TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ask_history (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        sources TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL,
        ms INTEGER NOT NULL
      );
    `)
  }

  /** Guarda una consulta y conserva solo las `keep` más recientes. */
  addAskHistory(e: Omit<AskHistoryEntry, 'id' | 'createdAt'>, keep: number): number {
    const r = this.db
      .prepare('INSERT INTO ask_history (question, answer, sources, model, created_at, ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.question, e.answer, JSON.stringify(e.sources), e.model, new Date().toISOString(), Math.round(e.ms))
    this.db.prepare('DELETE FROM ask_history WHERE id NOT IN (SELECT id FROM ask_history ORDER BY id DESC LIMIT ?)').run(keep)
    return Number(r.lastInsertRowid)
  }

  listAskHistory(limit: number): AskHistoryEntry[] {
    return (this.db.prepare('SELECT * FROM ask_history ORDER BY id DESC LIMIT ?').all(limit) as unknown as AskHistoryRow[]).map(askRow)
  }

  getAskHistory(id: number): AskHistoryEntry | undefined {
    const r = this.db.prepare('SELECT * FROM ask_history WHERE id = ?').get(id) as unknown as AskHistoryRow | undefined
    return r && askRow(r)
  }

  /** Devuelve true si existía. */
  deleteAskHistory(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM ask_history WHERE id = ?').run(id).changes) > 0
  }

  clearAskHistory(): number {
    return Number(this.db.prepare('DELETE FROM ask_history').run().changes)
  }

  listDocs(): DocRow[] {
    return this.db.prepare('SELECT * FROM documents ORDER BY title COLLATE NOCASE').all() as unknown as DocRow[]
  }

  getDoc(id: number): DocRow | undefined {
    return this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as unknown as DocRow | undefined
  }

  upsertDoc(d: Omit<DocRow, 'id'>, body: string): void {
    const existing = this.db.prepare('SELECT id FROM documents WHERE path = ?').get(d.path) as { id: number } | undefined
    let id: number
    if (existing) {
      id = existing.id
      this.db
        .prepare('UPDATE documents SET title = ?, kind = ?, size = ?, mtime_ms = ?, searchable = ? WHERE id = ?')
        .run(d.title, d.kind, d.size, d.mtime_ms, d.searchable, id)
      this.db.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(id)
    } else {
      const r = this.db
        .prepare('INSERT INTO documents (path, title, kind, size, mtime_ms, searchable) VALUES (?, ?, ?, ?, ?, ?)')
        .run(d.path, d.title, d.kind, d.size, d.mtime_ms, d.searchable)
      id = Number(r.lastInsertRowid)
    }
    this.db.prepare('INSERT INTO documents_fts (rowid, title, body) VALUES (?, ?, ?)').run(id, d.title, body)
  }

  removeDoc(path: string): void {
    const row = this.db.prepare('SELECT id FROM documents WHERE path = ?').get(path) as { id: number } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM documents_fts WHERE rowid = ?').run(row.id)
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(row.id)
  }

  /** Búsqueda FTS5 con fragmento resaltado (marcas «…» sustituidas en la UI). */
  searchDocs(query: string, limit: number): { id: number; title: string; snippet: string }[] {
    const match = toFtsQuery(query)
    if (!match) return []
    return this.db
      .prepare(
        `SELECT d.id, d.title, snippet(documents_fts, 1, '[[', ']]', '…', 12) AS snippet
         FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as unknown as { id: number; title: string; snippet: string }[]
  }

  /** Búsqueda con CUALQUIERA de las palabras (OR), ordenada por relevancia BM25. */
  searchDocsAny(words: string[], limit: number): { id: number; title: string; snippet: string }[] {
    const terms = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 2)
    if (!terms.length) return []
    const match = terms.map((w) => `"${w}"*`).join(' OR ')
    return this.db
      .prepare(
        `SELECT d.id, d.title, snippet(documents_fts, 1, '[[', ']]', '…', 40) AS snippet
         FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as unknown as { id: number; title: string; snippet: string }[]
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return r?.value ?? null
  }

  listFavorites(): Favorite[] {
    return (this.db.prepare('SELECT * FROM favorites ORDER BY created_at DESC').all() as unknown as {
      id: string
      title: string
      href: string
      created_at: string
    }[]).map((f) => ({ id: f.id, title: f.title, href: f.href, createdAt: f.created_at }))
  }

  putFavorite(f: { id: string; title: string; href: string }): void {
    this.db
      .prepare('INSERT INTO favorites (id, title, href, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, href = excluded.href')
      .run(f.id, f.title, f.href, new Date().toISOString())
  }

  deleteFavorite(id: string): void {
    this.db.prepare('DELETE FROM favorites WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}

/**
 * Convierte texto libre en una consulta FTS5 segura: palabras entre comillas
 * (sin operadores del usuario) con prefijo en la última. "agua pot" → "agua" "pot"*
 */
export function toFtsQuery(input: string): string | null {
  const words = input
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8)
  if (!words.length) return null
  return words.map((w, i) => `"${w}"${i === words.length - 1 && w.length >= 2 ? '*' : ''}`).join(' ')
}

interface AskHistoryRow {
  id: number
  question: string
  answer: string
  sources: string
  model: string | null
  created_at: string
  ms: number
}

function askRow(r: AskHistoryRow): AskHistoryEntry {
  let sources: AskSource[] = []
  try {
    sources = JSON.parse(r.sources) as AskSource[]
  } catch {
    // fila antigua o dañada: se muestra sin fuentes
  }
  return { id: r.id, question: r.question, answer: r.answer, sources, model: r.model, createdAt: r.created_at, ms: r.ms }
}

export function docSummary(r: DocRow): DocSummary {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    path: r.path,
    sizeBytes: r.size,
    modifiedAt: new Date(r.mtime_ms).toISOString(),
    searchable: r.searchable === 1,
  }
}
