#!/usr/bin/env node
/**
 * Survivelia OS portable (ADR 0014): arranca los servicios en loopback, abre la interfaz en una
 * ventana propia del navegador y lo cierra todo al cerrar esa ventana (o con «Cerrar Survivelia OS»).
 *
 * Estructura de la carpeta:
 *   <raíz>/app/        web (Nuxt) + servicios + contenido   (solo lectura)
 *   <raíz>/runtime/    Node por sistema (y kiwix-serve si se añade)
 *   <raíz>/data/       mapas, documentos, ZIM, juegos, registros (todo lo del usuario)
 *
 *   node app/portable/launcher.mjs [--no-browser] [--install]
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { availableParallelism, homedir, networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIRS, PREFERRED_PORTS, androidComponentLinks, browserArgs, browserCandidates, lanAddress, llmFailure, openCommand, optionalServices, platformKey, serviceEnv, shouldRotate } from './lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = join(ROOT, 'app')
const DATA = process.env.SURVIVAL_PORTABLE_DATA || join(ROOT, 'data')
const LOGS = join(DATA, 'logs')
const RUN_FILE = join(DATA, 'run.json')
const PORTS_FILE = join(DATA, 'ports.json')
const platform = process.platform
/** App Android (ADR 0020): la abre la propia app en su WebView; lo nativo (USB, GPS, BRouter…) va por el puente. */
const ANDROID = platform === 'android'
/**
 * Autoprueba tras una actualización (apply-update.mjs, ADR 0021): arranca los servicios sin ventana, espera a
 * /api/health y se cierra con código 0 (bien) o 1 (mal, sin cuadros de diálogo): así se decide la vuelta atrás.
 */
const SELF_TEST = process.argv.includes('--self-test')
const NO_BROWSER = process.argv.includes('--no-browser') || ANDROID || SELF_TEST

/** Puente nativo de la app Android (127.0.0.1 con token: lo añade android-guard.mjs). */
async function bridge(path, body) {
  const base = process.env.SURVIVAL_ANDROID_BRIDGE
  if (!base) throw new Error('sin puente Android')
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

// ------------------------------------------------------------------ Mensajes al usuario

function say(msg) {
  process.stdout.write(`[Survivelia OS] ${msg}\n`)
  try {
    appendFileSync(join(LOGS, 'launcher.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // data/ aún no existe o es de solo lectura
  }
}

/** Error visible aunque no haya consola (lanzador oculto en Windows, .app en macOS). */
function fatal(msg) {
  say(`ERROR: ${msg}`)
  if (SELF_TEST) process.exit(1)
  const text = `Survivelia OS no puede arrancar:\n\n${msg}`
  try {
    if (ANDROID) {
      // La app muestra el error y el registro (data/logs/launcher.log) en su propia pantalla.
    } else if (platform === 'win32') {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(@'\n${text}\n'@, 'Survivelia OS') | Out-Null`], { stdio: 'ignore', timeout: 600_000 })
    } else if (platform === 'darwin') {
      spawnSync('osascript', ['-e', `display alert "Survivelia OS" message ${JSON.stringify(text)} as critical`], { stdio: 'ignore', timeout: 600_000 })
    } else {
      for (const [cmd, args] of [['zenity', ['--error', '--title=Survivelia OS', `--text=${text}`]], ['kdialog', ['--error', text]], ['notify-send', ['Survivelia OS', text]]]) {
        if (spawnSync(cmd, args, { stdio: 'ignore', timeout: 600_000 }).status === 0) break
      }
    }
  } catch {
    // sin entorno gráfico: queda en la consola y en data/logs/launcher.log
  }
  process.exit(1)
}

// ------------------------------------------------------------------ Comprobaciones

if (!existsSync(join(APP, 'web', 'server', 'index.mjs'))) fatal(`Falta la aplicación en ${APP}. Copia la carpeta completa de Survivelia OS.`)
try {
  for (const d of DATA_DIRS) mkdirSync(join(DATA, d), { recursive: true })
  writeFileSync(join(DATA, '.write-test'), 'ok')
  rmSync(join(DATA, '.write-test'))
} catch (err) {
  fatal(`No se puede escribir en ${DATA}.\n¿La memoria USB está protegida contra escritura o llena?\n(${err instanceof Error ? err.message : err})`)
}

if (process.argv.includes('--install')) {
  const { installHere } = await import('./install.mjs')
  const r = await installHere({ root: ROOT, onProgress: (m) => say(m) })
  say(`Instalado en ${r.dest}`)
  process.exit(0)
}

// ------------------------------------------------------------------ Una sola instancia

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function healthy(url) {
  return await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.status < 500 || r.status === 503, () => false)
}

// Actualización aplicándose ahora mismo (apply-update.mjs al cerrar, ADR 0021): esperar a que termine.
const APPLYING = join(ROOT, '.update', 'applying.json')
if (!SELF_TEST && existsSync(APPLYING)) {
  say('Terminando de aplicar una actualización…')
  for (let i = 0; i < 400 && existsSync(APPLYING); i++) {
    let pid = 0
    try {
      pid = JSON.parse(readFileSync(APPLYING, 'utf8')).pid
    } catch {
      // a medio escribir
    }
    if (pid && !alive(pid)) break // el ayudante murió: nada que esperar
    await new Promise((r) => setTimeout(r, 500))
  }
}

if (existsSync(RUN_FILE)) {
  try {
    const prev = JSON.parse(readFileSync(RUN_FILE, 'utf8'))
    if (prev.pid && alive(prev.pid) && (await healthy(prev.url))) {
      // En la autoprueba no puede haber otra instancia: si la hay, no se puede probar la nueva versión.
      if (SELF_TEST) fatal('otra instancia en marcha durante la autoprueba')
      // Actualización preparada y la instancia anterior nunca se cerró (Linux/macOS con Firefox o Chromium en snap
      // como navegador: cerrar la ventana no cierra Survivelia OS). Volver a abrirla es el momento de aplicarla:
      // la instancia en marcha la aplica y se reabre con la versión nueva (SIGUSR2 → applyUpdate). En Windows
      // no hace falta: la ventana de Chrome/Edge sí cierra la app, y allí no hay SIGUSR2.
      if (platform !== 'win32' && existsSync(join(ROOT, '.update', 'ready.json'))) {
        try {
          process.kill(prev.pid, 'SIGUSR2')
          say('Hay una actualización preparada: se aplica ahora y Survivelia OS se reabrirá en unos segundos…')
          process.exit(0)
        } catch {
          // no se pudo avisar: se abre otra ventana como siempre
        }
      }
      say(`Ya está en marcha (${prev.url}); abriendo otra ventana.`)
      if (!NO_BROWSER) openBrowser(prev.url, { attach: false })
      process.exit(0)
    }
  } catch {
    // run.json dañado: se ignora
  }
}

// ------------------------------------------------------------------ Puertos

function portFree(port) {
  return new Promise((ok) => {
    const s = createServer()
    s.once('error', () => ok(false))
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)))
  })
}
function randomPort() {
  return new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })
}
async function choosePorts() {
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(PORTS_FILE, 'utf8'))
  } catch {
    // primera vez
  }
  const out = {}
  for (const [name, pref] of Object.entries(PREFERRED_PORTS)) {
    const wanted = Number.isInteger(saved[name]) ? saved[name] : pref
    out[name] = (await portFree(wanted)) ? wanted : (await portFree(pref)) ? pref : await randomPort()
  }
  writeFileSync(PORTS_FILE, JSON.stringify(out, null, 2))
  return out
}

// ------------------------------------------------------------------ Servicios

const children = new Map()
let stopping = false

function logStream(name) {
  const file = join(LOGS, `${name}.log`)
  try {
    if (shouldRotate(statSync(file).size)) renameSync(file, `${file}.1`)
  } catch {
    // no existe aún
  }
  return (chunk) => {
    try {
      appendFileSync(file, chunk)
    } catch {
      // disco lleno o USB retirado: no se puede hacer más
    }
  }
}

/**
 * Lanza un servicio y lo relanza si termina (hasta 5 veces). `onState(state, info)` recibe 'starting' en cada
 * arranque y 'exited' (con el código, la señal y las últimas líneas de su salida) cada vez que termina.
 */
function launch(name, cmd, args, env, { ipc = false, cwd = DATA, onState = null } = {}) {
  const log = logStream(name)
  let tail = ''
  const write = (chunk) => {
    log(chunk)
    if (onState) tail = (tail + String(chunk)).slice(-4000)
  }
  let restarts = 0
  let stopped = false
  const start = () => {
    tail = ''
    onState?.('starting', { restarts })
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])],
      windowsHide: true,
    })
    child.stdout.on('data', write)
    child.stderr.on('data', write)
    if (ipc) child.on('message', onMessage)
    child.on('exit', (code, signal) => {
      if (stopping || stopped) return
      onState?.('exited', { code, signal, tail, final: restarts >= 5 })
      write(`\n[launcher] ${name} terminó (code=${code}, signal=${signal})\n`)
      if (restarts >= 5) {
        say(`${name} se ha detenido demasiadas veces; ver data/logs/${name}.log`)
        if (name === 'web') stop(1)
        return
      }
      restarts++
      setTimeout(start, Math.min(30_000, 1000 * 2 ** restarts))
    })
    children.set(name, child)
  }
  start()
  return {
    stop() {
      stopped = true
      const c = children.get(name)
      if (c && c.exitCode === null) c.kill()
      children.delete(name)
    },
  }
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  say('Cerrando Survivelia OS…')
  // Actualización automática preparada (ADR 0021): se aplica al cerrar, sin reabrir (la próxima vez ya es la nueva).
  if (!ANDROID && !SELF_TEST && !ejecting && !applyingNow && existsSync(join(ROOT, '.update', 'ready.json'))) spawnApplyHelper(false)
  for (const c of children.values()) if (c.exitCode === null) c.kill()
  try {
    rmSync(RUN_FILE, { force: true })
  } catch {
    // nada
  }
  setTimeout(() => process.exit(code), 3000).unref()
  Promise.all([...children.values()].map((c) => (c.exitCode === null ? new Promise((r) => c.once('exit', r)) : null))).then(() => process.exit(code))
}

/**
 * Mensajes del servidor web (IPC): «Cerrar Survivelia OS», «Compartir en la red local», «Reiniciar la
 * aplicación» (como restart-app en la Pi) y «Aplicar actualización» (preparada por portable-admin.mjs).
 */
function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'quit') {
    // Android: «Cerrar Survivelia OS» cierra también la app (servicio en primer plano y ventana).
    if (ANDROID) void bridge('/app/quit', {}).catch(() => undefined)
    stop(0)
  }
  if (msg.type === 'share') setShare(msg.on === true)
  if (msg.type === 'restart') {
    // Cada servicio se relanza solo (supervisor de launch()); la web, la última para que la respuesta llegue.
    say('Reiniciando servicios…')
    setTimeout(() => {
      for (const [name, c] of children) if (name !== 'web' && c.exitCode === null) c.kill()
      setTimeout(() => children.get('web')?.kill(), 1500)
    }, 500)
  }
  if (msg.type === 'update') applyUpdate()
  if (msg.type === 'eject') void eject(msg.messages)
}

// ------------------------------------------------------------------ Memoria USB (ADR 0019)

/**
 * Integración con el sistema en segundo plano (nunca bloquea ni impide el uso): icono y nombre de la unidad,
 * carpetas internas ocultas, icono de la carpeta; y, si esta memoria está emparejada en este equipo, el
 * vigilante «abrir al conectar» se actualiza con la versión de esta copia.
 */
async function integrateVolume() {
  if (ANDROID) return // sin unidades de escritorio ni «abrir al conectar»: lo sustituye la propia app
  refreshLegacyLaunchers()
  try {
    const usb = await import('./usb.mjs')
    const v = usb.volumeInfo(ROOT, platform)
    let version = ''
    try {
      version = readFileSync(join(APP, 'VERSION'), 'utf8').trim()
    } catch {
      // sin versión
    }
    const changes = usb.decorate(ROOT, { platform, volumeRoot: v.removable && v.volumeRoot, version })
    if (changes.length) say(`Integración con el sistema: ${changes.join(', ')}`)
    if (v.removable && v.id) {
      const autoopen = await import('./autoopen.mjs')
      if (autoopen.refresh({ root: ROOT, volumeId: v.id, platform })) say('Abrir al conectar: vigilante al día')
    }
  } catch (err) {
    say(`Integración con el sistema: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Carpetas actualizadas desde una versión anterior: conservan «Survival OS.exe» / «Survival OS.app» (a los que
 * apuntan sus accesos directos). Se rehacen con el lanzador nuevo para que la ventana y la barra de tareas digan
 * «Survivelia OS» sin romper esos accesos. Si está en uso, se reintenta en el próximo arranque.
 */
function refreshLegacyLaunchers() {
  try {
    const exe = join(ROOT, 'Survivelia OS.exe')
    const old = join(ROOT, 'Survival OS.exe')
    if (existsSync(exe) && existsSync(old) && statSync(exe).size !== statSync(old).size) copyFileSync(exe, old)
  } catch {
    // en uso (se abrió con él): la próxima vez
  }
  try {
    const plist = join(ROOT, 'Survivelia OS.app', 'Contents', 'Info.plist')
    const old = join(ROOT, 'Survival OS.app', 'Contents', 'Info.plist')
    if (existsSync(plist) && existsSync(old) && readFileSync(plist, 'utf8') !== readFileSync(old, 'utf8')) copyFileSync(plist, old)
  } catch {
    // sin permiso: no importa
  }
}

/**
 * «Expulsar la memoria USB»: no se puede expulsar mientras Node se ejecuta desde ella. Se lanza un ayudante
 * fuera de la memoria (PowerShell o sh) que espera a que este proceso termine, la expulsa y avisa; después se
 * cierra todo, ventana incluida (su perfil está en data/browser, dentro de la memoria).
 */
async function eject(messages) {
  if (ANDROID) return // Android expulsa las memorias desde sus Ajustes; la app no se ejecuta desde ellas
  try {
    const usb = await import('./usb.mjs')
    const v = usb.volumeInfo(ROOT, platform)
    if (!v.removable) {
      say('Expulsar: Survivelia OS no se ejecuta desde una memoria USB')
      return
    }
    const clean = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300) : undefined)
    ejecting = true
    usb.spawnEject(platform, v.mount, process.pid, { title: clean(messages?.title), ok: clean(messages?.ok), fail: clean(messages?.fail) })
    say(`Expulsando ${v.mount} en cuanto se cierre Survivelia OS…`)
    if (appWindow && appWindow.exitCode === null) appWindow.kill()
    stop(0)
  } catch (err) {
    say(`No se pudo expulsar: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Aplica la actualización preparada: copia Node y apply-update.mjs a una carpeta temporal (en Windows no se
 * puede sustituir node.exe mientras corre), lanza el ayudante desacoplado y se cierra. El ayudante cambia las
 * carpetas cuando este proceso ha terminado y vuelve a abrir Survivelia OS sin abrir otra ventana.
 */
function applyUpdate() {
  if (ANDROID) return // en Android se actualiza instalando el APK nuevo (lo hace la app)
  if (!existsSync(join(ROOT, '.update', 'ready.json'))) return
  if (!spawnApplyHelper(true)) return
  say('Aplicando la actualización: Survivelia OS se reabrirá en unos segundos…')
  if (appWindow && appWindow.exitCode === null) appWindow.kill()
  stop(0)
}

/** Ayudante ya lanzado (no lanzar dos: «Actualizar» seguido del cierre). */
let applyingNow = false
/** «Expulsar»: no se aplica nada al cerrar (el ayudante se ejecutaría desde la memoria que se expulsa). */
let ejecting = false

/** Lanza apply-update.mjs desacoplado con una copia temporal de Node. `relaunch`: reabrir al terminar. */
function spawnApplyHelper(relaunch) {
  try {
    const tmp = join(tmpdir(), `survival-os-update-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    const node = join(tmp, process.platform === 'win32' ? 'node.exe' : 'node')
    copyFileSync(process.execPath, node)
    copyFileSync(join(APP, 'portable', 'apply-update.mjs'), join(tmp, 'apply-update.mjs'))
    const child = spawn(node, [join(tmp, 'apply-update.mjs'), ROOT, String(process.pid), ...(relaunch ? [] : ['--no-relaunch'])], {
      cwd: tmp,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, SURVIVAL_PORTABLE_DATA: DATA },
    })
    child.unref()
    applyingNow = true
    if (!relaunch) say('Aplicando la actualización preparada (la próxima vez se abrirá la versión nueva)…')
    return true
  } catch (err) {
    say(`No se pudo aplicar la actualización: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// «Compartir en la red local» (equivalente portable del punto de acceso de la Pi, ADR 0009/0016):
// pasarela de SOLO LECTURA en la IP privada del equipo. Nunca se activa sola al arrancar.
const SHARE_FILE = join(DATA, 'share.json')
let share = null
function writeShare(state) {
  try {
    writeFileSync(SHARE_FILE, JSON.stringify(state))
  } catch {
    // sin datos de estado: la interfaz lo verá apagado
  }
}
writeShare({ on: false, url: null, error: null })
function setShare(on) {
  if (share) {
    share.handle.stop()
    share = null
  }
  if (!on) {
    say('Compartir en la red local: desactivado')
    return writeShare({ on: false, url: null, error: null })
  }
  const ip = lanAddress(networkInterfaces())
  if (!ip) return writeShare({ on: false, url: null, error: 'Este equipo no está conectado a ninguna red local' })
  const port = ports.share
  const handle = launch('public', process.execPath, [join(APP, 'scripts', 'public-gateway.mjs')], { PUBLIC_HOST: ip, PUBLIC_PORT: String(port), NITRO_PORT: String(ports.web) })
  share = { handle }
  say(`Compartir en la red local: http://${ip}:${port}`)
  writeShare({ on: true, url: `http://${ip}:${port}`, error: null })
}

// ------------------------------------------------------------------ Navegador

function findBrowser() {
  for (const c of browserCandidates(platform, process.env, homedir())) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c
    } else {
      const r = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' })
      const p = r.status === 0 ? r.stdout.trim() : ''
      if (p) return p
    }
  }
  return null
}

/**
 * Abre la interfaz. Con un navegador Chromium se usa una ventana de aplicación con perfil propio:
 * al cerrarla, el proceso termina y con él Survivelia OS. Si el navegador se desvincula enseguida
 * (p. ej. Chromium en snap), o solo hay navegador por defecto, la app sigue hasta pulsar «Cerrar».
 */
/** Ventana de la app abierta por este lanzador (se cierra al aplicar una actualización: la nueva abre otra). */
let appWindow = null

/**
 * Abre `url` con el programa del sistema (xdg-open, open, start). Si no existe (un Linux mínimo sin xdg-open),
 * Survivelia OS sigue en marcha y dice la dirección: antes el error sin capturar cerraba el lanzador entero.
 */
function openDefault(url) {
  const o = openCommand(platform, url)
  const c = spawn(o.cmd, o.args, { stdio: 'ignore', detached: true })
  c.on('error', () => say(`No se ha podido abrir el navegador (${o.cmd}). Abre esta dirección en uno: ${url}`))
  c.unref()
}

function openBrowser(url, { attach }) {
  const browser = findBrowser()
  if (!browser) {
    openDefault(url)
    say('Abierto en el navegador predeterminado. Para salir: Sistema → «Cerrar Survivelia OS».')
    return
  }
  const started = Date.now()
  const b = spawn(browser, browserArgs(url, join(DATA, 'browser')), { stdio: 'ignore', detached: !attach })
  appWindow = b
  if (!attach) {
    b.unref()
    return
  }
  b.on('exit', () => {
    if (Date.now() - started < 8000) {
      say('El navegador se ha desvinculado; Survivelia OS sigue en marcha hasta pulsar «Cerrar Survivelia OS».')
      return
    }
    stop(0)
  })
  b.on('error', () => openDefault(url))
}

// ------------------------------------------------------------------ Arranque

const node = process.execPath
const ports = await choosePorts()
const env = serviceEnv({ root: ROOT, data: DATA, ports, platform, privateDir: process.env.SURVIVAL_ANDROID_PRIVATE || null })

/**
 * Android: los ejecutables vienen en el APK (carpeta de bibliotecas nativas). Se enlazan en runtime/<clave>/ con
 * el nombre y la marca de versión de siempre, para que el motor de descargas y optionalServices los encuentren.
 */
function linkAndroidComponents() {
  const libDir = process.env.SURVIVAL_ANDROID_LIB
  const key = platformKey(platform, process.arch)
  if (!libDir || !key) return
  let versions = {}
  try {
    versions = JSON.parse(readFileSync(join(APP, 'android-natives.json'), 'utf8'))
  } catch {
    say('Sin app/android-natives.json: no hay componentes nativos')
  }
  for (const c of androidComponentLinks({ root: ROOT, key, libDir, versions }, existsSync)) {
    mkdirSync(c.dir, { recursive: true })
    for (const l of c.links) {
      const p = join(c.dir, l.name)
      try {
        if (readlinkSync(p) === l.target) continue
      } catch {
        // no existe o no es un enlace
      }
      rmSync(p, { force: true })
      symlinkSync(l.target, p)
    }
    writeFileSync(join(c.dir, '.version'), `${c.version}\n`)
  }
}
if (ANDROID) linkAndroidComponents()
const webUrl = `http://127.0.0.1:${ports.web}`

say(`Iniciando desde ${ROOT}`)
launch('device-api', node, [join(APP, 'services', 'device-api', 'dist', 'server.js')], env.device)
launch('library', node, [join(APP, 'services', 'library', 'dist', 'server.js')], env.library)
launch('vault', node, [join(APP, 'services', 'vault', 'dist', 'portable-server.js')], env.vault)
launch('serial-hub', node, [join(APP, 'services', 'serial-hub', 'dist', 'server.js')], env.hub)
launch('navigation', node, [join(APP, 'services', 'navigation', 'dist', 'server.js')], env.navigation)

launch('web', node, [join(APP, 'web', 'server', 'index.mjs')], env.web, { ipc: true })

// Servicios opcionales: Wikipedia (kiwix-serve), asistente (llama-server) y rutas (BRouter) se
// arrancan en cuanto se descargan su componente y sus datos, sin reiniciar Survivelia OS.
const optional = new Map()
const key = platformKey(platform, process.arch)
const fsprobe = {
  exists: existsSync,
  read: (p) => readFileSync(p, 'utf8'),
  hasRd5: (d) => readdirSync(d).some((f) => f.endsWith('.rd5')),
}
/**
 * Servicio que ejecuta la app Android por el puente (BRouter: Java dentro del APK, en su propio proceso). Se
 * comprueba en cada pasada de syncOptional y se relanza si Android lo ha cerrado.
 */
function launchBridged(name, spec) {
  let stopped = false
  let restarts = 0
  const start = () =>
    bridge(`/${spec.bridge}/start`, spec.params).catch((err) => say(`${name}: ${err instanceof Error ? err.message : err}`))
  void start()
  return {
    async check() {
      if (stopped) return
      const st = await bridge(`/${spec.bridge}/status`).catch(() => null)
      if (st && !st.running && restarts < 5) {
        restarts++
        say(`${name} no está en marcha (${st.error ?? 'sin detalle'}); relanzando`)
        void start()
      }
    },
    stop() {
      stopped = true
      void bridge(`/${spec.bridge}/stop`, {}).catch(() => undefined)
    },
  }
}

// Hilos del asistente: en móviles big.LITTLE (p. ej. 2 núcleos grandes + 6 pequeños) más hilos que núcleos
// rápidos lo frenan; 4 es el punto habitual.
const llmThreads = ANDROID ? Math.max(1, Math.min(4, availableParallelism() - 2)) : Math.max(1, availableParallelism() - 1)

/**
 * Estado del servidor del asistente para la pantalla (data/llm/server.json): si llama-server se cae al cargar el
 * modelo (falta una biblioteca, falta memoria…), la pantalla lo dice en vez de quedarse en «cargando».
 */
function llmState(state, info) {
  // Los reintentos tras un fallo no lo borran: solo el primer arranque (o un modelo nuevo) vuelve a «cargando».
  if (state === 'starting' && info.restarts > 0) return
  const at = new Date().toISOString()
  try {
    writeFileSync(join(DATA, 'llm', 'server.json'), JSON.stringify(state === 'starting' ? { state, at } : { state: 'failed', ...llmFailure(info), at }))
  } catch {
    // sin escritura en data/: la pantalla seguirá diciendo «cargando»
  }
}

function syncOptional() {
  if (stopping || !key) return
  let wanted = {}
  try {
    wanted = optionalServices({ root: ROOT, data: DATA, key, ports, platform, threads: llmThreads }, fsprobe)
  } catch (err) {
    say(`Servicios opcionales: ${err instanceof Error ? err.message : err}`)
  }
  for (const [name, cur] of optional) {
    if (!wanted[name] || wanted[name].sig !== cur.sig) {
      say(`Deteniendo ${name}`)
      cur.handle.stop()
      optional.delete(name)
    }
  }
  for (const [name, spec] of Object.entries(wanted)) {
    if (optional.has(name)) {
      void optional.get(name).handle.check?.()
      continue
    }
    say(`Arrancando ${name}`)
    if (spec.bridge) {
      optional.set(name, { sig: spec.sig, handle: launchBridged(name, spec) })
      continue
    }
    // Bibliotecas compartidas junto al binario (llama.cpp en Linux) y las que trae la portable (libgomp, que un
    // Linux recién instalado puede no tener).
    const libEnv = {
      ...(platform === 'linux' ? { LD_LIBRARY_PATH: [spec.cwd, join(ROOT, 'runtime', key, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
      ...(spec.env ? env[spec.env] : {}),
    }
    const onState = name === 'llm' ? llmState : null
    optional.set(name, { sig: spec.sig, handle: launch(name, spec.cmd, spec.args, libEnv, { cwd: spec.cwd, onState }) })
  }
}
// En la autoprueba solo cuenta el núcleo: ni Wikipedia ni el asistente (cargar un modelo tarda y no se usa).
if (!SELF_TEST) {
  syncOptional()
  setInterval(syncOptional, 10_000).unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
process.on('SIGHUP', () => stop(0))
// Otra apertura con una actualización preparada (ver «Una sola instancia»): aplicarla y reabrir.
if (platform !== 'win32') process.on('SIGUSR2', () => applyUpdate())

let ready = false
for (let i = 0; i < 120 && !ready && !stopping; i++) {
  await new Promise((r) => setTimeout(r, 250))
  ready = await healthy(webUrl)
}
if (!ready) {
  stop(1)
  fatal(`El servidor web no responde. Detalles en ${join(LOGS, 'web.log')}`)
}
if (SELF_TEST) {
  // Además de la salud, la página: un .output roto responde a /api/health pero deja la pantalla en blanco.
  const page = await fetch(`${webUrl}/`, { signal: AbortSignal.timeout(10_000) }).then(async (r) => (r.ok ? await r.text() : ''), () => '')
  if (!/<script[^>]+src="\/_nuxt\//.test(page)) {
    stop(1)
    fatal('la página principal no carga')
  }
  say('Autoprueba correcta: la versión responde')
  stop(0)
  await new Promise(() => undefined) // stop() termina el proceso
}
writeFileSync(RUN_FILE, JSON.stringify({ pid: process.pid, url: webUrl, startedAt: new Date().toISOString() }))
say(`Listo en ${webUrl}`)
if (!NO_BROWSER) openBrowser(webUrl, { attach: true })
setTimeout(() => void integrateVolume(), 1500).unref()
