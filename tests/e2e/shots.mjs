#!/usr/bin/env node
/* eslint-disable no-console -- herramienta de documentación */
/**
 * Capturas del README (docs/screenshots/) con Chromium headless por CDP, sin dependencias.
 * Se lanza EN LA PI, con la release en marcha, para que se vean datos reales:
 *
 *   node tests/e2e/shots.mjs /tmp/shots [http://127.0.0.1:3000]
 *
 * Privacidad (el repositorio es público):
 *  - el mapa se abre en Madrid (`/mapas?lat=…`), nunca en la posición del equipo; el marcador LoRa se oculta;
 *  - no se capturan Navegación ni Malla (posiciones y nodos de terceros);
 *  - en Comunicaciones se difuminan direcciones IP y nombres de red; el historial del asistente se oculta.
 * Revisa SIEMPRE las imágenes antes de publicarlas.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.argv[2] || 'shots'
const BASE = (process.argv[3] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const QUESTION = process.env.SHOTS_QUESTION || '¿Cómo potabilizo agua de un río si no tengo filtro?'
mkdirSync(OUT, { recursive: true })

const chromePath = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!chromePath) throw new Error('Chromium no encontrado (CHROME_PATH)')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Pasarela pública de pruebas (vista del móvil conectado al AP), solo en loopback.
const gw = spawn(process.execPath, [process.env.GATEWAY || new URL('../../scripts/public-gateway.mjs', import.meta.url).pathname], {
  env: { ...process.env, PUBLIC_HOST: '127.0.0.2', PUBLIC_PORT: '8099' },
  stdio: 'ignore',
})

const profile = mkdtempSync(join(tmpdir(), 'survival-shots-'))
const port = 9300 + Math.floor(Math.random() * 500)
// WebGL por software (SwiftShader): el modo headless no usa la GPU y MapLibre necesita WebGL2.
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--password-store=basic', '--no-first-run', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'])
let targets = null
for (let i = 0; i < 60 && !targets; i++) {
  await sleep(250)
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null)
}
const ws = new globalThis.WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
await send('Page.enable')
await send('Runtime.enable')

const PRIVACY_CSS = `
  .lora-marker, aside.hist { display: none !important; }
  .shot-blur { filter: blur(5px) !important; }
`
/** Difumina cualquier texto con forma de dirección IPv4/IPv6 o MAC (LAN del equipo). */
function blurAddresses() {
  const re = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?\b|\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){3,7}\b/i
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const hits = []
  while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue) && walker.currentNode.parentElement) hits.push(walker.currentNode.parentElement)
  hits.forEach((el) => el.classList.add('shot-blur'))
  return hits.length
}
const BLUR_ADDRESSES = `(${blurAddresses.toString()})()`

async function view(mobile) {
  await send('Emulation.setDeviceMetricsOverride', mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
}

async function open(url, waitMs = 3000) {
  await send('Page.navigate', { url })
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    if (await evaluate(`!!document.querySelector('#__nuxt main, #__nuxt .shell')`)) break
  }
  await sleep(waitMs)
  await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(PRIVACY_CSS)}; document.head.appendChild(s) })()`)
}

async function shot(name) {
  await evaluate(BLUR_ADDRESSES)
  await sleep(300)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log('✓', name)
}



try {
  await view(false)
  await open(`${BASE}/`)
  await shot('inicio')
  await open(`${BASE}/emergencias`)
  await shot('emergencias')
  await open(`${BASE}/emergencias/rcp-adulto`)
  await shot('protocolo')
  await open(`${BASE}/biblioteca`)
  await shot('biblioteca')
  const book = await evaluate(`[...document.querySelectorAll('a.book')].map((a) => a.getAttribute('href')).find((h) => /wikipedia/i.test(h)) ?? document.querySelector('a.book')?.getAttribute('href') ?? null`)
  if (book) {
    await open(BASE + book, 6000)
    await shot('lector')
  }
  await open(`${BASE}/mapas?lat=40.4168&lon=-3.7038&z=15`, 15000)
  await shot('mapa')
  await open(`${BASE}/sistema`, 4000)
  await shot('sistema')
  await open(`${BASE}/sistema/mantenimiento`, 4000)
  await shot('mantenimiento')
  await open(`${BASE}/boveda`)
  await shot('boveda')
  await open(`${BASE}/comunicaciones`)
  await shot('comunicaciones')

  // Asistente: pregunta real al modelo local (en la Pi tarda ~1–2 min).
  await open(`${BASE}/biblioteca/preguntar`)
  const asked = await evaluate(`(() => {
    const i = document.querySelector('.composer input'); if (!i) return false
    i.value = ${JSON.stringify(QUESTION)}; i.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.composer').requestSubmit(); return true })()`)
  if (asked) {
    for (let i = 0; i < 100; i++) {
      await sleep(3000)
      if (await evaluate(`!!document.querySelector('.answer-foot')`)) break
    }
    await evaluate(`document.querySelector('.answer')?.scrollIntoView({ block: 'start' })`)
    await shot('asistente')
  }

  // Vista pública: un móvil conectado al punto de acceso del equipo.
  await view(true)
  await open('http://127.0.0.2:8099/')
  await shot('movil-inicio')
  await open('http://127.0.0.2:8099/emergencias/rcp-adulto')
  await shot('movil-protocolo')
} finally {
  ws.close()
  chrome.kill()
  gw.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}
