#!/usr/bin/env node
 
/**
 * Datos oficiales de las bibliotecas Kiwix del catálogo → content/catalog-kiwix.json (va en el repositorio y
 * en la release: el equipo los enseña sin Internet en la ficha de cada contenido).
 *
 *   node scripts/fetch-kiwix-meta.mjs
 *
 * Por cada ZIM (y su variante por defecto): resumen, número de artículos e imágenes, fecha de la versión, si
 * trae fotos o vídeos y el icono de 48 px (data URI). Nada se escribe a mano: lo que Kiwix no da, no sale.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8'))
const OPDS = catalog.sources.kiwixCatalog
const BASE = new URL(OPDS).origin
const OUT = join(ROOT, 'content', 'catalog-kiwix.json')

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim()

async function entry(name, flavour) {
  const res = await fetch(`${OPDS}?name=${encodeURIComponent(name)}&count=50`, { signal: AbortSignal.timeout(60_000), redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const xml = await res.text()
  let best = null
  for (const e of xml.split('<entry>').slice(1)) {
    const tag = (t) => unxml(new RegExp(`<${t}>([^<]*)</${t}>`).exec(e)?.[1] ?? '')
    if (tag('name') !== name || tag('flavour') !== (flavour ?? '')) continue
    const row = {
      title: tag('title'),
      summary: tag('summary'),
      language: tag('language'),
      date: tag('updated').slice(0, 10),
      articles: Number(tag('articleCount')) || null,
      media: Number(tag('mediaCount')) || null,
      tags: tag('tags').split(';'),
      icon: /<link rel="http:\/\/opds-spec.org\/image\/thumbnail"\s+href="([^"]+)"/.exec(e)?.[1] ?? null,
    }
    if (!best || row.date > best.date) best = row
  }
  return best
}

async function icon(path) {
  if (!path) return null
  const res = await fetch(new URL(path, BASE), { signal: AbortSignal.timeout(30_000), redirect: 'follow' })
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length && buf.length < 20_000 ? `data:${res.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}` : null
}

const items = {}
let fails = 0
for (const it of catalog.items.filter((i) => i.zim)) {
  try {
    const e = await entry(it.zim.name, it.zim.flavour)
    if (!e) {
      console.warn(`· ${it.id}: no está en el catálogo Kiwix (${it.zim.name}:${it.zim.flavour})`)
      fails++
      continue
    }
    items[it.id] = {
      summary: e.summary || null,
      language: e.language || null,
      date: e.date || null,
      articles: e.articles,
      media: e.media,
      pictures: e.tags.includes('_pictures:yes') ? true : e.tags.includes('_pictures:no') ? false : null,
      videos: e.tags.includes('_videos:yes') ? true : e.tags.includes('_videos:no') ? false : null,
      icon: await icon(e.icon),
    }
    console.log(`✓ ${it.id}: ${e.articles ?? '?'} artículos · ${e.date}`)
  } catch (err) {
    console.warn(`· ${it.id}: ${err.message}`)
    fails++
  }
}

writeFileSync(OUT, `${JSON.stringify({ source: OPDS, fetched: new Date().toISOString().slice(0, 10), items }, null, 1)}\n`)
console.log(`\n${Object.keys(items).length} bibliotecas → ${OUT}${fails ? ` (${fails} sin datos)` : ''}`)
