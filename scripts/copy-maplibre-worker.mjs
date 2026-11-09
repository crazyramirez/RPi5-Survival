#!/usr/bin/env node
/** Copia el worker de MapLibre (módulo ES + código compartido) a public/ para servirlo localmente. */
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('maplibre-gl/package.json', { paths: [resolve(import.meta.dirname, '../apps/frontend')] }))
const out = resolve(import.meta.dirname, '../apps/frontend/public/map-assets/maplibre')
mkdirSync(out, { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(dist, 'dist', f), join(out, f))
console.log(`[maplibre] worker copiado a ${out}`)
