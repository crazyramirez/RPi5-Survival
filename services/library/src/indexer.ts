import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import type { DocKind } from '@survival-os/shared-types'
import type { LibraryDb } from './db.ts'
import { htmlToText, markdownToText, parseFrontMatter } from './markdown.ts'

const KINDS: Record<string, DocKind> = { '.md': 'md', '.markdown': 'md', '.txt': 'txt', '.html': 'html', '.htm': 'html', '.pdf': 'pdf' }

export interface IndexReport {
  scanned: number
  added: number
  updated: number
  removed: number
  skipped: { path: string; reason: string }[]
  durationMs: number
}

async function walk(dir: string, root = dir, depth = 0): Promise<string[]> {
  if (depth > 8) return []
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, root, depth + 1)))
    else if (e.isFile() && KINDS[extname(e.name).toLowerCase()]) out.push(p)
  }
  return out
}

export function pdfToText(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('pdftotext', ['-q', '-enc', 'UTF-8', '-l', '500', file, '-'], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : String(stdout)),
    )
  })
}

export function titleFor(kind: DocKind, raw: string, file: string): string {
  if (kind === 'md') {
    const { meta, body } = parseFrontMatter(raw)
    if (meta.title) return meta.title
    const h = /^#{1,3}\s+(.+)$/m.exec(body)
    if (h?.[1]) return h[1].trim()
  }
  if (kind === 'html') {
    const t = /<title[^>]*>([^<]+)<\/title>/i.exec(raw)
    if (t?.[1]) return htmlToText(t[1])
  }
  return basename(file, extname(file)).replace(/[_-]+/g, ' ')
}

/**
 * Indexación incremental: solo procesa ficheros nuevos o modificados (tamaño/mtime).
 * Pensada para lotes pequeños en la Pi; las colecciones grandes se indexan en el PC.
 */
export async function indexDocs(db: LibraryDb, docsDir: string, maxBytes: number): Promise<IndexReport> {
  const started = Date.now()
  const report: IndexReport = { scanned: 0, added: 0, updated: 0, removed: 0, skipped: [], durationMs: 0 }
  const files = await walk(docsDir)
  const known = new Map(db.listDocs().map((d) => [d.path, d]))
  const seen = new Set<string>()

  for (const file of files) {
    const rel = relative(docsDir, file).split(sep).join('/')
    seen.add(rel)
    report.scanned++
    const st = await stat(file)
    if (st.size > maxBytes) {
      report.skipped.push({ path: rel, reason: 'demasiado grande' })
      continue
    }
    const prev = known.get(rel)
    if (prev && prev.size === st.size && prev.mtime_ms === Math.floor(st.mtimeMs)) continue

    const kind = KINDS[extname(file).toLowerCase()] as DocKind
    let text: string | null
    let title: string
    if (kind === 'pdf') {
      text = await pdfToText(file)
      title = titleFor(kind, '', file)
      if (text === null) report.skipped.push({ path: rel, reason: 'sin texto extraíble (pdftotext ausente o PDF escaneado)' })
    } else {
      const raw = await readFile(file, 'utf8')
      title = titleFor(kind, raw, file)
      text = kind === 'md' ? markdownToText(raw) : kind === 'html' ? htmlToText(raw) : raw
    }
    db.upsertDoc(
      { path: rel, title, kind, size: st.size, mtime_ms: Math.floor(st.mtimeMs), searchable: text ? 1 : 0 },
      text ?? '',
    )
    if (prev) report.updated++
    else report.added++
  }

  for (const path of known.keys()) {
    if (!seen.has(path)) {
      db.removeDoc(path)
      report.removed++
    }
  }
  report.durationMs = Date.now() - started
  db.setMeta('lastIndexedAt', new Date().toISOString())
  return report
}
