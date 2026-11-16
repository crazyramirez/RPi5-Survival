#!/usr/bin/env node
/**
 * Motor de actualizaciones desde GitHub Releases (ADR 0021). Node sin dependencias; el mismo en la Pi (tarea root
 * `update-online`/`update-auto` vía admin-job.py), la portable y Android (portable-admin.mjs).
 *
 *   node update-engine.mjs check [--force]   --profile pi|portable [--root <carpeta portable>]
 *   node update-engine.mjs fetch             (comprueba y descarga el fichero verificado de esta plataforma)
 *   node update-engine.mjs auto              (lo del temporizador: según el modo, comprueba y descarga)
 *   node update-engine.mjs status
 *
 * - Solo se confía en el manifiesto FIRMADO (update-lib.mjs, TRUSTED_KEYS); tamaño y SHA-256 de cada fichero
 *   salen de él, nunca del .sha256 publicado al lado.
 * - Estado legible por la interfaz en <dir>/state.json. Sin red, lo dice: nunca se inventa una versión (ADR 0003).
 * - Nada identifica al equipo: User-Agent genérico, sin parámetros.
 * - Aplicar NO es cosa de este motor: lo hacen install-system.sh (Pi), apply-update.mjs (portable) o Android.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, freeBytes, sha256File } from './content-engine.mjs'
import {
  checkDue, compareVersions, decide, LATEST_BASE, MANIFEST_NAME, normalizeSettings, parseManifest, parseVersion, PORTABLE_TARGETS,
  SIG_NAME, tagBase, TRUSTED_KEYS, verifyManifest, WAKE_EVERY_MS,
} from './update-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ------------------------------------------------------------------ rutas

/**
 * Pi: descargas y estado en /var/lib/survival-os-update (root, 0755): el usuario `survival` (la web) solo lee; no
 * puede cambiar el tarball entre la verificación y la instalación. Los ajustes (modo) sí los escribe la web.
 */
export function enginePaths(profile, root, { platform = osPlatform(), arch = osArch(), env = process.env } = {}) {
  if (profile === 'pi') {
    const dir = env.SURVIVAL_UPDATE_DIR || '/var/lib/survival-os-update'
    return {
      profile,
      kind: 'system',
      dir,
      state: join(dir, 'state.json'),
      downloads: join(dir, 'downloads'),
      settings: env.SURVIVAL_UPDATE_SETTINGS || '/var/lib/survival-os/update-settings.json',
      versionFile: env.SURVIVAL_VERSION_FILE || '/opt/survival-os/current/VERSION',
      platform: `linux-${arch}`,
      runtimes: [],
    }
  }
  const data = env.SURVIVAL_PORTABLE_DATA || join(root, 'data')
  const dir = join(data, 'update')
  const android = platform === 'android'
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux', android: 'android' }[platform] ?? platform
  let runtimes = []
  if (!android) {
    try {
      runtimes = readdirSync(join(root, 'runtime')).filter((d) => PORTABLE_TARGETS.includes(d))
    } catch {
      runtimes = []
    }
  }
  return {
    profile: 'portable',
    kind: android ? 'android' : 'portable',
    dir,
    state: join(dir, 'state.json'),
    downloads: join(dir, 'downloads'),
    settings: join(dir, 'settings.json'),
    versionFile: join(root, 'app', 'VERSION'),
    platform: `${os}-${arch}`,
    runtimes,
  }
}

export function installedVersion(paths) {
  try {
    const v = readFileSync(paths.versionFile, 'utf8').trim()
    return parseVersion(v) ? v : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ estado y ajustes

const EMPTY = { schema: 1, installed: null, checkedAt: null, okAt: null, error: null, status: null, latest: null, asset: null, download: null, lastInstall: null }

export function readState(paths) {
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(paths.state, 'utf8')) }
  } catch {
    return { ...EMPTY }
  }
}

export function writeState(paths, mutate) {
  const st = readState(paths)
  mutate(st)
  mkdirSync(paths.dir, { recursive: true, mode: 0o755 })
  const tmp = `${paths.state}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`, { mode: 0o644 })
  renameSync(tmp, paths.state)
  return st
}

export function readSettings(paths) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(paths.settings, 'utf8'))
  } catch {
    raw = null
  }
  return normalizeSettings(raw, paths.kind)
}

// ------------------------------------------------------------------ red

const UA = { 'user-agent': 'SurvivalOS-updater/1' }

class UpdateError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function getBytes(url, fetchImpl, timeoutMs = 30_000) {
  let res
  try {
    res = await fetchImpl(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new UpdateError('offline', `sin conexión con el servidor de actualizaciones (${err instanceof Error ? err.message : String(err)})`)
  }
  if (res.status === 404) throw new UpdateError('no-release', 'todavía no hay ninguna versión publicada con actualizador')
  if (!res.ok) throw new UpdateError('http', `HTTP ${res.status} al descargar ${url.split('/').pop()}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 1024 * 1024) throw new UpdateError('invalid', 'manifiesto demasiado grande')
  return buf
}

/** Baja, verifica la firma y valida el manifiesto. → manifiesto normalizado. */
export async function fetchManifest({ base = null, keys = TRUSTED_KEYS, fetchImpl = fetch } = {}) {
  const root = base ?? LATEST_BASE
  const [bytes, sig] = await Promise.all([getBytes(`${root}/${MANIFEST_NAME}`, fetchImpl), getBytes(`${root}/${SIG_NAME}`, fetchImpl)])
  const v = verifyManifest(bytes, sig, keys)
  if (!v.ok) throw new UpdateError('signature', `manifiesto rechazado: ${v.error}`)
  try {
    return parseManifest(bytes)
  } catch (err) {
    throw new UpdateError('invalid', err instanceof Error ? err.message : String(err))
  }
}

const assetUrl = (base, manifest, asset) => `${base ?? tagBase(manifest.tag)}/${asset.name}`

// ------------------------------------------------------------------ operaciones

const noop = () => undefined

/**
 * Comprueba si hay versión nueva y guarda el resultado en el estado. Las automáticas se limitan a una cada 20 h
 * (CHECK_EVERY_MS, o `every`); `force` (botón «Buscar ahora») siempre. Con `quietOffline` (al abrir la app), sin
 * conexión no se anota ningún error: se probará la próxima vez. → { state, manifest|null, offline? }
 */
export async function check(paths, { force = false, every, quietOffline = false, base = defaultBase(), keys = TRUSTED_KEYS, fetchImpl = fetch, now = () => new Date(), log = noop } = {}) {
  const installed = installedVersion(paths)
  const before = readState(paths)
  // Tras actualizar (versión instalada distinta de la del último estado) se comprueba otra vez enseguida.
  if (before.installed === installed && !checkDue(before, now().getTime(), force, every)) {
    log('Comprobación reciente: no se repite todavía')
    return { state: writeState(paths, (s) => (s.installed = installed)), manifest: null, skipped: true }
  }
  log('Buscando actualizaciones…')
  const at = now().toISOString()
  try {
    if (!installed) throw new UpdateError('no-version', 'no se sabe qué versión está instalada')
    const manifest = await fetchManifest({ base, keys, fetchImpl })
    const d = decide(manifest, { installed, kind: paths.kind, platform: paths.platform, runtimes: paths.runtimes })
    const state = writeState(paths, (s) => {
      s.installed = installed
      s.checkedAt = at
      s.okAt = at
      s.error = null
      s.status = d.status
      s.latest = { version: manifest.version, tag: manifest.tag, date: manifest.date, minFrom: manifest.minFrom, notes: manifest.notes }
      s.asset = d.asset ? { name: d.asset.name, size: d.asset.size, sha256: d.asset.sha256 } : null
      // Una descarga de otra versión ya no sirve.
      if (s.download && s.download.version !== manifest.version) s.download = null
    })
    log(
      {
        'up-to-date': `Survivelia OS ${installed} está al día`,
        'newer-installed': `La versión instalada (${installed}) es más nueva que la publicada (${manifest.version})`,
        available: `Nueva versión ${manifest.version} (${fmt(d.asset?.size)})`,
        'no-asset': `Hay versión ${manifest.version}, pero no para este sistema (${paths.platform})`,
        'needs-step': `Para pasar a ${manifest.version} hay que instalar antes la ${manifest.minFrom} (a mano)`,
      }[d.status],
    )
    return { state, manifest }
  } catch (err) {
    const code = err instanceof UpdateError ? err.code : 'error'
    const message = err instanceof Error ? err.message : String(err)
    if (quietOffline && code === 'offline') {
      log('Sin conexión a Internet: se comprobará la próxima vez')
      return { state: readState(paths), manifest: null, offline: true }
    }
    log(`No se pudo comprobar: ${message}`)
    const state = writeState(paths, (s) => {
      s.installed = installed
      s.checkedAt = at
      s.error = { code, message }
    })
    return { state, manifest: null, error: { code, message } }
  }
}

const fmt = (b) => (b == null ? '?' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`)

/**
 * Comprueba (siempre) y descarga el fichero de esta plataforma a <dir>/downloads, verificado con el tamaño y el
 * SHA-256 del manifiesto firmado. Si ya está descargado y verificado, no vuelve a bajarlo.
 * → { file, version, asset } | lanza Error
 */
export async function fetchUpdate(paths, { base = defaultBase(), keys = TRUSTED_KEYS, fetchImpl = fetch, now = () => new Date(), log = noop } = {}) {
  const r = await check(paths, { force: true, base, keys, fetchImpl, now, log })
  if (r.error) throw new Error(r.error.message)
  if (r.state.status !== 'available' || !r.manifest) throw new Error(r.state.status === 'up-to-date' ? 'ya está al día' : `no hay nada que instalar (${r.state.status})`)
  const manifest = r.manifest
  const asset = manifest.assets.find((a) => a.name === r.state.asset.name)
  mkdirSync(paths.downloads, { recursive: true, mode: 0o755 })
  // Solo se conserva la descarga en curso: versiones anteriores y restos fuera.
  for (const f of readdirSync(paths.downloads)) {
    if (f !== asset.name && f !== `${asset.name}.part` && f !== `${asset.name}.sha256`) rmSync(join(paths.downloads, f), { recursive: true, force: true })
  }
  const file = join(paths.downloads, asset.name)
  const verified = existsSync(file) && statSync(file).size === asset.size && (await sha256File(file)) === asset.sha256
  if (verified) {
    log(`${asset.name} ya estaba descargado y verificado`)
  } else {
    rmSync(file, { force: true })
    const have = existsSync(`${file}.part`) ? statSync(`${file}.part`).size : 0
    const free = await freeBytes(paths.downloads)
    if (asset.size - have + 64 * 1024 ** 2 > free) throw new Error(`espacio insuficiente: hacen falta ${fmt(asset.size)} y quedan ${fmt(free)}`)
    log(`Descargando ${asset.name} (${fmt(asset.size)})…`)
    await download([assetUrl(base, manifest, asset)], file, { total: asset.size, label: asset.name })
    if (statSync(file).size !== asset.size) {
      rmSync(file, { force: true })
      throw new Error('el tamaño no coincide con el manifiesto firmado (descarga borrada)')
    }
    if ((await sha256File(file)) !== asset.sha256) {
      rmSync(file, { force: true })
      throw new Error('el SHA-256 no coincide con el manifiesto firmado (descarga borrada)')
    }
    log('Verificado (SHA-256 del manifiesto firmado)')
  }
  // .sha256 al lado: install-system.sh y la preparación de la portable lo comprueban otra vez.
  writeFileSync(`${file}.sha256`, `${asset.sha256}  ${asset.name}\n`, { mode: 0o644 })
  writeState(paths, (s) => {
    s.download = { version: manifest.version, name: asset.name, file, size: asset.size, sha256: asset.sha256, at: now().toISOString() }
  })
  return { file, version: manifest.version, asset }
}

/**
 * Lo que hace el temporizador (Pi) o el planificador de la web (portable), según el modo:
 *   off    → nada (ni se conecta)
 *   notify → comprueba (como mucho cada 20 h) y avisa
 *   auto   → además descarga; aplicar lo decide quien llama (ventana segura en la Pi, al cerrar en la portable)
 * Con `wake` (la app se abre o vuelve a primer plano) comprueba si la última fue hace más de 10 min y, sin
 * conexión, no anota error ('offline').
 * → { action: 'off'|'checked'|'offline'|'downloaded'|'error', state, file? }
 */
export async function autoRun(paths, opts = {}) {
  const log = opts.log ?? noop
  const { mode } = readSettings(paths)
  if (mode === 'off') {
    log('Actualizaciones automáticas desactivadas')
    return { action: 'off', state: readState(paths) }
  }
  const wake = opts.wake === true
  const r = await check(paths, { ...opts, force: false, ...(wake ? { every: WAKE_EVERY_MS, quietOffline: true } : {}) })
  if (r.offline) return { action: 'offline', state: r.state }
  const state = r.state
  if (mode !== 'auto' || state.status !== 'available' || state.error) return { action: r.error ? 'error' : 'checked', state }
  if (state.download?.version === state.latest?.version && existsSync(state.download.file)) {
    log(`La versión ${state.download.version} ya está descargada`)
    return { action: 'downloaded', state, file: state.download.file }
  }
  try {
    const f = await fetchUpdate(paths, opts)
    return { action: 'downloaded', state: readState(paths), file: f.file }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`No se pudo descargar: ${message}`)
    return { action: 'error', state: writeState(paths, (s) => (s.error = { code: 'download', message })) }
  }
}

/** Resultado de una instalación (lo escriben admin-job.py y portable-admin/apply-update). */
export function recordInstall(paths, { version, ok, message = null, at = new Date().toISOString() }) {
  return writeState(paths, (s) => {
    s.lastInstall = { version, ok, message, at }
    if (ok) {
      s.installed = version
      if (s.latest && compareVersions(s.latest.version, version) <= 0) s.status = 'up-to-date'
      s.download = null
    }
  })
}

/** Servidor alternativo SOLO para pruebas (GitHub falso local); la firma se exige igual. */
function defaultBase() {
  const b = process.env.SURVIVAL_UPDATE_BASE
  return b && /^https?:\/\/[^\s]+$/.test(b) ? b.replace(/\/$/, '') : null
}

// ------------------------------------------------------------------ CLI

async function main() {
  const args = process.argv.slice(2)
  const opt = (n) => {
    const i = args.indexOf(n)
    return i >= 0 ? args.splice(i, 2)[1] : null
  }
  const profile = opt('--profile') ?? (process.env.SURVIVAL_PORTABLE === '1' ? 'portable' : 'pi')
  const root = opt('--root') ?? process.env.SURVIVAL_PORTABLE_ROOT ?? resolve(HERE, '..', '..')
  const force = args.includes('--force')
  const [cmd] = args.filter((a) => !a.startsWith('--'))
  const paths = enginePaths(profile, root)
  const log = (m) => process.stdout.write(`==> ${m}\n`)
  if (profile === 'pi' && typeof process.getuid === 'function' && process.getuid() === 0) {
    // Dueño root y legible por todos (la web lee state.json); el umask de systemd podría ser más estricto.
    mkdirSync(paths.dir, { recursive: true, mode: 0o755 })
    spawnSync('chmod', ['0755', paths.dir])
  }
  if (cmd === 'status') {
    process.stdout.write(`${JSON.stringify({ paths, settings: readSettings(paths), state: readState(paths) }, null, 2)}\n`)
    return
  }
  if (cmd === 'check') {
    const r = await check(paths, { force, log })
    process.exitCode = r.error ? 1 : 0
    return
  }
  if (cmd === 'fetch') {
    const r = await fetchUpdate(paths, { log })
    process.stdout.write(`FILE ${r.file}\n`)
    return
  }
  if (cmd === 'auto') {
    const r = await autoRun(paths, { log, wake: args.includes('--wake') })
    process.stdout.write(`RESULT ${JSON.stringify({ action: r.action, file: r.file ?? null })}\n`)
    process.exitCode = r.action === 'error' ? 1 : 0
    return
  }
  process.stderr.write('Uso: update-engine.mjs check|fetch|auto|status [--force] [--wake] --profile pi|portable [--root DIR]\n')
  process.exitCode = 2
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  main().catch((err) => {
    process.stdout.write(`ERROR: ${err instanceof Error ? err.message : err}\n`)
    process.exitCode = 1
  })
}
