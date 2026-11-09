#!/usr/bin/env node
/**
 * Genera la guía de emergencia imprimible (HTML + PDF) SIN red, a partir de content/protocols.
 * Mismo marcado y CSS que la página /emergencias/imprimir (apps/frontend/app/assets/css/print-guide.css).
 *
 * Uso:  node scripts/build-emergency-guide.mjs [--size a5|a4] [--out docs/guia-emergencia]
 * PDF:  necesita Chrome/Chromium local (variable CHROME_PATH o rutas habituales). Sin él, solo HTML.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { es } from '../apps/frontend/app/locales/es.ts'
import { escapeHtml } from '../services/library/src/markdown.ts'
import { loadProtocols } from '../services/library/src/protocols.ts'

const root = resolve(import.meta.dirname, '..')
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const size = arg('size', 'a5') === 'a4' ? 'a4' : 'a5'
const out = resolve(root, arg('out', `docs/guia-emergencia-${size}`))
const e = (s) => escapeHtml(String(s))

const { protocols, errors } = await loadProtocols(resolve(root, 'content/protocols'))
for (const err of errors) console.warn(`aviso: ${err}`)
if (!protocols.length) {
  console.error('No hay protocolos válidos en content/protocols')
  process.exit(1)
}

// Agrupados por categoría en orden de aparición y numerados de forma continua (igual que la página).
const groups = new Map()
for (const p of protocols) groups.set(p.category, [...(groups.get(p.category) ?? []), p])
let n = 0
const ordered = [...groups.entries()].map(([category, items]) => ({ category, items: items.map((p) => ({ ...p, n: ++n })) }))
const flat = ordered.flatMap((g) => g.items)
const today = new Date().toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

const css = readFileSync(resolve(root, 'apps/frontend/app/assets/css/print-guide.css'), 'utf8')
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${e(es['ui.print.cover'])} · ${e(es['app.name'])}</title>
<style>
@page { size: ${size.toUpperCase()} portrait; margin: 12mm 12mm 14mm; }
html, body { margin: 0; background: #fff; }
${css}
@media screen { .guide .sheet { max-width: ${size === 'a5' ? '148mm' : '210mm'}; margin: 0 auto 8mm; box-shadow: 0 2px 10px rgb(0 0 0 / 15%); } }
@media print { .guide .sheet { padding: 0; } }
</style></head>
<body><div class="guide ${size}">
<section class="sheet cover"><div>
  <div class="brand">${e(es['app.name'])}</div>
  <h1>${e(es['ui.print.cover'])}</h1>
  <p class="lead">${e(es['ui.print.lead'])}</p>
  <div class="call"><span class="num">112</span><p><strong>${e(es['ui.print.callTitle'])}</strong>${e(es['ui.print.callBody'])}</p></div>
  <p class="disclaimer">${e(es['em.disclaimer'])}</p>
</div>
<dl class="meta">
  <div><dt>${e(es['ui.print.generated'])}</dt><dd>${e(today)}</dd></div>
  <div><dt>${e(es['ui.em.count'])}</dt><dd>${flat.length}</dd></div>
  <div><dt>${e(es['ui.em.categories'])}</dt><dd>${ordered.length}</dd></div>
</dl></section>
<section class="sheet toc"><h2 class="section">${e(es['ui.print.toc'])}</h2>
${ordered.map((g) => `<p class="toc-cat">${e(g.category)}</p><ol>${g.items.map((p) => `<li><span class="n">${p.n}</span><span>${e(p.title)}</span></li>`).join('')}</ol>`).join('\n')}
</section>
${flat
  .map(
    (p) => `<section class="sheet proto">
<header class="p-head"><span class="p-num">${p.n}</span><div><div class="p-cat">${e(p.category)}</div><h3>${e(p.title)}</h3></div><span class="p-112">112</span></header>
<div class="content">${p.html}</div>
<footer class="p-foot"><b>${e(es['ui.print.source'])}</b> ${e(p.sources)} · <b>${e(es['ui.print.reviewed'])}</b> ${e(p.reviewed)}</footer>
</section>`,
  )
  .join('\n')}
</div></body></html>
`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(`${out}.html`, html)
console.log(`HTML: ${out}.html (${flat.length} protocolos, ${ordered.length} categorías)`)

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean)
const chrome = candidates.find((c) => existsSync(c))
if (!chrome) {
  console.warn('Sin Chrome/Chromium: solo se ha generado el HTML (ábrelo e imprime a PDF).')
  process.exit(0)
}
const r = spawnSync(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--password-store=basic', `--print-to-pdf=${out}.pdf`, pathToFileURL(`${out}.html`).href],
  { stdio: 'inherit', timeout: 120_000 },
)
if (r.status !== 0 || !existsSync(`${out}.pdf`)) {
  console.error('Fallo al generar el PDF')
  process.exit(1)
}
console.log(`PDF:  ${out}.pdf`)
