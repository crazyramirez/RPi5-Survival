#!/usr/bin/env node
/**
 * Copia a public/pdfjs/ lo que el visor de PDF integrado (pdf.js) carga en tiempo de ejecución, para servirlo
 * desde el propio equipo (sin CDN): worker, fuentes estándar, CMaps, decodificadores WebAssembly (JPEG 2000,
 * JBIG2 y color) con su alternativa en JS, y perfiles ICC. No se copia quickjs-eval: los PDF no ejecutan scripts.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('pdfjs-dist/package.json', { paths: [resolve(import.meta.dirname, '../apps/frontend')] }))
const out = resolve(import.meta.dirname, '../apps/frontend/public/pdfjs')
rmSync(out, { recursive: true, force: true })

function copyDir(from, to, keep = () => true) {
  mkdirSync(to, { recursive: true })
  let n = 0
  for (const f of readdirSync(from)) {
    if (!keep(f)) continue
    copyFileSync(join(from, f), join(to, f))
    n++
  }
  return n
}

mkdirSync(out, { recursive: true })
copyFileSync(join(dist, 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'))
const fonts = copyDir(join(dist, 'standard_fonts'), join(out, 'standard_fonts'))
const cmaps = copyDir(join(dist, 'cmaps'), join(out, 'cmaps'))
const wasm = copyDir(join(dist, 'wasm'), join(out, 'wasm'), (f) => !f.startsWith('quickjs') && (/\.wasm$|_fallback\.js$|^LICENSE/.test(f)))
const iccs = copyDir(join(dist, 'iccs'), join(out, 'iccs'))
console.log(`[pdfjs] worker, ${fonts} fuentes, ${cmaps} cmaps, ${wasm} wasm, ${iccs} icc → ${out}`)
