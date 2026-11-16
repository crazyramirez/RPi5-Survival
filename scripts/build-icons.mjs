#!/usr/bin/env node
/**
 * Iconos de la web (ADR 0019): favicon y manifest para que la ventana de la app (Chrome/Edge --app en la
 * portable, Chromium en la Pi) muestre la brújula de Survival OS y no el icono del navegador. Mismo dibujo que
 * los lanzadores (portable/icon.mjs). Los ficheros generados se guardan en el repositorio:
 *   node scripts/build-icons.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeIco, makeIconPng } from '../portable/icon.mjs'

const pub = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'apps', 'frontend', 'public')
writeFileSync(join(pub, 'favicon.ico'), makeIco([16, 32, 48, 64]))
writeFileSync(join(pub, 'icon-192.png'), makeIconPng(192))
writeFileSync(join(pub, 'icon-512.png'), makeIconPng(512))
writeFileSync(join(pub, 'manifest.webmanifest'), `${JSON.stringify({
  name: 'Survival OS',
  short_name: 'Survival OS',
  start_url: '/',
  display: 'standalone',
  background_color: '#0f1412',
  theme_color: '#0f1412',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2)}\n`)
console.log(`Iconos escritos en ${pub}`)
