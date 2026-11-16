#!/usr/bin/env node
/**
 * Tareas de mantenimiento de la versión portable que en la Pi hace admin-job.py como root (ADR 0014):
 * memorias USB y discos externos, importar mapas y documentos, copia de seguridad, preparar una
 * actualización y preparar otra memoria USB con Survival OS (ADR 0019). Mismo contrato: registro por stdout (el servidor web lo guarda en <admin>/<tarea>.log) y
 * resultado en <admin>/<tarea>.result.json. Node sin dependencias; Windows, macOS y Linux.
 *
 *   node portable-admin.mjs <tarea> '<json de parámetros>' --root <carpeta portable> --admin <dir>
 */
import { createHash } from 'node:crypto'
import {
  closeSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
  renameSync, rmSync, statfsSync, statSync, writeFileSync, appendFileSync, chmodSync,
} from 'node:fs'
import { hostname, platform } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
// Mismo árbol en el repositorio (scripts/ + portable/) y en la carpeta portable (app/scripts/ + app/portable/).
import { mountedMedia as listMedia, prepareUsb } from '../portable/usb.mjs'

const [job, rawParams = '{}'] = process.argv.slice(2)
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ROOT = resolve(arg('--root') ?? '.')
const DATA = process.env.SURVIVAL_PORTABLE_DATA || join(ROOT, 'data')
const ADMIN = arg('--admin') ?? join(DATA, 'admin')
const params = JSON.parse(rawParams)

const DOC_EXT = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.pdf'])
const MAP_RE = /^[A-Za-z0-9_-]{1,80}\.pmtiles$/
/** Versión portable: survival-os-0.9.0-portable.zip o survival-os-0.9.0-portable-win-x64.zip. */
const RELEASE_RE = /^survival-os-\d+\.\d+\.\d+-portable(-[a-z0-9-]+)?\.zip$/

class JobError extends Error {}
const log = (msg) => process.stdout.write(`${new Date().toTimeString().slice(0, 8)} ${msg}\n`)
const gib = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`

// ------------------------------------------------------------------ medios

/** Memorias USB y discos montados (ver portable/usb.mjs): el id «grupo/etiqueta» se valida contra esta lista. */
function mountedMedia() {
  try {
    return listMedia()
  } catch (err) {
    throw new JobError(err instanceof Error ? err.message : String(err))
  }
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** Ruta dentro de un medio, sin escapar por '..' ni enlaces. */
function mediaPath(id, rel = '') {
  const m = mountedMedia().find((x) => x.media === id)
  if (!m) throw new JobError('el medio no está conectado')
  if (!rel) return m.path
  if (typeof rel !== 'string' || rel.startsWith('/') || rel.includes('\0') || rel.split('/').includes('..')) throw new JobError('ruta no válida')
  const full = resolve(m.path, ...rel.split('/'))
  const rootReal = resolve(m.path)
  if (full !== rootReal && !full.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)) throw new JobError('ruta fuera del medio')
  return full
}

function classify(name) {
  const low = name.toLowerCase()
  if (low.endsWith('.pmtiles')) return 'map'
  if (RELEASE_RE.test(name)) return 'release'
  if (DOC_EXT.has(extname(low))) return 'doc'
  return null
}

function writeResult(data) {
  mkdirSync(ADMIN, { recursive: true })
  writeFileSync(join(ADMIN, `${job}.result.json`), JSON.stringify(data))
}

function sha256File(path) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko)
  })
}

function freeBytes(path) {
  const st = statfsSync(path)
  return st.bavail * st.bsize
}

// ------------------------------------------------------------------ tareas

function usbScan() {
  const media = mountedMedia()
  const files = []
  const deadline = Date.now() + 20_000 // discos grandes: no recorrerlos enteros
  for (const m of media) {
    const walk = (dir, depth) => {
      if (files.length >= 1000 || Date.now() > deadline) return
      let entries = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('$') || e.isSymbolicLink()) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          if (depth < 4 && !/^(System Volume Information|Windows|Program Files.*|ProgramData|node_modules)$/i.test(e.name)) walk(full, depth + 1)
          continue
        }
        const kind = classify(e.name)
        if (!kind) continue
        try {
          files.push({ media: m.media, path: relative(m.path, full).split(sep).join('/'), sizeBytes: statSync(full).size, kind })
        } catch {
          // desaparecido entre medias
        }
        if (files.length >= 1000) return
      }
    }
    walk(m.path, 0)
  }
  writeResult({ media: media.map(({ media: id, freeBytes: f }) => ({ media: id, freeBytes: f })), files, scannedAt: new Date().toISOString() })
  log(`${media.length} medio(s), ${files.length} fichero(s) utilizables`)
}

async function mapsImport() {
  const src = mediaPath(params.media, params.path)
  const name = basename(src)
  if (!MAP_RE.test(name) || !existsSync(src)) throw new JobError('no es un fichero .pmtiles válido')
  const head = Buffer.alloc(8)
  const fd = openSync(src, 'r')
  readSync(fd, head, 0, 8, 0)
  closeSync(fd)
  // Firma «PMTiles» + versión 3 (la que leen el visor y pmtiles extract).
  if (head.toString('latin1', 0, 7) !== 'PMTiles' || head[7] !== 3) throw new JobError('no es un archivo PMTiles v3')
  const dir = join(DATA, 'maps')
  mkdirSync(dir, { recursive: true })
  const size = statSync(src).size
  if (size > freeBytes(dir) - 2 * 1024 ** 3) throw new JobError('espacio insuficiente')
  log(`Copiando ${name} (${gib(size)})…`)
  copyFileSync(src, join(dir, `${name}.part`))
  renameSync(join(dir, `${name}.part`), join(dir, name))
  const sum = await sha256File(join(dir, name))
  appendFileSync(join(dir, 'SHA256SUMS'), `${sum}  ${name}\n`)
  log(`Instalado ${name} (sha256 ${sum})`)
}

async function docsImport() {
  const items = params.items
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) throw new JobError('lista de documentos no válida')
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const dest = join(DATA, 'library', 'docs', `importados-${stamp}`)
  mkdirSync(dest, { recursive: true })
  let n = 0
  for (const it of items) {
    const src = mediaPath(it.media, it.path)
    const name = basename(src)
    if (classify(name) !== 'doc' || !existsSync(src)) {
      log(`Omitido (tipo no admitido): ${name}`)
      continue
    }
    if (statSync(src).size > 50 * 1024 * 1024) {
      log(`Omitido (> 50 MB): ${name}`)
      continue
    }
    copyFileSync(src, join(dest, name))
    n++
  }
  log(`Importados ${n} documento(s) en ${dest}`)
  // A diferencia de la Pi (botón «Reindexar»), aquí se reindexa sola: el servicio está en este mismo equipo.
  const lib = process.env.NUXT_LIBRARY_URL
  if (lib && n > 0) {
    const ok = await fetch(`${lib}/reindex`, { method: 'POST', signal: AbortSignal.timeout(15_000) }).then((r) => r.ok, () => false)
    log(ok ? 'Biblioteca reindexada' : 'Pulsa «Reindexar» en Biblioteca para buscarlos')
  }
}

/** Copia del árbol `rel` de los datos a la copia, contando bytes. */
function sizeOf(path) {
  let total = 0
  const st = statSync(path)
  if (st.isFile()) return st.size
  for (const e of readdirSync(path, { withFileTypes: true })) total += sizeOf(join(path, e.name))
  return total
}

async function backup() {
  const root = mediaPath(params.media)
  const candidates = ['navigation', 'library/docs', 'library/manifest.json', 'vault', 'serial-hub', 'setup.json', 'share.json']
  if (params.withMaps === true) candidates.push('maps')
  if (params.withZim === true) candidates.push('library/zim')
  const paths = candidates.filter((p) => existsSync(join(DATA, ...p.split('/'))))
  if (!paths.length) throw new JobError('nada que copiar')
  const need = paths.reduce((s, p) => s + sizeOf(join(DATA, ...p.split('/'))), 0)
  if (need >= freeBytes(root)) throw new JobError(`espacio insuficiente en el medio (hacen falta ${gib(need)})`)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const dest = join(root, `survival-os-backup-${hostname().replace(/[^\w.-]/g, '_')}-${stamp}`)
  mkdirSync(join(dest, 'data'), { recursive: true })
  for (const p of paths) {
    log(`==> ${p === 'vault' ? 'Bóveda (cifrada)' : p}`)
    cpSync(join(DATA, ...p.split('/')), join(dest, 'data', ...p.split('/')), { recursive: true })
  }
  writeFileSync(join(dest, 'VERSION'), readFileSafe(join(ROOT, 'app', 'VERSION')) || 'desconocida\n')
  writeFileSync(join(dest, 'RESTAURAR.txt'), [
    'Copia de seguridad de Survival OS (versión portable).',
    '',
    'Para restaurarla: cierra Survival OS y copia el contenido de la carpeta «data» de esta copia',
    'dentro de la carpeta «data» de Survival OS (sustituyendo los ficheros). La bóveda va cifrada:',
    'se abre con la misma contraseña o clave de recuperación de siempre.',
    '',
  ].join('\n'))
  // Sumas de verificación de todo, comprobadas al terminar (como sha256sum -c en la Pi).
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name !== 'SHA256SUMS') files.push(full)
    }
  }
  walk(dest)
  const lines = []
  for (const f of files.sort()) lines.push(`${await sha256File(f)}  ${relative(dest, f).split(sep).join('/')}`)
  writeFileSync(join(dest, 'SHA256SUMS'), `${lines.join('\n')}\n`)
  for (const l of lines) {
    const [sum, rel] = [l.slice(0, 64), l.slice(66)]
    if ((await sha256File(join(dest, ...rel.split('/')))) !== sum) throw new JobError(`verificación fallida: ${rel}`)
  }
  log(`==> Copia verificada en ${dest} (${gib(need)}, ${files.length} ficheros)`)
}

// ------------------------------------------------------------------ actualizar

/** Lee un zip (sin Zip64, como los que genera release-portable.mjs) y extrae bajo `dest`. */
function extractZip(zipFile, dest, onProgress) {
  const buf = readFileSync(zipFile)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new JobError('zip no válido')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const destReal = resolve(dest)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new JobError('zip dañado')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const attrs = buf.readUInt32LE(p + 38)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    const out = resolve(destReal, ...name.split('/'))
    if (!out.startsWith(destReal + sep)) throw new JobError(`ruta peligrosa en el zip: ${name}`)
    if (name.endsWith('/')) {
      mkdirSync(out, { recursive: true })
      continue
    }
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null
    if (!data) throw new JobError(`compresión no soportada en ${name}`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
    const mode = (attrs >>> 16) & 0o777
    if (platform() !== 'win32' && mode) chmodSync(out, mode)
    if (n % 200 === 0) onProgress(n, count)
  }
}

function platformKey() {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux' }[platform()]
  return `${os}-${process.arch}`
}

/**
 * Prepara la actualización desde un zip de la versión portable (+ .sha256 al lado, como en la Pi): verifica,
 * extrae en <raíz>/.update/staging y deja .update/ready.json. El servidor web avisa al lanzador, que la aplica
 * al cerrarse (apply-update.mjs): los datos no se tocan.
 */
async function update() {
  const src = mediaPath(params.media, params.path)
  const name = basename(src)
  if (!RELEASE_RE.test(name) || !existsSync(src)) throw new JobError('no es una versión portable de Survival OS')
  if (!existsSync(`${src}.sha256`)) throw new JobError('falta el fichero .sha256 junto al zip')
  const expected = readFileSafe(`${src}.sha256`).trim().split(/\s+/)[0]?.toLowerCase()
  log(`Comprobando ${name}…`)
  const actual = await sha256File(src)
  if (!expected || expected !== actual) throw new JobError('el SHA-256 no coincide: zip dañado o incompleto')
  log('SHA-256 correcto')
  const updDir = join(ROOT, '.update')
  rmSync(updDir, { recursive: true, force: true })
  const size = statSync(src).size
  if (size * 3 > freeBytes(ROOT)) throw new JobError('espacio insuficiente para preparar la actualización')
  const staging = join(updDir, 'staging')
  mkdirSync(staging, { recursive: true })
  log('Extrayendo…')
  extractZip(src, staging, (n, total) => log(`  ${Math.round((n / total) * 100)} %`))
  // El zip trae una carpeta «Survival OS/»: su contenido sustituye a la instalación actual.
  const top = readdirSync(staging)
  const base = top.length === 1 && statSync(join(staging, top[0])).isDirectory() ? join(staging, top[0]) : staging
  const key = platformKey()
  const nodeBin = join(base, 'runtime', key, platform() === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(join(base, 'app', 'portable', 'launcher.mjs'))) throw new JobError('el zip no contiene la aplicación')
  if (!existsSync(nodeBin)) throw new JobError(`esta versión no incluye este sistema (${key})`)
  const version = readFileSafe(join(base, 'app', 'VERSION')).trim()
  writeFileSync(join(updDir, 'ready.json'), JSON.stringify({ version, from: readFileSafe(join(ROOT, 'app', 'VERSION')).trim(), base: relative(ROOT, base), preparedAt: new Date().toISOString() }))
  log(`Versión ${version} lista. Survival OS se reiniciará para aplicarla; los datos no se tocan.`)
}

// ------------------------------------------------------------------ preparar una memoria USB (ADR 0019)

/**
 * Copia Survival OS (y opcionalmente los datos) a la raíz de otra memoria USB y la integra en Windows, macOS y
 * Linux: icono y nombre de la unidad, carpetas internas ocultas, identificador para «abrir al conectar».
 */
async function usbPrepare() {
  const m = mountedMedia().find((x) => x.media === params.media)
  if (!m) throw new JobError('el medio no está conectado')
  const version = readFileSafe(join(ROOT, 'app', 'VERSION')).trim()
  log(`Preparando ${m.label || m.media}${m.fs ? ` (${m.fs})` : ''}…`)
  let r
  try {
    r = await prepareUsb({ root: ROOT, data: DATA, target: m.path, fs: m.fs, withData: params.withData === true, rename: params.rename !== false, version, log })
  } catch (err) {
    throw new JobError(err instanceof Error ? err.message : String(err))
  }
  writeResult({ media: m.media, ...r })
  log(`==> Memoria lista (${gib(r.copiedBytes)}). Conéctala en cualquier equipo y abre «Survival OS».`)
}

// ------------------------------------------------------------------ principal

const JOBS = { 'usb-scan': usbScan, 'maps-import': mapsImport, 'docs-import': docsImport, backup, update, 'usb-prepare': usbPrepare }
try {
  if (!Object.hasOwn(JOBS, job)) throw new JobError(`tarea desconocida: ${job}`)
  await JOBS[job]()
} catch (err) {
  process.stdout.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
