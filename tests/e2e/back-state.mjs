/* eslint-disable no-console -- informe de pruebas por consola */
/**
 * Volver conserva el estado: biblioteca, emergencias y lector (Chrome/Chromium headless por CDP, sin dependencias).
 *
 * Uso:   node tests/e2e/back-state.mjs [http://127.0.0.1:3000]    (con la app arrancada y contenidos instalados)
 *
 *  1. Emergencias: lista desplazada → ficha desplazada → imprimir → «Atrás» → ficha en el mismo sitio →
 *     «Emergencias» → la misma lista (viva, sin recargar), en el mismo sitio y sin apilar historial.
 *  2. Biblioteca: estantería desplazada → libro → «Biblioteca» → la misma estantería en el mismo sitio.
 *  3. Lector: artículo enlazado y desplazado → otra pantalla → «Atrás» → el mismo artículo en el mismo sitio.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const chromePath = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!chromePath) throw new Error('Chrome no encontrado: define CHROME_PATH')
const profile = mkdtempSync(join(tmpdir(), 'survivelia-back-'))
const port = 9300 + Math.floor(Math.random() * 300)
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--password-store=basic', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
let failed = 0
try {
  let targets
  for (let n = 0; n < 80 && !targets; n++) {
    await sleep(150)
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null)
  }
  if (!targets) throw new Error('Chrome no responde')
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id) {
      const cb = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) cb?.reject(new Error(m.error.message))
      else cb?.resolve(m.result)
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor = async (expr, label = expr) => {
    for (let n = 0; n < 150; n++) {
      if (await evaluate(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return
      await sleep(150)
    }
    throw new Error(`Timeout: ${label}`)
  }
  const check = (ok, label, data) => {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${data !== undefined ? ` ${JSON.stringify(data)}` : ''}`)
  }
  const near = (a, b) => Math.abs(a - b) <= 4
  const router = `document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router`
  const back = `document.querySelector('nav.actions button').click()` // «Atrás» de la barra de acciones

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('survival-os:locale','es');document.cookie='survival-lang=es; path=/'` })
  await send('Page.navigate', { url: `${BASE}/` })
  await waitFor(`document.querySelector('nav.actions')`, 'inicio')
  // Desde Inicio, como una persona: así «Atrás» tiene historial.
  await evaluate(`${router}.push('/emergencias')`)

  // ---------------------------------------------------------------- 1. Emergencias
  await waitFor(`document.querySelectorAll('.page.emergency a[href^="/emergencias/"]').length > 10`, 'lista de emergencias')
  await evaluate(`window.__list = document.querySelector('.page.emergency'); window.__list.scrollTop = 500; true`)
  await sleep(300)
  const listTop = await evaluate(`window.__list.scrollTop`)
  check(listTop > 100, 'emergencias: lista desplazada', listTop)
  const histLen = await evaluate('history.length')
  await evaluate(`[...document.querySelectorAll('.page.emergency a[href^="/emergencias/"]')].find(a => !a.href.includes('imprimir') && a.getBoundingClientRect().top > 0 && a.getBoundingClientRect().top < 600).click()`)
  await waitFor(`document.querySelector('.reader-heading') && document.querySelector('.reader-scroll')`, 'ficha')
  await sleep(500)
  await evaluate(`(() => { const r = document.querySelector('.reader-scroll'); r.scrollTop = Math.min(700, r.scrollHeight - r.clientHeight); return true })()`)
  await sleep(400)
  const fichaTop = await evaluate(`document.querySelector('.reader-scroll').scrollTop`)
  check(fichaTop > 50, 'emergencias: ficha desplazada', { fichaTop, path: await evaluate('location.pathname') })
  await evaluate(`document.querySelector('.reader-print').click()`)
  await waitFor(`location.pathname === '/emergencias/imprimir'`, 'imprimir')
  await sleep(500)
  await evaluate(back)
  await waitFor(`document.querySelector('.reader-scroll')`, 'vuelta a la ficha')
  await sleep(1500)
  check(near(await evaluate(`document.querySelector('.reader-scroll').scrollTop`), fichaTop), 'emergencias: «Atrás» devuelve la ficha a su sitio', fichaTop)
  await evaluate(`document.querySelector('.reader-toolbar .btn, .guide-reader .btn').click()`)
  await waitFor(`location.pathname === '/emergencias' && document.querySelector('.page.emergency')`, 'vuelta a la lista')
  await sleep(1000)
  check(await evaluate(`document.querySelector('.page.emergency') === window.__list`), 'emergencias: la lista sigue viva (no se recarga)')
  check(near(await evaluate(`document.querySelector('.page.emergency').scrollTop`), listTop), 'emergencias: la lista vuelve a su sitio', listTop)
  check((await evaluate('history.length')) <= histLen + 2, 'emergencias: «Emergencias» es «Atrás» (no apila historial)')

  // ---------------------------------------------------------------- 2. Biblioteca
  await evaluate(`${router}.push('/biblioteca')`)
  await waitFor(`document.querySelectorAll('.page.lib a[href^="/biblioteca/leer"]').length > 0 && document.querySelector('.page.lib').scrollHeight > document.querySelector('.page.lib').clientHeight + 300`, 'estantería')
  await evaluate(`window.__lib = document.querySelector('.page.lib'); window.__lib.scrollTop = Math.min(400, window.__lib.scrollHeight - window.__lib.clientHeight); true`)
  await sleep(300)
  const libTop = await evaluate(`window.__lib.scrollTop`)
  check(libTop > 0, 'biblioteca: estantería desplazada', libTop)
  await evaluate(`[...document.querySelectorAll('.page.lib a[href^="/biblioteca/leer"]')].find(a => a.getBoundingClientRect().top > 0 && a.getBoundingClientRect().top < 600).click()`)
  await waitFor(`location.pathname === '/biblioteca/leer' && document.querySelector('.reader iframe')`, 'lector')
  await sleep(1500)
  await evaluate(`[...document.querySelectorAll('.reader .bar .btn')][0].click()`)
  await waitFor(`location.pathname === '/biblioteca' && document.querySelector('.page.lib')`, 'vuelta a la biblioteca')
  await sleep(1000)
  check(await evaluate(`document.querySelector('.page.lib') === window.__lib`), 'biblioteca: sigue viva (no se recarga)')
  check(near(await evaluate(`document.querySelector('.page.lib').scrollTop`), libTop), 'biblioteca: vuelve a su sitio', libTop)

  // ---------------------------------------------------------------- 3. Lector: artículo enlazado y desplazado
  // Documento del artículo: el del visor de Kiwix (iframe interno) o el propio iframe si es un documento suelto.
  const doc = `(() => { const d = document.querySelector('.reader iframe')?.contentDocument; return d?.getElementById('content_iframe')?.contentDocument ?? d })()`
  const win = `${doc}?.defaultView`
  const books = await evaluate(`[...document.querySelectorAll('.page.lib a[href^="/biblioteca/leer"]')].map(a => a.getAttribute('href'))`)
  const kinds = [books.filter((h) => h.includes('%2Fviewer')).sort((a, b) => Number(/wiki|ifixit/i.test(b)) - Number(/wiki|ifixit/i.test(a)))[0], books.find((h) => h.includes('%2Fcontent%2F'))].filter(Boolean)
  for (const book of kinds) {
    const kind = book.includes('%2Fviewer') ? 'visor Kiwix' : 'documento suelto'
    await evaluate(`${router}.push(${JSON.stringify(book)})`)
    await waitFor(`${doc}?.readyState === 'complete' && ${doc}.querySelectorAll('a[href]').length > 10`, `${kind}: portada`)
    await sleep(1000)
    const first = await evaluate(`${doc}.location.href`)
    // Seguir un enlace a otro artículo dentro del libro.
    await evaluate(`(() => { const d = ${doc}; const a = [...d.querySelectorAll('a[href]')].find(a => { const u = new URL(a.href); return u.origin === location.origin && (u.pathname.endsWith('/viewer') ? u.hash.length > 1 : u.pathname !== d.location.pathname && (u.pathname.includes('/A/') || u.pathname.includes('/content/'))) && !['.pdf', '.png', '.jpg', '.jpeg', '.svg', '.webp'].some((x) => u.pathname.toLowerCase().endsWith(x)) }); if (!a) throw new Error('sin enlace en ' + d.location.href + ': ' + [...d.querySelectorAll('a[href]')].filter((x) => x.href.startsWith(location.origin)).slice(0, 6).map((x) => x.href).join(' ')); a.click(); return a.href })()`)
    await waitFor(`${doc}?.location.href !== ${JSON.stringify(first)} && ${doc}.readyState === 'complete'`, `${kind}: artículo enlazado`)
    await sleep(1500)
    const article = await evaluate(`${doc}.location.href`)
    const u = await evaluate(`new URLSearchParams(location.search).get('u')`)
    check(u !== new URLSearchParams(book.split('?')[1]).get('u'), `${kind}: la URL sigue al artículo abierto`, u)
    await evaluate(`${win}.scrollTo(0, Math.min(1500, ${doc}.documentElement.scrollHeight - ${win}.innerHeight)); true`)
    await sleep(600)
    const articleY = await evaluate(`${win}.scrollY`)
    check(articleY > 100, `${kind}: artículo desplazado`, articleY)
    // Otra pantalla (como un PDF enlazado, que abre el visor) y «Atrás».
    await evaluate(`${router}.push('/emergencias')`)
    await waitFor(`location.pathname === '/emergencias'`, 'otra pantalla')
    await sleep(500)
    await evaluate(back)
    await waitFor(`location.pathname === '/biblioteca/leer' && ${doc}?.readyState === 'complete' && ${doc}.location.href !== 'about:blank'`, `${kind}: vuelta al lector`)
    await sleep(2500)
    check((await evaluate(`${doc}.location.href`)) === article, `${kind}: vuelve al artículo enlazado, no a la portada`, article)
    check(near(await evaluate(`${win}.scrollY`), articleY), `${kind}: el artículo vuelve a su sitio`, articleY)
  }
  check(kinds.length === 2, 'probados los dos tipos de libro', kinds.length)

  check(!errors.length, 'sin errores JS', errors.slice(0, 3))
} catch (e) {
  failed++
  console.log(`FAIL ${e.message}`)
} finally {
  ws?.close()
  chrome.kill()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // perfil en uso un instante más
  }
}
console.log(failed ? `${failed} fallo(s)` : 'Todo correcto')
process.exit(failed ? 1 : 0)
