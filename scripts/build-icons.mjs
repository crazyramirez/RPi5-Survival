#!/usr/bin/env node
/**
 * Iconos de la web (ADR 0019): favicon y manifest para que la ventana de la app (Chrome/Edge --app en la
 * portable, Chromium en la Pi) muestre la brújula de Survivelia OS y no el icono del navegador. Mismo dibujo que
 * los lanzadores (portable/icon.mjs). Los ficheros generados se guardan en el repositorio:
 *   node scripts/build-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICON_BG, makeIco, makeIconPng } from '../portable/icon.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(repo, 'apps', 'frontend', 'public')
writeFileSync(join(pub, 'favicon.ico'), makeIco([16, 32, 48, 64]))
writeFileSync(join(pub, 'icon-192.png'), makeIconPng(192))
writeFileSync(join(pub, 'icon-512.png'), makeIconPng(512))
writeFileSync(join(pub, 'manifest.webmanifest'), `${JSON.stringify({
  name: 'Survivelia OS',
  short_name: 'Survivelia',
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

// Android: icono clásico (antes de Android 8) e icono adaptativo (fondo + brújula en primer plano + monocromo para
// los iconos temáticos de Android 13). Sin el adaptativo, Android 8+ encoge el PNG dentro de un marco blanco.
const res = join(repo, 'android', 'app', 'src', 'main', 'res')
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, f] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${d}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ic_launcher.png'), makeIconPng(Math.round(48 * f)))
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), makeIconPng(Math.round(108 * f), { layer: 'foreground' }))
}
mkdirSync(join(res, 'mipmap-anydpi-v26'), { recursive: true })
writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por scripts/build-icons.mjs: icono adaptativo (Android 8+), sin marco blanco. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`)
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por scripts/build-icons.mjs. -->
<resources>
    <color name="ic_launcher_background">${ICON_BG}</color>
</resources>
`)
console.log(`Iconos de Android escritos en ${res}`)
