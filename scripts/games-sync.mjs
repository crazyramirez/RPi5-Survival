#!/usr/bin/env node
/**
 * Survivelia OS — copia offline de Viseni Games (ADR 0012), versión Node sin dependencias de games-sync.py.
 * Misma semántica y mismo state.json; sirve en la Pi y en la versión portable (Windows sin administrador,
 * memorias USB en exFAT/FAT).
 *
 *   node games-sync.mjs sync | remove        (GAMES_ROOT=<carpeta>, por defecto /var/lib/survival-os/games)
 *
 * Qué se descarga (solo de GAMES_BASE, URL fija; nada llega de la web local):
 *   - El portal: lista de sw.js (const FILES = [[ruta-url, sha256[:16]], …]) que genera el propio sitio.
 *   - Juegos, media y capturas: offline-manifest.json ({path, size, sha256} de cada archivo).
 * Cada archivo se verifica con su hash. Los que no cambian se enlazan (hardlink) desde la copia actual, o se
 * copian si el sistema de ficheros no admite enlaces (exFAT/FAT). La copia nueva se monta aparte y `current`
 * pasa a apuntar a ella al final: enlace simbólico (Linux, cambio atómico) o unión de directorio (Windows,
 * no requiere administrador). Si algo falla a medias, la copia anterior queda intacta.
 * Progreso en stdout (registro de la tarea); código de salida 1 si falla.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs, statfsSync } from 'node:fs'
import path from 'node:path'

export const GAMES_BASE = 'https://games.viseni.com/'
const ROOT = process.env.GAMES_ROOT || '/var/lib/survival-os/games'
const USER_AGENT = 'SurvivalOS-games/1.0 (+offline copy)'
const WORKERS = 6
const RETRIES = 3
export const MAX_FILES = 20000
export const MAX_TOTAL = 6 * 1024 ** 3
export const MAX_FILE = 1024 ** 3
const MAX_SHELL_FILE = 64 * 1024 ** 2
const FREE_MARGIN = 512 * 1024 ** 2
const INDEX = '.survival-index.json'
const OPTIONAL = ['200.html', '404.html']
const WIN = process.platform === 'win32'

export class SyncError extends Error {}

const pad = (n) => String(n).padStart(2, '0')
function log(msg) {
  const d = new Date()
  process.stdout.write(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${msg}\n`)
}

// ------------------------------------------------------------------ funciones puras (apps/frontend/test)

const SEGMENT_RE = /^[^/\\\x00-\x1f]{1,200}$/

/** Ruta relativa segura (sin '..', sin absolutas, sin ocultos) o null. */
export function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400 || rel.startsWith('/')) return null
  const parts = rel.split('/')
  if (parts.length > 20) return null
  for (const p of parts) if (!SEGMENT_RE.test(p) || p === '.' || p === '..' || p.startsWith('.')) return null
  // Windows: nombres que el sistema de ficheros no admite (también rompen la copia en exFAT/FAT).
  if (parts.some((p) => /[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(p))) return null
  return rel
}

export const urlFor = (rel) => GAMES_BASE + rel.split('/').map((p) => encodeURIComponent(p)).join('/')

/** Archivos del portal desde sw.js → [{path, hash16, size: null}]. Las rutas vienen codificadas por segmento. */
export function parseSw(source) {
  const m = /^const FILES = (\[.*\])\s*$/m.exec(source)
  if (!m) throw new SyncError('sw.js sin lista de archivos (const FILES)')
  let list
  try {
    list = JSON.parse(m[1])
  } catch {
    throw new SyncError('sw.js: lista de archivos ilegible')
  }
  return list.map((item) => {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') {
      throw new SyncError('sw.js: entrada no válida')
    }
    let decoded
    try {
      decoded = item[0].split('/').map((p) => decodeURIComponent(p)).join('/')
    } catch {
      decoded = null
    }
    const rel = safeRel(decoded)
    if (rel === null || !/^[0-9a-f]{16}$/.test(item[1])) throw new SyncError(`sw.js: ruta o hash no válidos (${item[0].slice(0, 80)})`)
    return { path: rel, hash16: item[1], size: null }
  })
}

/** offline-manifest.json → { files: [{path, size, sha256}], external, generatedAt }. */
export function parseManifest(data) {
  if (!data || typeof data !== 'object' || data.format !== 'viseni-offline/1' || !Array.isArray(data.files)) {
    throw new SyncError('offline-manifest.json con formato desconocido')
  }
  const files = data.files.map((f) => {
    const ok = f && typeof f === 'object'
    const rel = ok ? safeRel(f.path) : null
    const size = ok ? f.size : null
    const sha = ok ? f.sha256 : null
    if (rel === null || !Number.isInteger(size) || size < 0 || size > MAX_FILE || typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      throw new SyncError(`offline-manifest.json: entrada no válida (${JSON.stringify(f).slice(0, 80)})`)
    }
    return { path: rel, size, sha256: sha }
  })
  const external = (Array.isArray(data.external) ? data.external : [])
    .filter((e) => e && typeof e === 'object' && typeof e.file === 'string' && typeof e.url === 'string')
    .slice(0, 200)
  return { files, external, generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null }
}

/** Une portal y juegos; el manifiesto (hash completo) manda si una ruta aparece en ambos. */
export function mergeEntries(shell, assets) {
  const by = new Map(shell.map((e) => [e.path, e]))
  for (const e of assets) by.set(e.path, e)
  const entries = [...by.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (entries.length > MAX_FILES) throw new SyncError(`demasiados archivos (${entries.length})`)
  if (entries.reduce((s, e) => s + (e.size ?? 0), 0) > MAX_TOTAL) throw new SyncError('la copia supera el tamaño máximo permitido')
  const folded = new Map() // dos rutas que solo difieren en mayúsculas rompen en Windows y exFAT
  for (const e of entries) {
    const k = e.path.toLowerCase()
    if (folded.has(k)) throw new SyncError(`rutas duplicadas: ${folded.get(k)} / ${e.path}`)
    folded.set(k, e.path)
  }
  return entries
}

/** Juegos presentes: carpetas games/<slug>/ con su index.html. */
export const gameSlugs = (entries) =>
  [...new Set(entries.map((e) => /^games\/([^/]+)\/index\.html$/.exec(e.path)?.[1]).filter(Boolean))].sort()

export const matches = (entry, sha256Hex) => (entry.sha256 ? sha256Hex === entry.sha256 : sha256Hex.slice(0, 16) === entry.hash16)

export const incompleteGames = (failed) =>
  [...new Set(failed.filter((p) => p.startsWith('games/') && p.split('/').length >= 3).map((p) => p.split('/')[1]))].sort()

/** Ruta destino dentro de la copia, sin escapar de ella. */
export function placeIn(staging, rel) {
  const dest = path.join(staging, ...rel.split('/'))
  if (!path.resolve(dest).startsWith(path.resolve(staging) + path.sep)) throw new SyncError(`ruta fuera de la copia: ${rel}`)
  return dest
}

// ------------------------------------------------------------------ red y disco

async function fetchLimited(url, limit) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    const err = new SyncError(`la web respondió ${res.status} (${url})`)
    err.status = res.status
    throw err
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > limit) throw new SyncError(`respuesta demasiado grande: ${url}`)
  return buf
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Descarga a dest verificando el hash; devuelve el sha256 completo. */
async function download(entry, dest) {
  const limit = entry.size ?? MAX_SHELL_FILE
  let last
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const tmp = `${dest}.part`
    try {
      const res = await fetch(urlFor(entry.path), { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(300_000) })
      if (!res.ok || !res.body) throw new SyncError(`HTTP ${res.status}`)
      const hash = createHash('sha256')
      let n = 0
      const out = createWriteStream(tmp)
      const done = new Promise((resolve, reject) => {
        out.on('finish', resolve)
        out.on('error', reject)
      })
      try {
        for await (const chunk of res.body) {
          n += chunk.length
          if (n > limit) throw new SyncError('más grande de lo publicado')
          hash.update(chunk)
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        }
      } finally {
        out.end()
        await done.catch(() => {})
      }
      const digest = hash.digest('hex')
      if (!matches(entry, digest)) throw new SyncError('hash distinto del publicado')
      await fs.rename(tmp, dest)
      return digest
    } catch (e) {
      last = e
      await fs.rm(tmp, { force: true })
      await sleep(2000 * attempt)
    }
  }
  throw new SyncError(String(last?.message ?? last))
}

/** Copia actual (resuelta a su carpeta real) y su índice ruta → sha256. */
async function currentIndex() {
  const cur = path.join(ROOT, 'current')
  let real
  try {
    real = await fs.realpath(cur)
  } catch {
    return { dir: null, idx: {} }
  }
  try {
    const idx = JSON.parse(await fs.readFile(path.join(real, INDEX), 'utf8'))
    return { dir: real, idx: idx && typeof idx === 'object' ? idx : {} }
  } catch {
    return { dir: real, idx: {} }
  }
}

/** Hardlink desde la copia actual; si el sistema de ficheros no lo admite (exFAT/FAT), copia. */
export async function linkOrCopy(from, to) {
  try {
    await fs.link(from, to)
  } catch {
    await fs.copyFile(from, to)
  }
}

/** `current` → releases/<stamp>: enlace simbólico con renombrado atómico, o unión de directorio en Windows. */
export async function pointCurrent(release) {
  const cur = path.join(ROOT, 'current')
  if (WIN) {
    await fs.rm(cur, { recursive: false, force: true }).catch(async () => fs.unlink(cur).catch(() => {}))
    await fs.symlink(path.resolve(release), cur, 'junction')
  } else {
    const tmp = path.join(ROOT, `.current-${path.basename(release)}`)
    await fs.rm(tmp, { force: true })
    await fs.symlink(path.join('releases', path.basename(release)), tmp)
    await fs.rename(tmp, cur)
  }
}

async function writeState(state) {
  const tmp = path.join(ROOT, 'state.json.tmp')
  await fs.writeFile(tmp, JSON.stringify(state))
  await fs.rename(tmp, path.join(ROOT, 'state.json'))
}

function freeBytes(dir) {
  try {
    const s = statfsSync(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return Infinity
  }
}

const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

export async function sync() {
  await fs.mkdir(path.join(ROOT, 'releases'), { recursive: true })
  log(`Leyendo la lista de archivos de ${GAMES_BASE}`)
  let shell, manifest
  try {
    shell = parseSw((await fetchLimited(`${GAMES_BASE}sw.js`, 8 * 1024 ** 2)).toString('utf8'))
    manifest = JSON.parse((await fetchLimited(`${GAMES_BASE}offline-manifest.json`, 32 * 1024 ** 2)).toString('utf8'))
  } catch (e) {
    if (e instanceof SyncError && e.status) throw new SyncError(`${e.message}: ¿falta subir offline-manifest.json?`)
    if (e instanceof SyncError) throw e
    throw new SyncError(`sin conexión con ${GAMES_BASE} (${e?.cause?.code ?? e?.message ?? e})`)
  }
  const { files: assets, external, generatedAt } = parseManifest(manifest)
  const entries = mergeEntries(shell, assets)
  // Un manifiesto sin juegos no sustituye a una copia que sí los tiene: se rechaza entero.
  if (!gameSlugs(entries).length) throw new SyncError('el offline-manifest.json de la web no incluye ningún juego: no se toca la copia actual')
  const { dir: curDir, idx: curIdx } = await currentIndex()

  const reuse = []
  const todo = []
  for (const e of entries) {
    const old = curIdx[e.path]
    const ok = curDir && typeof old === 'string' && matches(e, old) && (await fs.stat(path.join(curDir, ...e.path.split('/'))).then((s) => s.isFile(), () => false))
    if (ok) reuse.push([e, old])
    else todo.push(e)
  }
  const need = todo.reduce((s, e) => s + (e.size ?? 0), 0)
  const free = freeBytes(ROOT)
  if (need + FREE_MARGIN > free) {
    throw new SyncError(`espacio insuficiente: hacen falta ${Math.round(need / 1024 ** 2)} MB y quedan ${Math.round(free / 1024 ** 2)} MB`)
  }
  log(`${entries.length} archivos: ${reuse.length} sin cambios, ${todo.length} por descargar (${Math.round(need / 1024 ** 2)} MB)`)

  const stamp = stampNow()
  const staging = path.join(ROOT, 'releases', `.staging-${stamp}`)
  const release = path.join(ROOT, 'releases', stamp)
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  const index = {}
  const failed = []
  try {
    for (const [e, digest] of reuse) {
      const dest = placeIn(staging, e.path)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await linkOrCopy(path.join(curDir, ...e.path.split('/')), dest)
      index[e.path] = digest
    }

    let done = 0
    let got = 0
    let lastLog = Date.now()
    const queue = [...todo]
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const dest = placeIn(staging, e.path)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        try {
          index[e.path] = await download(e, dest)
          got += e.size ?? 0
        } catch (err) {
          failed.push(e.path)
          log(`FALLO ${e.path}: ${err.message}`)
        }
        done++
        if (Date.now() - lastLog > 5000 || done === todo.length) {
          log(`${done}/${todo.length} archivos · ${Math.round(got / 1024 ** 2)} de ${Math.round(need / 1024 ** 2)} MB`)
          lastLog = Date.now()
        }
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker))

    for (const rel of OPTIONAL) {
      if (index[rel]) continue
      try {
        const data = await fetchLimited(urlFor(rel), MAX_SHELL_FILE)
        await fs.writeFile(placeIn(staging, rel), data)
        index[rel] = createHash('sha256').update(data).digest('hex')
      } catch {
        // opcional
      }
    }

    if (!index['index.html']) throw new SyncError('no se pudo descargar la portada del portal (index.html)')
    await fs.writeFile(path.join(staging, INDEX), JSON.stringify(index))
    await fs.rename(staging, release)
  } catch (e) {
    await fs.rm(staging, { recursive: true, force: true })
    throw e
  }

  await pointCurrent(release)
  for (const name of await fs.readdir(path.join(ROOT, 'releases'))) {
    if (name !== stamp) await fs.rm(path.join(ROOT, 'releases', name), { recursive: true, force: true })
  }

  let total = 0
  for (const p of Object.keys(index)) total += (await fs.stat(path.join(release, ...p.split('/')))).size
  const games = gameSlugs(Object.keys(index).map((p) => ({ path: p })))
  const sortedFailed = [...failed].sort()
  await writeState({
    installedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    source: GAMES_BASE,
    manifestGeneratedAt: generatedAt,
    files: Object.keys(index).length,
    bytes: total,
    games,
    failed: sortedFailed.slice(0, 500),
    incompleteGames: incompleteGames(sortedFailed),
    external,
  })
  if (failed.length) log(`AVISO: ${failed.length} archivo(s) no se pudieron verificar; juegos incompletos: ${incompleteGames(failed).join(', ') || '—'}`)
  log(`Copia instalada: ${Object.keys(index).length} archivos, ${(total / 1024 ** 3).toFixed(2)} GB, ${games.length} juegos`)
}

export async function remove() {
  const cur = path.join(ROOT, 'current')
  await fs.unlink(cur).catch(() => fs.rm(cur, { force: true }).catch(() => {}))
  await fs.rm(path.join(ROOT, 'state.json'), { force: true })
  await fs.rm(path.join(ROOT, 'releases'), { recursive: true, force: true })
  log('Copia de los juegos eliminada')
}

if (import.meta.main) {
  const action = process.argv[2]
  const run = action === 'sync' ? sync : action === 'remove' ? remove : null
  if (!run) {
    process.stderr.write('uso: node games-sync.mjs sync|remove\n')
    process.exit(2)
  }
  run().then(
    () => process.exit(0),
    (e) => {
      log(`ERROR: ${e instanceof SyncError ? e.message : (e?.stack ?? e)}`)
      process.exit(1)
    },
  )
}
