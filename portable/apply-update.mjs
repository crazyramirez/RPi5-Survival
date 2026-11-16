#!/usr/bin/env node
/**
 * Aplica una actualización preparada por portable-admin.mjs (<raíz>/.update/ready.json + staging). Lo lanza el
 * lanzador al cerrarse, con una COPIA TEMPORAL de Node: en Windows no se puede sustituir node.exe mientras se
 * ejecuta. Espera a que el lanzador termine, cambia app/, runtime/ y los ficheros de la raíz (NUNCA data/),
 * vuelve a abrir Survival OS y guarda la anterior en .previous. Si algo falla, deja la anterior como estaba.
 *
 *   node apply-update.mjs <raíz> <pid del lanzador>
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [root, pidArg] = process.argv.slice(2)
const pid = Number(pidArg)
const upd = join(root, '.update')
const logFile = join(process.env.SURVIVAL_PORTABLE_DATA || join(root, 'data'), 'logs', 'update.log')
const log = (msg) => {
  try {
    mkdirSync(join(logFile, '..'), { recursive: true })
    appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // sin registro
  }
}
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
async function move(from, to) {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      if (i >= 20) throw err
      await sleep(500)
    }
  }
}

function relaunch() {
  if (process.env.SURVIVAL_UPDATE_NO_RELAUNCH === '1') return // pruebas automáticas
  const key = `${{ win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform]}-${process.arch}`
  const node = join(root, 'runtime', key, process.platform === 'win32' ? 'node.exe' : 'node')
  const child = spawn(node, [join(root, 'app', 'portable', 'launcher.mjs')], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

async function main() {
  for (let i = 0; i < 120 && alive(pid); i++) await sleep(250)
  if (alive(pid)) {
    log('el lanzador no se cerró: actualización cancelada')
    return
  }
  const ready = JSON.parse(readFileSync(join(upd, 'ready.json'), 'utf8'))
  const base = join(root, ready.base)
  const old = join(upd, 'old')
  mkdirSync(old, { recursive: true })
  const entries = readdirSync(base).filter((n) => n !== 'data' && n !== '.update')
  const moved = []
  log(`aplicando ${ready.from} → ${ready.version}: ${entries.join(', ')}`)
  try {
    for (const name of entries) {
      if (existsSync(join(root, name))) {
        await move(join(root, name), join(old, name))
        moved.push(name)
      }
      await move(join(base, name), join(root, name))
    }
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}; se restaura la versión anterior`)
    for (const name of entries) {
      if (existsSync(join(root, name)) && !moved.includes(name)) continue
      try {
        if (existsSync(join(root, name)) && moved.includes(name)) await move(join(root, name), join(base, name))
        if (moved.includes(name)) await move(join(old, name), join(root, name))
      } catch {
        // se hace lo posible
      }
    }
    relaunch()
    return
  }
  log('actualización aplicada; reabriendo Survival OS')
  relaunch()
  await sleep(2000)
  // La versión anterior se conserva en <raíz>/.previous para volver atrás a mano (como la Pi con su release
  // anterior); solo la última.
  const prev = join(root, '.previous')
  rmSync(prev, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  try {
    await move(old, prev)
    writeFileSync(join(prev, 'VERSION-ANTERIOR.txt'), `${ready.from}\nPara volver a ella: cierra Survival OS y sustituye app/ y runtime/ por los de esta carpeta.\n`)
  } catch {
    // sin copia de la anterior: no impide nada
  }
  rmSync(upd, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}

await main().catch((err) => log(`ERROR: ${err instanceof Error ? err.message : String(err)}`))
