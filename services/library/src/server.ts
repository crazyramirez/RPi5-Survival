import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { AskHistory, PlaceSearch, AskSource, AssistantStatus, LibraryStatus, Probe, SearchHit, SearchResults, ZimBook, ZimDownload, ZimInstalled } from '@survival-os/shared-types'
import { loadConfig } from './config.ts'
import { LibraryDb, docSummary } from './db.ts'
import { indexDocs } from './indexer.ts'
import { KiwixClient } from './kiwix.ts'
import { escapeHtml, htmlToText, renderMarkdown } from './markdown.ts'
import { buildMessages, clip, excerpt, isLang, keywords, LANGS, NOT_FOUND, relevance, searchTerms, sse, streamCompletion, type Lang, type Source } from './assistant.ts'
import { loadProtocols, localized, summarize, type LoadedProtocol } from './protocols.ts'
import { PlaceIndex } from './places.ts'

const config = loadConfig()
mkdirSync(config.docsDir, { recursive: true })
const db = new LibraryDb(config.dbPath)
const kiwix = new KiwixClient(config.kiwixUrl)
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

let protocols: LoadedProtocol[] = []
/** Traducciones de los protocolos (content/protocols/<idioma>/), por idioma. */
const translatedProtocols = new Map<Lang, LoadedProtocol[]>()

/** Idioma de la interfaz que hace la petición (cabecera x-survival-lang); español si no viene. */
function langOf(req: IncomingMessage): Lang {
  const v = req.headers['x-survival-lang']
  return isLang(v) ? v : 'es'
}

function protocolsFor(lang: Lang): LoadedProtocol[] {
  return lang === 'es' ? protocols : localized(protocols, translatedProtocols.get(lang))
}
let indexing: Promise<unknown> | null = null
let pdftotextAvailable = false
/** pdftotext del sistema o el de la versión portable (PDFTOTEXT, se descarga con los manuales). */
function pdftotextPresent(): boolean {
  const list = [process.env.PDFTOTEXT, '/usr/bin/pdftotext', '/usr/local/bin/pdftotext', '/opt/homebrew/bin/pdftotext'].filter((p): p is string => !!p)
  return list.some((p) => existsSync(p))
}

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'library', msg, ...extra })}\n`)
}

/** Buscador de lugares sin conexión (índice de los mapas instalados). */
const places = new PlaceIndex(config.placesDbPath, config.mapsDir, log)

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 })
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
}

/** ZIM instalados (con procedencia del manifiesto) y descargas en curso (.part). */
async function zimFiles(): Promise<{ installed: ZimInstalled[]; downloads: ZimDownload[] }> {
  const dir = resolve(config.dataDir, 'zim')
  const names = await readdir(dir).catch(() => [] as string[])
  let manifest: { entries?: { path?: string; title?: string; license?: string; version?: string }[] } = {}
  try {
    manifest = JSON.parse(await readFile(resolve(config.dataDir, 'manifest.json'), 'utf8')) as typeof manifest
  } catch {
    // sin manifiesto: se listan igualmente los ficheros
  }
  const installed: ZimInstalled[] = []
  const downloads: ZimDownload[] = []
  for (const n of names) {
    const st = await stat(resolve(dir, n)).catch(() => null)
    if (!st?.isFile()) continue
    if (n.endsWith('.zim')) {
      const e = manifest.entries?.find((x) => x.path === `zim/${n}`)
      installed.push({ file: n, sizeBytes: st.size, title: e?.title ?? null, license: e?.license ?? null, version: e?.version ?? null })
    } else if (n.endsWith('.zim.part')) {
      downloads.push({ file: n.replace(/\.part$/, ''), bytes: st.size })
    }
  }
  return { installed: installed.sort((a, b) => b.sizeBytes - a.sizeBytes), downloads }
}

async function kiwixBooks(): Promise<Probe<ZimBook[]>> {
  try {
    const books = await kiwix.books()
    return { state: 'ok', value: books, at: new Date().toISOString() }
  } catch {
    return { state: 'unavailable', reason: 'kiwix-serve no responde (no instalado o sin libros)' }
  }
}

async function search(q: string, lang: Lang = 'es'): Promise<SearchResults> {
  const query = q.trim().slice(0, 120)
  const now = new Date().toISOString()
  const hits: SearchHit[] = []
  const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const nq = norm(query)

  const words = nq.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)
  const protoHits = protocolsFor(lang)
    .filter((p) => {
      const hay = norm(`${p.title} ${p.text}`)
      return words.length > 0 && words.every((w) => hay.includes(w))
    })
    .map<SearchHit>((p) => {
      // norm() conserva la longitud en texto español (NFD + quitar marcas → mismos índices tras recomponer)
      const idx = norm(p.text).indexOf(words[0] ?? '')
      const snippet = idx >= 0 ? p.text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, ' ') : ''
      return { source: 'protocol', title: p.title, snippet, href: `/emergencias/${p.id}` }
    })
  hits.push(...protoHits)

  let docsProbe: Probe<{ count: number }>
  try {
    const docHits = db.searchDocs(query, 20).map<SearchHit>((d) => ({
      source: 'doc',
      title: d.title,
      snippet: d.snippet,
      href: `/biblioteca/doc/${d.id}`,
    }))
    hits.push(...docHits)
    docsProbe = { state: 'ok', value: { count: docHits.length }, at: now }
  } catch (err) {
    docsProbe = { state: 'error', reason: err instanceof Error ? err.message : 'error de índice' }
  }

  let zimProbe: Probe<{ count: number }>
  const books = await kiwixBooks()
  if (books.state === 'ok') {
    const zimHits = query.length >= 2 ? await kiwix.search(query, books.value, 8) : []
    hits.push(...zimHits)
    zimProbe = { state: 'ok', value: { count: zimHits.length }, at: now }
  } else {
    zimProbe = { state: 'unavailable', reason: books.reason }
  }

  let notesProbe: Probe<{ count: number }>
  try {
    const noteHits = db.searchNotes(query, 10).map<SearchHit>((n) => ({ source: 'note', title: n.title, snippet: n.snippet, href: `/biblioteca/notas?id=${n.id}` }))
    hits.push(...noteHits)
    notesProbe = { state: 'ok', value: { count: noteHits.length }, at: now }
  } catch (err) {
    notesProbe = { state: 'error', reason: err instanceof Error ? err.message : 'error de las notas' }
  }

  let historyProbe: Probe<{ count: number }>
  if (!historyEnabled()) {
    historyProbe = { state: 'unavailable', reason: 'historial desactivado' }
  } else {
    try {
      const hh = historyHits(words)
      hits.push(...hh)
      historyProbe = { state: 'ok', value: { count: hh.length }, at: now }
    } catch (err) {
      historyProbe = { state: 'error', reason: err instanceof Error ? err.message : 'error del historial' }
    }
  }

  return {
    query,
    hits,
    sources: {
      protocols: { state: 'ok', value: { count: protoHits.length }, at: now },
      docs: docsProbe,
      zim: zimProbe,
      history: historyProbe,
      notes: notesProbe,
    },
  }
}

let asking = false
let askingSince = 0
let askingAbort: AbortController | null = null

/** Historial de consultas: solo en el equipo, máx. HISTORY_LIMIT, desactivable por el usuario. */
const HISTORY_LIMIT = 200
const historyEnabled = (): boolean => db.getMeta('ask_history') !== 'off'

async function activeModel(): Promise<string | null> {
  return (await readFile(resolve(config.dataDir, '..', 'llm', 'active'), 'utf8').catch(() => '')).trim() || null
}

function saveHistory(question: string, answer: string, sources: AskSource[], model: string | null, ms: number): number | null {
  if (!historyEnabled() || !answer.trim()) return null
  try {
    return db.addAskHistory({ question, answer: answer.trim(), sources, model, ms }, HISTORY_LIMIT)
  } catch (err) {
    log('warn', 'ask_history_save_failed', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

function historyHits(words: string[]): SearchHit[] {
  if (!words.length) return []
  const norm = (x: string): string => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return db
    .listAskHistory(HISTORY_LIMIT)
    .filter((e) => {
      const hay = norm(`${e.question} ${e.answer}`)
      return words.every((w) => hay.includes(w))
    })
    .slice(0, 5)
    .map<SearchHit>((e) => ({ source: 'history', title: e.question, snippet: e.answer.replace(/\s+/g, ' ').slice(0, 200), href: `/biblioteca/preguntar?h=${e.id}` }))
}

async function llmStatus(): Promise<AssistantStatus> {
  const llmDir = resolve(config.dataDir, '..', 'llm')
  const installed: AssistantStatus['installed'] = []
  for (const f of await readdir(resolve(llmDir, 'models')).catch(() => [] as string[])) {
    if (!f.endsWith('.gguf')) continue
    const st = await stat(resolve(llmDir, 'models', f)).catch(() => null)
    if (st) installed.push({ file: f, sizeBytes: st.size })
  }
  const active = (await readFile(resolve(llmDir, 'active'), 'utf8').catch(() => '')).trim() || null
  try {
    const r = await fetch(`${config.llmUrl}/v1/models`, { signal: AbortSignal.timeout(1500) })
    if (r.ok) {
      const j = (await r.json()) as { data?: { id?: string }[] }
      return { available: true, model: j.data?.[0]?.id?.split('/').pop() ?? null, busy: asking, installed, active, failure: null }
    }
  } catch {
    // aún cargando o caído
  }
  return { available: false, model: null, busy: asking, installed, active, failure: active ? await llmFailure(llmDir) : null }
}

/** Fallo anotado por el lanzador de la portable/Android (data/llm/server.json) si llama-server se ha cerrado. */
async function llmFailure(llmDir: string): Promise<AssistantStatus['failure']> {
  try {
    const j = JSON.parse(await readFile(resolve(llmDir, 'server.json'), 'utf8')) as { state?: string; reason?: string; detail?: unknown; at?: unknown }
    if (j.state !== 'failed') return null
    const reason = (['library', 'memory', 'model'] as const).find((r) => r === j.reason) ?? 'other'
    return { reason, detail: String(j.detail ?? '').slice(0, 240), at: String(j.at ?? '') }
  } catch {
    return null
  }
}

/** Peso por libro para el asistente: medicina > enciclopedia general > resto (viajes, libros…). */
function bookWeight(href: string): number {
  if (/medicin|wikem|med_/i.test(href)) return 4
  if (/wikipedia_es_all/i.test(href)) return 2
  return 0
}

/**
 * Recupera fuentes para el asistente a partir de PALABRAS CLAVE (sin palabras vacías):
 * hasta 2 protocolos, 2 documentos y 3 artículos ZIM, puntuados por relevancia y sin duplicados.
 */
async function retrieve(question: string, lang: Lang = 'es'): Promise<Source[]> {
  const kw = keywords(question)
  if (!kw.length) return []
  const out: Source[] = []
  const add = (s: Omit<Source, 'n'>): void => {
    // Sin repetir artículo (mismo enlace o mismo título en otra variante del libro).
    if (s.text && !out.some((o) => o.href === s.href || o.title === s.title)) out.push({ ...s, n: out.length + 1 })
  }

  // Protocolos: al menos la mitad de las palabras clave (por raíz) y cerca del mejor resultado
  // (evita traer «Quemaduras» solo porque menciona la hipotermia).
  const minScore = Math.max(1, Math.ceil(kw.length / 2))
  const scored = protocolsFor(lang)
    .map((p) => ({ p, s: relevance(kw, p.title, p.text) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
  const top = scored[0]?.s ?? 0
  scored
    .filter((x) => x.s >= top * 0.75)
    .slice(0, 2)
    .forEach(({ p }) => add({ title: p.title, href: `/emergencias/${p.id}`, source: 'protocol', text: excerpt(p.text, question, 800) }))
  const hasProtocol = out.length > 0

  // Documentos propios (FTS con cualquiera de las palabras).
  try {
    for (const d of db.searchDocsAny(kw, 2)) add({ title: d.title, href: `/biblioteca/doc/${d.id}`, source: 'doc', text: clip(d.snippet.replace(/\[\[|\]\]/g, ''), 500) })
  } catch {
    // índice no disponible
  }

  // Notas propias: lo que el usuario apuntó (p. ej. dónde guardó el agua) también responde preguntas.
  try {
    for (const n of db.searchNotesAny(kw, 1)) add({ title: n.title, href: `/biblioteca/notas?id=${n.id}`, source: 'note', text: clip(n.snippet.replace(/\[\[|\]\]/g, ''), 500) })
  } catch {
    // índice no disponible
  }

  // ZIM: búsqueda por palabras clave en todos los libros y reordenación por relevancia + peso del libro.
  const books = await kiwixBooks()
  if (books.state === 'ok' && books.value.length) {
    const hits = await kiwix.search(searchTerms(question), books.value, 6)
    const ranked = hits
      .map((h, i) => ({ h, s: relevance(kw, h.title, h.snippet) * 2 + bookWeight(h.href) - i * 0.01 }))
      .sort((a, b) => b.s - a.s)
    const seen = new Set<string>()
    let n = 0
    // Contexto corto = respuesta antes en la CPU de la Pi: máx. 4 fuentes en total.
    const maxZim = Math.min(hasProtocol ? 2 : 3, 4 - out.length)
    for (const { h } of ranked) {
      if (n >= maxZim || seen.has(h.href)) continue
      seen.add(h.href)
      let text = ''
      try {
        text = excerpt(await kiwix.articleText(h.href), question, 550)
      } catch {
        text = clip(h.snippet.replace(/\[\[|\]\]/g, ''), 400)
      }
      add({ title: h.bookTitle ? `${h.title} (${h.bookTitle})` : h.title, href: h.href, source: 'zim', text })
      n++
    }
  }
  return out
}

async function ask(question: string, res: ServerResponse, signal: AbortSignal, lang: Lang = 'es'): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  const started = Date.now()
  const sources = await retrieve(question, lang)
  const publicSources: AskSource[] = sources.map(({ text: _t, ...s }) => s)
  sse(res, 'sources', publicSources)
  // Sin fuentes, el modelo responde con su conocimiento general (la pantalla lo avisa); si no está en marcha,
  // se dice que no está en la biblioteca.
  const general = !sources.length
  if (general && !(await llmStatus()).available) {
    const msg = NOT_FOUND[lang]
    sse(res, 'token', msg)
    const ms = Date.now() - started
    sse(res, 'done', { ms, model: false, historyId: saveHistory(question, msg, [], null, ms) })
    res.end()
    return
  }
  if (general) sse(res, 'mode', 'general')
  try {
    const answer = await streamCompletion(config.llmUrl, buildMessages(question, sources, lang), res, signal)
    const ms = Date.now() - started
    // Solo respuestas completas: una pregunta cancelada no se guarda.
    sse(res, 'done', { ms, model: true, historyId: saveHistory(question, answer, publicSources, await activeModel(), ms) })
  } catch (err) {
    if (signal.aborted) sse(res, 'cancelled', {})
    else sse(res, 'error', err instanceof Error ? err.message : 'error del modelo')
  }
  res.end()
}

function safeDocPath(rel: string): string | null {
  const full = resolve(config.docsDir, rel)
  return full.startsWith(resolve(config.docsDir) + sep) ? full : null
}

const RAW_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8', // nunca se sirve HTML de usuario como HTML: se renderiza en iframe aislado
}

/** Notas: tamaño máximo del texto y número máximo (un diario de años cabe de sobra). */
const NOTE_MAX_BYTES = 64 * 1024
const NOTES_LIMIT = 2000

/** Título por defecto: la primera línea con texto (sin marcas de tarea). */
function deriveTitle(body: string): string {
  return body.split('\n').map((l) => l.replace(/^\s*[-*] \[( |x|X)\] /, '').trim()).find(Boolean)?.slice(0, 120) ?? ''
}

/** Valida la entrada de una nota: solo los campos presentes. */
function noteInput(body: Record<string, unknown>): { title?: string; body?: string; pinned?: boolean } | { error: string } {
  const out: { title?: string; body?: string; pinned?: boolean } = {}
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return { error: 'título no válido' }
    out.title = body.title.replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  }
  if (body.body !== undefined) {
    if (typeof body.body !== 'string') return { error: 'texto no válido' }
    if (Buffer.byteLength(body.body) > NOTE_MAX_BYTES) return { error: 'La nota es demasiado larga (máx. 64 KB)' }
    out.body = body.body.replace(/\r\n?/g, '\n')
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return { error: 'pinned debe ser true o false' }
    out.pinned = body.pinned
  }
  return out
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (method === 'GET' && path === '/health') {
    send(res, 200, { status: 'ok', service: 'library', version: VERSION })
    return
  }
  if (method === 'GET' && path === '/status') {
    const docs = db.listDocs()
    const books = await kiwixBooks()
    const body: LibraryStatus = {
      protocols: protocols.length,
      docs: { count: docs.length, searchable: docs.filter((d) => d.searchable).length, lastIndexedAt: db.getMeta('lastIndexedAt') },
      kiwix: books.state === 'ok' ? { state: 'ok', value: { books: books.value.length }, at: books.at } : books,
      pdftotext: pdftotextAvailable,
      docsDir: config.docsDir,
      zim: await zimFiles(),
    }
    send(res, 200, body)
    return
  }
  if (method === 'GET' && path === '/ask/status') {
    send(res, 200, await llmStatus())
    return
  }
  if (path === '/ask/history' && (method === 'GET' || method === 'DELETE')) {
    if (method === 'DELETE') {
      send(res, 200, { deleted: db.clearAskHistory() })
      return
    }
    const body: AskHistory = { enabled: historyEnabled(), limit: HISTORY_LIMIT, items: db.listAskHistory(HISTORY_LIMIT) }
    send(res, 200, body)
    return
  }
  if (method === 'PUT' && path === '/ask/history/settings') {
    const body = await readJson(req)
    if (typeof body.enabled !== 'boolean') {
      send(res, 400, { error: 'enabled debe ser true o false' })
      return
    }
    db.setMeta('ask_history', body.enabled ? 'on' : 'off')
    send(res, 200, { enabled: body.enabled })
    return
  }
  const hist = /^\/ask\/history\/(\d{1,12})$/.exec(path)
  if (hist && (method === 'GET' || method === 'DELETE')) {
    const id = Number(hist[1])
    if (method === 'DELETE') {
      send(res, db.deleteAskHistory(id) ? 200 : 404, { deleted: id })
      return
    }
    const e = db.getAskHistory(id)
    if (!e) send(res, 404, { error: 'not_found' })
    else send(res, 200, e)
    return
  }
  if (method === 'POST' && path === '/ask/cancel') {
    // Un solo usuario en el equipo: cancelar libera el hueco del modelo si una pregunta quedó abandonada.
    const was = asking
    askingAbort?.abort()
    // Responder cuando el hueco ya está libre, para que la siguiente pregunta no reciba 409.
    for (let i = 0; i < 50 && asking; i++) await new Promise((r) => setTimeout(r, 100))
    send(res, 200, { cancelled: was, free: !asking })
    return
  }
  if (method === 'POST' && path === '/ask') {
    const body = await readJson(req)
    const q = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : ''
    if (q.length < 3) {
      send(res, 400, { error: 'Pregunta demasiado corta' })
      return
    }
    if (asking) {
      send(res, 409, { error: 'El asistente está respondiendo otra pregunta', busySeconds: (Date.now() - askingSince) / 1000 })
      return
    }
    asking = true
    askingSince = Date.now()
    const ac = new AbortController()
    askingAbort = ac
    res.on('close', () => ac.abort())
    try {
      await ask(q, res, ac.signal, langOf(req))
    } finally {
      asking = false
      askingAbort = null
      if (!res.writableEnded) res.end()
    }
    return
  }
  if (method === 'GET' && path === '/places/status') {
    await places.refresh(10_000)
    send(res, 200, places.status())
    return
  }
  if (method === 'GET' && path === '/places/search') {
    void places.refresh()
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
    const lat = Number.parseFloat(url.searchParams.get('lat') ?? '')
    const lon = Number.parseFloat(url.searchParams.get('lon') ?? '')
    const near = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)
    const body: PlaceSearch = { status: places.status(), hits: q.length >= 2 ? places.search(q, langOf(req), near, Number.isFinite(limit) ? limit : 20) : [] }
    send(res, 200, body)
    return
  }
  if (method === 'GET' && path === '/books') {
    send(res, 200, await kiwixBooks())
    return
  }
  if (method === 'GET' && path === '/search') {
    const q = url.searchParams.get('q') ?? ''
    if (!q.trim()) {
      send(res, 400, { error: 'empty_query' })
      return
    }
    send(res, 200, await search(q, langOf(req)))
    return
  }
  if (method === 'GET' && path === '/protocols') {
    send(res, 200, protocolsFor(langOf(req)).map(summarize))
    return
  }
  const proto = /^\/protocols\/([a-z0-9-]+)$/.exec(path)
  if (method === 'GET' && proto) {
    const p = protocolsFor(langOf(req)).find((x) => x.id === proto[1])
    if (!p) send(res, 404, { error: 'not_found' })
    else send(res, 200, { ...summarize(p), html: p.html })
    return
  }
  if (method === 'GET' && path === '/docs') {
    send(res, 200, db.listDocs().map(docSummary))
    return
  }
  const doc = /^\/docs\/(\d+)(\/raw)?$/.exec(path)
  if (method === 'GET' && doc) {
    const row = db.getDoc(Number(doc[1]))
    const full = row ? safeDocPath(row.path) : null
    if (!row || !full || !existsSync(full)) {
      send(res, 404, { error: 'not_found' })
      return
    }
    if (doc[2]) {
      const st = await stat(full)
      res.writeHead(200, {
        'content-type': RAW_TYPES[row.kind] ?? 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        // Texto: contexto aislado. PDF: sin 'sandbox' (Chromium bloquea su visor en contexto aislado).
        ...(row.kind === 'pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'" }),
      })
      createReadStream(full).pipe(res)
      return
    }
    let html: string
    if (row.kind === 'md') html = renderMarkdown(await readFile(full, 'utf8'))
    else if (row.kind === 'txt') html = `<pre>${escapeHtml(await readFile(full, 'utf8'))}</pre>`
    else if (row.kind === 'html') html = `<pre>${escapeHtml(htmlToText(await readFile(full, 'utf8')))}</pre>`
    else html = '' // PDF: la UI usa /raw con el visor de Chromium
    send(res, 200, { ...docSummary(row), html })
    return
  }
  if (method === 'POST' && path === '/reindex') {
    pdftotextAvailable = pdftotextPresent() // puede haberse descargado después de arrancar
    if (!indexing) {
      indexing = indexDocs(db, config.docsDir, config.maxDocBytes).finally(() => {
        indexing = null
      })
    }
    send(res, 200, await indexing)
    return
  }
  if (path === '/notes' && (method === 'GET' || method === 'POST')) {
    if (method === 'GET') {
      send(res, 200, db.listNotes())
      return
    }
    const n = noteInput(await readJson(req, NOTE_MAX_BYTES + 4096))
    if ('error' in n) {
      send(res, 400, { error: n.error })
      return
    }
    if (db.listNotes().length >= NOTES_LIMIT) {
      send(res, 409, { error: 'Demasiadas notas: borra alguna antes de crear otra' })
      return
    }
    const title = n.title || deriveTitle(n.body ?? '')
    if (!title) {
      send(res, 400, { error: 'La nota está vacía' })
      return
    }
    send(res, 201, db.createNote({ title, body: n.body ?? '', pinned: n.pinned }))
    return
  }
  const note = /^\/notes\/(\d{1,12})$/.exec(path)
  if (note && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
    const id = Number(note[1])
    if (method === 'GET') {
      const n = db.getNote(id)
      if (!n) send(res, 404, { error: 'not_found' })
      else send(res, 200, n)
      return
    }
    if (method === 'DELETE') {
      send(res, db.deleteNote(id) ? 200 : 404, { deleted: id })
      return
    }
    const n = noteInput(await readJson(req, NOTE_MAX_BYTES + 4096))
    if ('error' in n) {
      send(res, 400, { error: n.error })
      return
    }
    if (n.title === '') n.title = deriveTitle(n.body ?? db.getNote(id)?.body ?? '') || '…'
    const updated = db.updateNote(id, n)
    if (!updated) send(res, 404, { error: 'not_found' })
    else send(res, 200, updated)
    return
  }
  if (method === 'GET' && path === '/favorites') {
    send(res, 200, db.listFavorites())
    return
  }
  // El id llega con encodeURIComponent, que deja sin codificar !'()*~ (títulos como «Hipotermia_(medicina)»).
  const fav = /^\/favorites\/([\w:.\-/%!'()*~]{1,1000})$/.exec(path)
  if (fav && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(fav[1] ?? '')
    if (method === 'DELETE') {
      db.deleteFavorite(id)
      send(res, 200, { ok: true })
      return
    }
    const body = await readJson(req)
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : ''
    const href = typeof body.href === 'string' ? body.href : ''
    // Solo rutas internas: un favorito nunca puede apuntar fuera del equipo.
    if (!title || !/^\/[\w\-/#%.?=&:~+!'()*,;@$]{0,2000}$/.test(href) || href.startsWith('//')) {
      send(res, 400, { error: 'invalid_favorite' })
      return
    }
    db.putFavorite({ id, title, href })
    send(res, 200, { ok: true })
    return
  }
  send(res, 404, { error: 'not_found' })
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const status = (err as { status?: number }).status ?? 500
    if (status === 500) log('error', 'request_failed', { error: err instanceof Error ? err.message : String(err) })
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal_error' : (err as Error).message })
    else res.end()
  })
})
server.requestTimeout = 120_000

async function start(): Promise<void> {
  const loaded = await loadProtocols(config.protocolsDir)
  protocols = loaded.protocols
  for (const e of loaded.errors) log('warn', 'protocol_rejected', { detail: e })
  for (const lang of LANGS) {
    if (lang === 'es') continue
    // Sin carpeta de traducción: ese idioma usa las fichas en español (no es un error).
    if (!existsSync(join(config.protocolsDir, lang))) continue
    const tr = await loadProtocols(join(config.protocolsDir, lang))
    translatedProtocols.set(lang, tr.protocols)
    for (const e of tr.errors) log('warn', 'protocol_rejected', { lang, detail: e })
    log('info', 'protocols_translated', { lang, count: tr.protocols.length })
  }
  pdftotextAvailable = pdftotextPresent()
  // Índice de lugares: se comprueba al arrancar y se reconstruye en segundo plano si cambiaron los mapas.
  void places.refresh(0)
  indexing = indexDocs(db, config.docsDir, config.maxDocBytes)
    .then((r) => log('info', 'indexed', { ...r, skipped: r.skipped.length }))
    .catch((err: unknown) => log('error', 'index_failed', { error: String(err) }))
    .finally(() => {
      indexing = null
    })
  server.listen(config.port, config.host, () =>
    log('info', 'listening', { host: config.host, port: config.port, version: VERSION, protocols: protocols.length }),
  )
}

function shutdown(): void {
  server.close(() => {
    db.close()
    places.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

void start()
