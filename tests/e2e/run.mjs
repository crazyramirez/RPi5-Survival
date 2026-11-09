#!/usr/bin/env node
/* eslint-disable no-console -- informe de pruebas por consola */
/**
 * Pruebas E2E sin dependencias nuevas: Chrome/Chromium headless por CDP (paquete `ws`, ya presente).
 *
 * Uso:   npm run e2e -- http://127.0.0.1:3000      (con la app arrancada: `npm run dev` o la release)
 *
 * Por pantalla (1024×600, táctil):
 *  - sin excepciones JS ni errores de consola;
 *  - ninguna petición a hosts que no sean loopback (offline de verdad);
 *  - sin desbordamiento horizontal;
 *  - objetivos táctiles visibles ≥ 44 px (botones y enlaces con aspecto de botón);
 *  - título h1 presente.
 * Además: un toque en la baldosa «Sistema» navega y un arrastre táctil desplaza la página.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WebSocket nativo de Node ≥ 22: sin dependencias, se puede copiar este único fichero a la Pi.
if (typeof globalThis.WebSocket !== 'function') {
  console.error('Hace falta Node ≥ 22 (WebSocket nativo)')
  process.exit(2)
}
/** Si se define, guarda una captura PNG 1024×600 de cada pantalla en ese directorio. */
const SHOTS = process.env.E2E_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const BASE = (process.argv[2] || process.env.E2E_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
/**
 * E2E_MOBILE=1: móvil conectado al punto de acceso (390×844, táctil). Solo las rutas de la vista pública y,
 * además, abre un libro en el lector y mide el desbordamiento dentro de sus iframes (artículo de Kiwix).
 * Lánzalo contra la URL PÚBLICA: contra 127.0.0.1:3000 la app se ve como kiosco (loopback = pantalla local)
 * y los resultados no representan al móvil. Sin encender el AP, en la Pi o en el PC:
 *   PUBLIC_HOST=127.0.0.2 PUBLIC_PORT=8099 node scripts/public-gateway.mjs      (en el PC contra `nuxt dev`
 *   añade PUBLIC_GATEWAY_DEV=1 NITRO_PORT=<puerto de dev>)
 *   E2E_MOBILE=1 node tests/e2e/run.mjs http://127.0.0.2:8099
 */
const MOBILE = process.env.E2E_MOBILE === '1'
const VIEW = MOBILE ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false }
const PUBLIC_ROUTES = ['/', '/mapas', '/biblioteca', '/emergencias', '/emergencias/rcp-adulto', '/emergencias/imprimir']
const ALL_ROUTES = [
  '/',
  '/mapas',
  '/navegacion',
  '/biblioteca',
  '/biblioteca/preguntar',
  '/emergencias',
  '/emergencias/imprimir',
  '/boveda',
  '/comunicaciones',
  '/malla',
  '/herramientas',
  '/sistema',
  '/sistema/mantenimiento',
]
const ROUTES = MOBILE ? PUBLIC_ROUTES : ALL_ROUTES
const MIN_TOUCH = 44

const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!chromePath) {
  console.error('Chrome/Chromium no encontrado (define CHROME_PATH)')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'survival-e2e-'))
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--password-store=basic',
  '--no-first-run',
  `--window-size=${VIEW.width},${VIEW.height}`,
  'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 40 && !targets; i++) {
  await sleep(250)
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null)
}
const ws = new globalThis.WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let seq = 0
const pending = new Map()
const listeners = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method) listeners.forEach((l) => l(msg))
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value

await send('Emulation.setDeviceMetricsOverride', VIEW)
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

let errors = []
let external = []
listeners.push((m) => {
  const viteNoise = (t) => /\[vite\]|Vite server|@vite\/client/.test(t || '') // solo en `nuxt dev` tras la pasarela de pruebas
  if (m.method === 'Runtime.exceptionThrown' && !viteNoise(m.params.exceptionDetails.exception?.description)) errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !viteNoise(m.params.args.map((a) => a.value ?? a.description).join(' '))) errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    if (/^(https?|wss?):/.test(u)) {
      const host = new URL(u).hostname
      // Local = loopback o el propio host bajo prueba (p. ej. 10.42.0.1 del punto de acceso).
      if (!['127.0.0.1', 'localhost', '[::1]', '::1', new URL(BASE).hostname].includes(host)) external.push(u)
    }
  }
})

async function open(path) {
  errors = []
  external = []
  await send('Page.navigate', { url: BASE + path })
  // Espera a que Nuxt monte y lleguen los datos (los sondeos son de 5–10 s; basta con el primer ciclo).
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    if (await evaluate(`!!document.querySelector('#__nuxt .shell, #__nuxt main, #__nuxt > *')`)) break
  }
  await sleep(2500)
}

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth
  // Documento y contenedores que se desplazan (la app desplaza .page, no el documento).
  const scrollers = [document.documentElement, ...document.querySelectorAll('.page, .reader, main, .content')]
  const wide = scrollers.filter((el) => el.scrollWidth > el.clientWidth + 1)
  // Además, cualquier elemento visible que se salga por la derecha del viewport.
  const outside = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.chips, .favs-track, [class*=scroll]')
  }).slice(0, 4).map((el) => (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ' →' + Math.round(el.getBoundingClientRect().right))
  const overflow = wide.length > 0 || outside.length > 0
  const small = []
  for (const el of document.querySelectorAll('button, a.btn, [role=button], .btn')) {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue
    if (el.closest('[aria-hidden=true], .no-print')) continue
    if (Math.min(r.width, r.height) < ${MIN_TOUCH}) small.push((el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40) + ' ' + Math.round(r.width) + '×' + Math.round(r.height))
  }
  return { overflow, scrollWidth: wide.map((el) => (el.className || el.tagName) + ' ' + el.scrollWidth + '>' + el.clientWidth).join(', ') + (outside.length ? ' | fuera: ' + outside.join(', ') : ''), h1: !!document.querySelector('h1'), small: [...new Set(small)].slice(0, 8) }
})()`

const results = []
let failed = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log(`E2E contra ${BASE}`)
for (const route of ROUTES) {
  console.log(route)
  await open(route)
  const a = await evaluate(AUDIT)
  if (SHOTS) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(SHOTS, `${route === '/' ? 'inicio' : route.slice(1).replace(/\//g, '-')}.png`), Buffer.from(data, 'base64'))
  }
  check('sin errores JS', errors.length === 0, errors.slice(0, 3).join(' | '))
  check('sin peticiones externas', external.length === 0, external.slice(0, 3).join(' '))
  check('sin desbordamiento horizontal', !a.overflow, a.overflow ? a.scrollWidth : '')
  check(`objetivos táctiles ≥ ${MIN_TOUCH}px`, a.small.length === 0, a.small.join(', '))
  if (route !== '/') check('título h1', a.h1)
}

if (MOBILE) {
  console.log('lector (móvil): todos los libros')
  await open('/biblioteca')
  const books = await evaluate(`[...document.querySelectorAll('a.book')].map((a) => ({ href: a.getAttribute('href'), title: a.querySelector('strong')?.textContent?.trim() ?? a.getAttribute('href') }))`)
  if (!books.length) check('hay libros para abrir el lector', false, 'ningún libro en /biblioteca')
  // Lo que se sale de la pantalla en cualquier documento del lector. Cuenta también lo recortado por
  // overflow:hidden (eso es contenido cortado); descarta lo que está dentro de un bloque con su propio
  // desplazamiento horizontal (tablas anchas), que es correcto.
  const READER_AUDIT = `(() => {
    const out = []
    const walk = (win, name) => {
      let doc
      try { doc = win.document } catch { return }
      if (!doc?.body) return
      const vw = win.innerWidth
      const scrollsX = (el) => {
        for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
          const ox = win.getComputedStyle(p).overflowX
          if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true
        }
        return false
      }
      const bad = []
      for (const el of doc.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height || r.right <= vw + 2 || r.left >= vw) continue
        const cs = win.getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue
        if (scrollsX(el)) continue
        bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' w' + Math.round(r.width) + ' →' + Math.round(r.right))
      }
      out.push({ name, vw, n: bad.length, sample: bad.slice(0, 4) })
      for (const f of doc.querySelectorAll('iframe')) walk(f.contentWindow, name + ' > ' + (f.id || 'iframe'))
    }
    walk(window, 'app')
    return out
  })()`
  for (const b of books) {
    await open(b.href)
    await sleep(4000) // el visor de Kiwix carga el artículo en un iframe interno
    const r = await evaluate(READER_AUDIT)
    const worst = r.filter((f) => f.n > 0)
    check(`lector «${b.title}»: nada se sale por la derecha`, worst.length === 0, worst.map((f) => `${f.name}: ${f.n} (${f.sample.join(', ')})`).join(' | '))
    if (SHOTS) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      const slug = b.title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      writeFileSync(join(SHOTS, `leer-${slug}.png`), Buffer.from(data, 'base64'))
    }
  }
  ws.close()
  chrome.kill()
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500)
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas (móvil)`)
  process.exit(failed ? 1 : 0)
}

// Toque en la baldosa «Sistema» → navega.
console.log('interacción táctil')
await open('/')
const tile = await evaluate(`(() => { const a = [...document.querySelectorAll('a.tile')].find(e => e.getAttribute('href') === '/sistema'); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
if (tile) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tile.x, y: tile.y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1200)
}
check('toque en baldosa navega a /sistema', (await evaluate('location.pathname')) === '/sistema')

// Arrastre táctil vertical en /sistema → la página se desplaza.
await open('/sistema')
const before = await evaluate(`document.querySelector('.page')?.scrollTop ?? -1`)
// Gesto táctil real (inicio, movimientos, fin) sobre el contenido desplazable.
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 460 }] })
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500, y: 460 - i * 35 }] })
  await sleep(16)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(800)
const after = await evaluate(`document.querySelector('.page')?.scrollTop ?? -1`)
check('arrastre táctil desplaza la página', after > before, `${before} → ${after}`)

ws.close()
chrome.kill()
setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500)
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`)
process.exit(failed ? 1 : 0)
