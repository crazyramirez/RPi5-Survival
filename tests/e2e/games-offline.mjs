#!/usr/bin/env node
/* eslint-disable no-console -- herramienta de diagnóstico */
/**
 * Juegos offline (ADR 0012): abre el portal y cada juego de la copia local en Chromium headless (CDP) y
 * anota lo que no carga. Se lanza EN LA PI con la copia descargada:
 *
 *   node tests/e2e/games-offline.mjs /tmp/games-check [segundos-por-juego]
 *
 * Por cada juego: peticiones fallidas (404, bloqueadas por la CSP = intentos de salir a Internet), errores de
 * consola y excepciones, y una captura <slug>.png. El resumen queda en summary.json.
 * WebGL va por software (SwiftShader): sirve para ver si arranca, no para medir rendimiento.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.argv[2] || 'games-check'
const WAIT_S = Number(process.argv[3] || 20)
const BASE = (process.env.GAMES_URL || 'http://127.0.0.1:8790').replace(/\/$/, '')
const STATE = process.env.GAMES_STATE || '/var/lib/survival-os/games/state.json'
mkdirSync(OUT, { recursive: true })

const games = JSON.parse(readFileSync(STATE, 'utf8')).games ?? []
const chromePath = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find((p) => existsSync(p))
if (!chromePath) throw new Error('Chromium no encontrado (CHROME_PATH)')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'survival-games-'))
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--password-store=basic',
  '--no-first-run', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1024,486', 'about:blank',
])
let targets = null
for (let i = 0; i < 60 && !targets; i++) {
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
  } else if (msg.method) for (const l of listeners) l(msg)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Network.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 486, deviceScaleFactor: 1, mobile: false })

let current = null
const urls = new Map()
listeners.push((m) => {
  if (!current) return
  const p = m.params
  if (m.method === 'Network.requestWillBeSent') urls.set(p.requestId, p.request.url)
  else if (m.method === 'Network.responseReceived' && p.response.status >= 400) current.failed.push(`${p.response.status} ${p.response.url}`)
  else if (m.method === 'Network.loadingFailed' && !p.canceled) {
    const url = urls.get(p.requestId) || '?'
    const external = !url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')
    ;(external ? current.external : current.failed).push(`${p.blockedReason || p.errorText} ${url}`)
  } else if (m.method === 'Runtime.exceptionThrown') current.exceptions.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text).split('\n')[0])
  else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') current.console.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') current.console.push(`${p.entry.text}`.slice(0, 200))
})

async function check(name, url) {
  current = { name, url, failed: [], external: [], exceptions: [], console: [] }
  urls.clear()
  const t0 = Date.now()
  await send('Page.navigate', { url })
  await sleep(WAIT_S * 1000)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  const r = { ...current, seconds: Math.round((Date.now() - t0) / 1000) }
  for (const k of ['failed', 'external', 'exceptions', 'console']) r[k] = [...new Set(r[k])].slice(0, 15)
  const ok = !r.failed.length && !r.external.length && !r.exceptions.length
  console.log(`${ok ? 'OK  ' : 'REVISAR'} ${name}: ${r.failed.length} fallidas, ${r.external.length} externas, ${r.exceptions.length} excepciones, ${r.console.length} errores de consola`)
  current = null
  return r
}

await send('Page.enable')
const results = [await check('_portal', `${BASE}/`)]
for (const slug of games) results.push(await check(slug, `${BASE}/games/${slug}/index.html`))
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
ws.close()
chrome.kill()
await sleep(500)
rmSync(profile, { recursive: true, force: true })
