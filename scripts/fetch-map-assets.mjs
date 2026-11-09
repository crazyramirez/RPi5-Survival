#!/usr/bin/env node
/**
 * Descarga (una vez, en el PC) los glifos y sprites de Protomaps basemaps-assets y los
 * copia a apps/frontend/public/map-assets para que el mapa no dependa de ninguna CDN.
 * Fuentes: Noto Sans (SIL OFL 1.1). Uso: node scripts/fetch-map-assets.mjs [--from <dir>]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'apps/frontend/public/map-assets')
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']
const SPRITES = ['dark', 'dark@2x', 'light', 'light@2x']

let src = process.argv[2] === '--from' ? process.argv[3] : null
let tmp = null
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), 'pm-assets-'))
  const zip = join(tmp, 'assets.zip')
  execFileSync('curl', ['-fsSL', '-o', zip, 'https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.zip'], { stdio: 'inherit' })
  execFileSync('tar', ['-xf', zip, '-C', tmp], { stdio: 'inherit' })
  src = join(tmp, 'basemaps-assets-main')
}
if (!existsSync(join(src, 'fonts'))) throw new Error(`No hay fonts/ en ${src}`)
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'sprites/v4'), { recursive: true })
for (const f of FONTS) cpSync(join(src, 'fonts', f), join(out, 'fonts', f), { recursive: true })
cpSync(join(src, 'fonts', 'OFL.txt'), join(out, 'fonts', 'OFL.txt'))
for (const s of SPRITES) for (const ext of ['json', 'png']) cpSync(join(src, 'sprites/v4', `${s}.${ext}`), join(out, 'sprites/v4', `${s}.${ext}`))
if (tmp) rmSync(tmp, { recursive: true, force: true })
console.log(`[map-assets] ${FONTS.length} fuentes y ${SPRITES.length} sprites en ${out}`)
