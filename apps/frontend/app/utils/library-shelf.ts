import type { DocSummary, LibraryShelfMap, ZimBook } from '@survival-os/shared-types'

/**
 * Organización de la biblioteca por categorías. Funciones puras: la página las combina con lo instalado.
 *
 * - Enciclopedias (ZIM): por el grupo del catálogo; los ZIM que añade la persona van a «otros».
 * - Manuales del catálogo (docs/manuales/): por tema; un libro por capítulos es UNA entrada con sus capítulos.
 * - Documentos propios (el resto de docs/): por la carpeta de primer nivel donde los copió la persona.
 */

/** Grupo para lo que no está en el catálogo. */
export const OTHER = 'otros'

/** Orden fijo de los temas de los manuales (los ids están en content/catalog.json, campo `topic`). */
export const MANUAL_TOPICS = ['medicina', 'familia', 'mente', 'agua', 'alimentos', 'riesgos', 'campo', 'radio', OTHER] as const
export type ManualTopic = (typeof MANUAL_TOPICS)[number]

/** Orden fijo de los grupos de enciclopedias. */
export const ZIM_GROUPS = ['salud', 'preparacion', 'saber', 'oficios', 'libros', OTHER] as const

export interface ShelfBook {
  book: ZimBook
  group: string
  /** Id del catálogo, o null si la persona añadió el ZIM a mano. */
  catalogId: string | null
}

export interface ManualEntry {
  /** Id del catálogo (o `doc:<id>` si es un PDF suelto en manuales/ que el catálogo ya no conoce). */
  id: string
  title: string
  topic: string
  publisher: string | null
  description: string
  /** Documentos indexados: uno, o los capítulos en el orden del libro. */
  docs: DocSummary[]
  /** Título de cada capítulo (mismo orden que `docs`). */
  chapterTitles: string[]
  sizeBytes: number
}

export interface DocFolder {
  /** Carpeta de primer nivel; '' para los ficheros sueltos en la raíz. */
  id: string
  docs: DocSummary[]
}

/** «wikipedia_es_all_nopic_2026-01» → «wikipedia_es_all» (mismo criterio que el estado del catálogo). */
export function zimBaseName(bookId: string): string {
  return bookId.replace(/(_(maxi|nopic|mini))?_\d{4}-\d{2}$/, '')
}

function rank(order: readonly string[], id: string): number {
  const i = order.indexOf(id)
  return i < 0 ? order.length : i
}

const collator = (lang: string): Intl.Collator => new Intl.Collator(lang, { sensitivity: 'base', numeric: true })

export function classifyBooks(books: ZimBook[], map: LibraryShelfMap | null): ShelfBook[] {
  const byName = new Map((map?.zims ?? []).map((z) => [z.name, z]))
  return books.map((book) => {
    const z = byName.get(zimBaseName(book.id))
    return { book, group: z?.group ?? OTHER, catalogId: z?.id ?? null }
  })
}

/** Grupos con libros, en el orden fijo; dentro, por título. */
export function groupBooks(books: ShelfBook[], lang = 'es'): { id: string; items: ShelfBook[] }[] {
  const cmp = collator(lang)
  const groups = new Map<string, ShelfBook[]>()
  for (const b of books) groups.set(b.group, [...(groups.get(b.group) ?? []), b])
  return [...groups.entries()]
    .sort(([a], [b]) => rank(ZIM_GROUPS, a) - rank(ZIM_GROUPS, b) || a.localeCompare(b))
    .map(([id, items]) => ({ id, items: items.sort((a, b) => cmp.compare(a.book.title, b.book.title)) }))
}

const MANUALS_DIR = 'manuales/'

/** Separa los manuales del catálogo de los documentos propios. */
export function splitDocs(docs: DocSummary[], map: LibraryShelfMap | null): { manuals: ManualEntry[]; own: DocSummary[] } {
  const own: DocSummary[] = []
  const byFile = new Map<string, LibraryShelfMap['manuals'][number]>()
  const byId = new Map<string, LibraryShelfMap['manuals'][number]>()
  for (const m of map?.manuals ?? []) {
    byId.set(m.id, m)
    if (m.file) byFile.set(m.file, m)
  }
  const entries = new Map<string, ManualEntry>()
  const entry = (key: string, base: Omit<ManualEntry, 'docs' | 'chapterTitles' | 'sizeBytes'>): ManualEntry => {
    let e = entries.get(key)
    if (!e) {
      e = { ...base, docs: [], chapterTitles: [], sizeBytes: 0 }
      entries.set(key, e)
    }
    return e
  }

  for (const d of docs) {
    if (!d.path.startsWith(MANUALS_DIR)) {
      own.push(d)
      continue
    }
    const rest = d.path.slice(MANUALS_DIR.length)
    const slash = rest.indexOf('/')
    const m = slash < 0 ? byFile.get(rest) : byId.get(rest.slice(0, slash))
    const e = m
      ? entry(m.id, { id: m.id, title: m.title, topic: m.topic, publisher: m.publisher, description: m.description })
      : entry(`doc:${d.id}`, { id: `doc:${d.id}`, title: d.title, topic: OTHER, publisher: null, description: '' })
    e.docs.push(d)
    e.sizeBytes += d.sizeBytes
  }

  for (const e of entries.values()) {
    const parts = byId.get(e.id)?.parts
    if (parts) {
      const order = new Map(parts.map((p, i) => [`${MANUALS_DIR}${e.id}/${p.file}`, i]))
      e.docs.sort((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9) || a.path.localeCompare(b.path))
      const titles = new Map(parts.map((p) => [`${MANUALS_DIR}${e.id}/${p.file}`, p.title]))
      e.chapterTitles = e.docs.map((d) => titles.get(d.path) ?? chapterTitle(d.title, e.title))
    } else {
      e.chapterTitles = e.docs.map((d) => chapterTitle(d.title, e.title))
    }
  }
  return { manuals: [...entries.values()], own }
}

/** «Donde no hay doctor · 3 Cómo curar» → «3 Cómo curar» (el indexador une libro y capítulo con « · »). */
export function chapterTitle(docTitle: string, bookTitle: string): string {
  const prefix = `${bookTitle} · `
  return docTitle.startsWith(prefix) ? docTitle.slice(prefix.length) : docTitle
}

/** Temas con manuales, en el orden fijo; dentro, por título. */
export function groupManuals(manuals: ManualEntry[], lang = 'es'): { id: string; items: ManualEntry[] }[] {
  const cmp = collator(lang)
  const groups = new Map<string, ManualEntry[]>()
  for (const m of manuals) {
    const topic = (MANUAL_TOPICS as readonly string[]).includes(m.topic) ? m.topic : OTHER
    groups.set(topic, [...(groups.get(topic) ?? []), m])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(MANUAL_TOPICS, a) - rank(MANUAL_TOPICS, b))
    .map(([id, items]) => ({ id, items: items.sort((a, b) => cmp.compare(a.title, b.title)) }))
}

export type DocSort = 'name' | 'recent' | 'size'

export function sortDocs(docs: DocSummary[], sort: DocSort, lang = 'es'): DocSummary[] {
  const cmp = collator(lang)
  const list = [...docs]
  if (sort === 'recent') return list.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || cmp.compare(a.title, b.title))
  if (sort === 'size') return list.sort((a, b) => b.sizeBytes - a.sizeBytes || cmp.compare(a.title, b.title))
  return list.sort((a, b) => cmp.compare(a.title, b.title))
}

/** Carpetas de primer nivel: primero la raíz (''), luego por nombre. */
export function groupOwnDocs(docs: DocSummary[], sort: DocSort, lang = 'es'): DocFolder[] {
  const cmp = collator(lang)
  const folders = new Map<string, DocSummary[]>()
  for (const d of docs) {
    const slash = d.path.indexOf('/')
    const id = slash < 0 ? '' : d.path.slice(0, slash)
    folders.set(id, [...(folders.get(id) ?? []), d])
  }
  return [...folders.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : cmp.compare(a, b)))
    .map(([id, list]) => ({ id, docs: sortDocs(list, sort, lang) }))
}

/** Coincidencia sin tildes ni mayúsculas (filtro rápido por título dentro de la pestaña). */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalize(query)
  if (!q) return true
  const hay = normalize(fields.filter(Boolean).join(' '))
  return q.split(/\s+/).every((w) => hay.includes(w))
}
