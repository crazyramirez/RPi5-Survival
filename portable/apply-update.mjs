#!/usr/bin/env node
/**
 * Aplica una actualización preparada por portable-admin.mjs (<raíz>/.update/ready.json + staging). Lo lanza el
 * lanzador con una COPIA TEMPORAL de Node (en Windows no se puede sustituir node.exe mientras se ejecuta):
 *   - al pulsar «Actualizar» / «Instalar»: cambia las carpetas y vuelve a abrir Survivelia OS;
 *   - al cerrar Survivelia OS con una actualización automática preparada (ADR 0021): la aplica sin reabrir.
 *
 *   node apply-update.mjs <raíz> <pid del lanzador> [--no-relaunch]
 *
 * 1. Espera a que el lanzador termine y deja un candado (.update/applying.json): un lanzador que se abra mientras
 *    tanto espera a que acabe.
 * 2. Cambia app/, runtime/ y los ficheros de la raíz (NUNCA data/); la versión anterior queda en .update/old.
 * 3. AUTOPRUEBA: arranca la versión nueva con `launcher.mjs --self-test` (servicios sin ventana hasta /api/health).
 *    Si no responde, VUELVE SOLA a la anterior: una app caída en un equipo de emergencia es peor que una vieja.
 * 4. Guarda la anterior en .previous (solo la última) y anota el resultado en data/update/last-apply.json.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function alive(p) {
  try {
    process.kill(p, 0)
    return true
  } catch {
    return false
  }
}

/** Reintenta un renombrado: en Windows un antivirus o el indexador pueden retener un fichero unos segundos. */
export async function move(from, to, tries = 20) {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      if (i >= tries) throw err
      await sleep(500)
    }
  }
}

const nodeName = () => (process.platform === 'win32' ? 'node.exe' : 'node')
const platformKey = () => `${{ win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform]}-${process.arch}`

/**
 * Sustituye en `root` las entradas de `base` (menos data/ y .update/), guardando las actuales en `old`.
 * Si algo falla, deshace lo hecho y lanza. → nombres cambiados
 */
export async function swapIn(root, base, old, { tries = 20 } = {}) {
  mkdirSync(old, { recursive: true })
  const entries = readdirSync(base).filter((n) => n !== 'data' && n !== '.update')
  const moved = []
  const placed = []
  try {
    for (const name of entries) {
      if (existsSync(join(root, name))) {
        await move(join(root, name), join(old, name), tries)
        moved.push(name)
      }
      await move(join(base, name), join(root, name), tries)
      placed.push(name)
    }
  } catch (err) {
    await swapOut(root, base, old, { placed, moved, tries })
    throw err
  }
  return { placed, moved }
}

/** Deshace swapIn: lo nuevo vuelve a `base` y lo anterior (de `old`) a `root`. Hace lo posible. */
export async function swapOut(root, base, old, { placed, moved, tries = 20 }) {
  const errors = []
  for (const name of placed) {
    try {
      mkdirSync(base, { recursive: true })
      await move(join(root, name), join(base, name), tries)
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  for (const name of moved) {
    try {
      await move(join(old, name), join(root, name), tries)
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return errors
}

/**
 * Autoprueba de la versión ya colocada en `root`: launcher.mjs --self-test con su propio Node. → true si responde.
 * Sin runtime para este sistema (solo en pruebas) usa el Node actual.
 */
export function selfTest(root, data, { timeoutMs = 180_000, nodeBin = null } = {}) {
  const bin = nodeBin ?? (existsSync(join(root, 'runtime', platformKey(), nodeName())) ? join(root, 'runtime', platformKey(), nodeName()) : process.execPath)
  return new Promise((resolve) => {
    let done = false
    const child = spawn(bin, [join(root, 'app', 'portable', 'launcher.mjs'), '--self-test'], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, SURVIVAL_PORTABLE_DATA: data },
    })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill()
      resolve(false)
    }, timeoutMs)
    child.on('exit', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(code === 0)
    })
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(false)
    })
  })
}

function relaunch(root) {
  if (process.env.SURVIVAL_UPDATE_NO_RELAUNCH === '1') return // pruebas automáticas
  const node = join(root, 'runtime', platformKey(), nodeName())
  const child = spawn(node, [join(root, 'app', 'portable', 'launcher.mjs')], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

/** Proceso completo (ver cabecera). `selfTestImpl` solo para pruebas. → { ok, version, message } */
export async function applyUpdate(root, pid, { relaunchAfter = true, data = null, selfTestImpl = selfTest, log = () => undefined } = {}) {
  const upd = join(root, '.update')
  const dataDir = data ?? process.env.SURVIVAL_PORTABLE_DATA ?? join(root, 'data')
  for (let i = 0; i < 120 && pid && alive(pid); i++) await sleep(250)
  if (pid && alive(pid)) {
    log('el lanzador no se cerró: actualización cancelada')
    return { ok: false, version: null, message: 'el lanzador no se cerró' }
  }
  const lock = join(upd, 'applying.json')
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
  let result
  try {
    result = await applyLocked(root, upd, dataDir, { selfTestImpl, log })
  } finally {
    rmSync(lock, { force: true })
  }
  record(dataDir, result)
  if (relaunchAfter) relaunch(root)
  // Limpieza: .update/ entero (staging vacío, ready.json). Si falló, lo nuevo queda en .update-failed para diagnóstico.
  if (!result.ok && existsSync(join(upd, 'staging'))) {
    rmSync(join(root, '.update-failed'), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    await move(join(upd, 'staging'), join(root, '.update-failed'), 5).catch(() => undefined)
  }
  rmSync(upd, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  return result
}

async function applyLocked(root, upd, dataDir, { selfTestImpl, log }) {
  let ready
  try {
    ready = JSON.parse(readFileSync(join(upd, 'ready.json'), 'utf8'))
  } catch {
    return { ok: false, version: null, message: 'ready.json ilegible' }
  }
  // La carpeta preparada tiene que estar DENTRO de .update/ (ni «data» ni «.update/../app»).
  const base = typeof ready.base === 'string' ? resolve(root, ready.base) : ''
  if (!base.startsWith(resolve(upd) + sep) || !existsSync(base)) return { ok: false, version: ready.version ?? null, message: 'preparación incompleta' }
  const old = join(upd, 'old')
  log(`aplicando ${ready.from} → ${ready.version}`)
  let swapped
  try {
    swapped = await swapIn(root, base, old)
  } catch (err) {
    const message = `no se pudieron cambiar las carpetas (${err instanceof Error ? err.message : String(err)}); sigue la ${ready.from}`
    log(`ERROR: ${message}`)
    return { ok: false, version: ready.version, message }
  }
  log('autoprueba de la versión nueva…')
  if (!(await selfTestImpl(root, dataDir))) {
    const errors = await swapOut(root, base, old, swapped)
    const message = `la versión ${ready.version} no arrancó; se restauró la ${ready.from}${errors.length ? ` (incidencias: ${errors.join('; ')})` : ''}`
    log(`ERROR: ${message}`)
    return { ok: false, version: ready.version, message }
  }
  log('actualización aplicada')
  // La versión anterior se conserva en <raíz>/.previous para volver atrás a mano (como la Pi con su release
  // anterior); solo la última.
  const prev = join(root, '.previous')
  rmSync(prev, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  try {
    await move(old, prev, 5)
    writeFileSync(join(prev, 'VERSION-ANTERIOR.txt'), `${ready.from}\nPara volver a ella: cierra Survivelia OS y sustituye app/ y runtime/ por los de esta carpeta.\n`)
  } catch {
    // sin copia de la anterior: no impide nada
  }
  return { ok: true, version: ready.version, message: null }
}

/** Resultado para la tarjeta «Actualizaciones» (lo lee la web junto a data/update/state.json). */
function record(dataDir, { ok, version, message }) {
  try {
    mkdirSync(join(dataDir, 'update'), { recursive: true })
    writeFileSync(join(dataDir, 'update', 'last-apply.json'), JSON.stringify({ version, ok, message, at: new Date().toISOString() }))
  } catch {
    // datos de solo lectura: queda en el registro
  }
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  const args = process.argv.slice(2)
  const [root, pidArg] = args.filter((a) => !a.startsWith('--'))
  const dataDir = process.env.SURVIVAL_PORTABLE_DATA || join(root, 'data')
  const logFile = join(dataDir, 'logs', 'update.log')
  const log = (msg) => {
    try {
      mkdirSync(join(logFile, '..'), { recursive: true })
      appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
    } catch {
      // sin registro
    }
  }
  await applyUpdate(root, Number(pidArg), { relaunchAfter: !args.includes('--no-relaunch'), data: dataDir, log }).catch((err) =>
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`),
  )
}
