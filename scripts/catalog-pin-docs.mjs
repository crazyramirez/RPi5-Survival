#!/usr/bin/env node
/**
 * Fija manuales PDF en el catálogo (ADR 0015): descarga cada documento (o cada parte), comprueba que
 * es un PDF real y calcula su SHA-256. Herramienta de mantenimiento, se ejecuta en el PC.
 *
 *   node scripts/catalog-pin-docs.mjs <investigacion.json>... [--out docs-pinned.json] [--cache .data/docs-cache]
 *
 * Entrada: [{ id, title, publisher, lang, url, bytes, license, licenseUrl, priority, description,
 *             parts?: [{ title, url }] }]
 * Salida: elementos de catálogo kind "doc" listos para content/catalog.json.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args.splice(i, 2)[1] : d
}
const out = opt('--out', 'docs-pinned.json')
const cache = opt('--cache', '.data/docs-cache')
const inputs = args
mkdirSync(cache, { recursive: true })

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'parte'

async function fetchPdf(url, dest) {
  if (!existsSync(dest)) {
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (SurvivalOS catalog pinning)' }, signal: AbortSignal.timeout(300_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const part = `${dest}.part`
        const w = createWriteStream(part)
        for await (const c of res.body) if (!w.write(c)) await new Promise((r) => w.once('drain', r))
        await new Promise((r) => w.end(r))
        renameSync(part, dest)
        break
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
      }
    }
    if (!existsSync(dest)) throw lastErr
  }
  const buf = readFileSync(dest)
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`no es un PDF: ${url}`)
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: statSync(dest).size }
}

const items = []
const failed = []
for (const file of inputs) {
  for (const d of JSON.parse(readFileSync(file, 'utf8'))) {
    try {
      const doc = { url: d.url }
      if (Array.isArray(d.parts) && d.parts.length > 1) {
        doc.parts = []
        let n = 0
        for (const p of d.parts) {
          n++
          const name = `${String(n).padStart(2, '0')}-${slug(p.title ?? `parte-${n}`)}.pdf`
          const { sha256, bytes } = await fetchPdf(p.url, join(cache, `${d.id}--${name}`))
          doc.parts.push({ file: name, url: p.url, sha256, bytes, title: p.title ?? null })
          process.stdout.write('.')
        }
        doc.bytes = doc.parts.reduce((a, p) => a + p.bytes, 0)
        delete doc.url
      } else {
        const name = `${d.id}.pdf`
        Object.assign(doc, { file: name }, await fetchPdf(d.url, join(cache, name)))
      }
      items.push({
        id: d.id,
        kind: 'doc',
        group: 'manuales',
        lang: d.lang,
        priority: d.priority ?? 3,
        default: d.default ?? true,
        doc,
        approxBytes: doc.bytes,
        license: d.license,
        licenseUrl: d.licenseUrl,
        publisher: d.publisher,
        title: d.title,
        description: d.description,
      })
      process.stdout.write(`\nOK ${d.id} (${(doc.bytes / 1048576).toFixed(1)} MiB)\n`)
    } catch (err) {
      failed.push({ id: d.id, error: String(err instanceof Error ? err.message : err) })
      process.stdout.write(`\nFALLO ${d.id}: ${err instanceof Error ? err.message : err}\n`)
    }
  }
}
writeFileSync(out, JSON.stringify({ items, failed }, null, 2))
console.log(`\n${items.length} fijados, ${failed.length} fallidos → ${out}`)
