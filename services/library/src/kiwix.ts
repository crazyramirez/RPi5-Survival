import type { SearchHit, ZimBook } from '@survival-os/shared-types'
import { htmlToText } from './markdown.ts'

/**
 * Cliente mínimo de kiwix-serve (loopback). Parsers tolerantes sin dependencias XML:
 * el formato OPDS/RSS de kiwix-serve es estable y simple.
 */

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&amp;/g, '&')
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)
  return m?.[1] ? decode(m[1]).trim() : ''
}

/** /catalog/v2/entries (OPDS Atom) → libros. */
export function parseCatalog(xml: string, rootPath: string): ZimBook[] {
  const books: ZimBook[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1] ?? ''
    const name = tag(e, 'name')
    // Enlace de contenido: <link type="text/html" href="/kiwix/content/<libro>" />
    const content = /<link[^>]*type="text\/html"[^>]*href="([^"]+)"/.exec(e)?.[1]
    const contentId = content ? content.replace(/\/$/, '').split('/').pop() : name
    const count = Number.parseInt(tag(e, 'articleCount'), 10)
    // Icono: <link rel="http://opds-spec.org/image/thumbnail" href="/kiwix/catalog/v2/illustration/<id>/?size=48" />
    const thumbTag = /<link[^>]*rel="http:\/\/opds-spec\.org\/image\/thumbnail"[^>]*>/.exec(e)?.[0] ?? ''
    const thumb = decode(/href="([^"]+)"/.exec(thumbTag)?.[1] ?? '')
    books.push({
      id: contentId ?? name,
      name,
      title: tag(e, 'title') || name,
      description: tag(e, 'summary'),
      language: tag(e, 'language'),
      articleCount: Number.isFinite(count) ? count : null,
      flavour: tag(e, 'flavour'),
      // Solo rutas del propio proxy: nunca una URL externa.
      icon: thumb.startsWith(`${rootPath}/`) && !thumb.includes('..') ? thumb : null,
      readerPath: `${rootPath}/viewer#${contentId ?? name}`,
    })
  }
  return books
}

/** /search?format=xml (RSS) → resultados. Los fragmentos llegan con <b> de resaltado. */
export function parseSearchRss(xml: string, book: ZimBook, rootPath: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1] ?? ''
    const link = tag(it, 'link')
    const snippetHtml = tag(it, 'description')
    // Ruta del artículo dentro del libro → lector: /kiwix/viewer#<libro>/<ruta>
    const path = link.replace(/^.*?\/content\//, '')
    hits.push({
      source: 'zim',
      title: tag(it, 'title'),
      snippet: snippetHtml.replace(/<b>/g, '[[').replace(/<\/b>/g, ']]').replace(/<[^>]+>/g, ''),
      href: path ? `${rootPath}/viewer#${path}` : book.readerPath,
      bookTitle: book.title,
    })
  }
  return hits
}

export class KiwixClient {
  private readonly baseUrl: string
  /** Prefijo público (proxy de la web), p. ej. "/kiwix". */
  private readonly rootPath: string

  constructor(baseUrl: string, rootPath = '/kiwix') {
    this.baseUrl = baseUrl
    this.rootPath = rootPath
  }

  private async get(path: string, timeoutMs: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`kiwix-serve ${res.status}`)
    return await res.text()
  }

  /** Texto de un artículo (ruta del lector "/kiwix/viewer#libro/Articulo"). */
  async articleText(readerHref: string): Promise<string> {
    const path = readerHref.replace(/^.*?\/viewer#/, '')
    return htmlToText(await this.get(`/content/${path}`, 5000))
  }

  async books(): Promise<ZimBook[]> {
    return parseCatalog(await this.get('/catalog/v2/entries?count=-1', 3000), this.rootPath)
  }

  async search(query: string, books: ZimBook[], perBook: number): Promise<SearchHit[]> {
    const results = await Promise.allSettled(
      books.map(async (b) =>
        parseSearchRss(
          await this.get(`/search?format=xml&pageLength=${perBook}&content=${encodeURIComponent(b.id)}&pattern=${encodeURIComponent(query)}`, 5000),
          b,
          this.rootPath,
        ),
      ),
    )
    return rankZimHits(query, results.map((r) => (r.status === 'fulfilled' ? r.value : [])))
  }
}

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/**
 * Mezcla los resultados de varios libros: primero los artículos cuyo título coincide con la
 * consulta (exacto, luego contiene), después intercalando por posición en cada libro (round-robin),
 * para que un libro con muchos resultados no tape al resto.
 */
export function rankZimHits(query: string, perBook: SearchHit[][]): SearchHit[] {
  const q = norm(query)
  const interleaved: { hit: SearchHit; pos: number }[] = []
  const max = Math.max(0, ...perBook.map((l) => l.length))
  for (let i = 0; i < max; i++) for (const list of perBook) if (list[i]) interleaved.push({ hit: list[i] as SearchHit, pos: interleaved.length })
  const score = (h: SearchHit): number => {
    const t = norm(h.title)
    return t === q ? 0 : t.startsWith(q) ? 1 : t.includes(q) ? 2 : 3
  }
  return interleaved.sort((a, b) => score(a.hit) - score(b.hit) || a.pos - b.pos).map((x) => x.hit)
}
