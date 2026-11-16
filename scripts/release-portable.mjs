#!/usr/bin/env node
/**
 * Versión portable (ADR 0014): carpeta autocontenida para Windows, macOS y Linux.
 *   npm run build && npm run release:portable [-- --targets=win-x64,darwin-arm64] [--no-zip]
 * Resultado:
 *   release/portable/Survival OS/             carpeta lista para copiar a un USB o a un disco
 *   release/survival-os-<v>-portable.zip      la misma carpeta comprimida (+ .sha256)
 * El zip guarda permisos Unix (node, .sh, .app ejecutables): se descomprime bien en macOS y Linux.
 * Node se descarga de nodejs.org y se verifica con su SHASUMS256.txt (caché en .data/portable-cache).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, deflateSync } from 'node:zlib'
import { TARGETS } from '../portable/lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const NODE_VERSION = 'v24.22.2' // la misma que en la Pi (install-system.sh)
const argTargets = process.argv.find((a) => a.startsWith('--targets='))
const targets = argTargets ? argTargets.slice(10).split(',').filter(Boolean) : TARGETS
const makeZip = !process.argv.includes('--no-zip')
const outDir = join(root, 'release')
const stage = join(outDir, 'portable', 'Survival OS')
const cache = join(root, '.data', 'portable-cache')

const fail = (m) => {
  console.error(`[portable] ${m}`)
  process.exit(1)
}
for (const t of targets) if (!TARGETS.includes(t)) fail(`Destino desconocido: ${t} (válidos: ${TARGETS.join(', ')})`)
for (const f of ['apps/frontend/.output/server/index.mjs', 'services/device-api/dist/server.js', 'services/library/dist/server.js', 'services/navigation/dist/server.js']) {
  if (!existsSync(join(root, f))) fail(`Falta ${f}. Ejecuta "npm run build" primero.`)
}

// ------------------------------------------------------------------ Node por plataforma

async function download(url, file) {
  if (existsSync(file)) return
  console.log(`[portable] Descargando ${url}`)
  const res = await fetch(url)
  if (!res.ok) fail(`${url}: HTTP ${res.status}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const tarBin = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

async function fetchNode(key) {
  const [os, arch] = key.split('-')
  const base = `node-${NODE_VERSION}-${os}-${arch}`
  const archive = os === 'win' ? `${base}.zip` : `${base}.tar.gz`
  const sums = join(cache, NODE_VERSION, 'SHASUMS256.txt')
  await download(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`, sums)
  const file = join(cache, NODE_VERSION, archive)
  await download(`https://nodejs.org/dist/${NODE_VERSION}/${archive}`, file)
  const expected = readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(`  ${archive}`))?.split(/\s+/)[0]
  if (!expected || expected !== sha256(file)) {
    rmSync(file, { force: true })
    fail(`Checksum incorrecto de ${archive} (descarga borrada; vuelve a intentarlo)`)
  }
  const tmp = join(cache, NODE_VERSION, `x-${key}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const members = os === 'win' ? [`${base}/node.exe`, `${base}/LICENSE`] : [`${base}/bin/node`, `${base}/LICENSE`]
  const r = spawnSync(tarBin, ['-xf', file, '-C', tmp, ...members], { encoding: 'utf8' })
  if (r.status !== 0) fail(`No se pudo extraer ${archive}: ${r.stderr}`)
  const dest = join(stage, 'runtime', key)
  mkdirSync(dest, { recursive: true })
  const bin = os === 'win' ? 'node.exe' : 'node'
  cpSync(join(tmp, members[0]), join(dest, bin))
  cpSync(join(tmp, `${base}/LICENSE`), join(dest, 'LICENSE-node.txt'))
  rmSync(tmp, { recursive: true, force: true })
}

// ------------------------------------------------------------------ Icono (brújula) sin dependencias

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}

/** PNG RGBA 256×256: cuadrado redondeado verde oscuro, anillo y aguja de brújula. Supermuestreo 4×. */
function makeIconPng(size = 256) {
  const S = 4
  const px = Buffer.alloc(size * size * 4)
  const c = size / 2
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const BG = hex('#13241b')
  const RING = hex('#8fd19e')
  const NORTH = hex('#f2f7f3')
  const SOUTH = hex('#5f8f6b')
  const tri = (x, y, a, b, d) => {
    const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    const p = [x, y]
    const d1 = s(p, a, b)
    const d2 = s(p, b, d)
    const d3 = s(p, d, a)
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  }
  const sample = (x, y) => {
    const r = 44
    const qx = Math.max(Math.abs(x - c) - (c - 8 - r), 0)
    const qy = Math.max(Math.abs(y - c) - (c - 8 - r), 0)
    if (Math.hypot(qx, qy) > r) return null
    const d = Math.hypot(x - c, y - c)
    if (d > 80 && d < 94) return RING
    if (tri(x, y, [c, c - 70], [c - 20, c], [c + 20, c])) return NORTH
    if (tri(x, y, [c, c + 70], [c - 20, c], [c + 20, c])) return SOUTH
    return BG
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const col = sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S)
          if (col) {
            r += col[0]
            g += col[1]
            b += col[2]
            a++
          }
        }
      }
      const i = (y * size + x) * 4
      if (a) {
        px[i] = Math.round(r / a)
        px[i + 1] = Math.round(g / a)
        px[i + 2] = Math.round(b / a)
      }
      px[i + 3] = Math.round((a / (S * S)) * 255)
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))])
}

/** ICO (Windows) con un PNG de 256 px embebido. */
function icoFromPng(png) {
  const h = Buffer.alloc(22)
  h.writeUInt16LE(0, 0)
  h.writeUInt16LE(1, 2)
  h.writeUInt16LE(1, 4)
  h.writeUInt8(0, 6) // 0 = 256
  h.writeUInt8(0, 7)
  h.writeUInt16LE(1, 10)
  h.writeUInt16LE(32, 12)
  h.writeUInt32LE(png.length, 14)
  h.writeUInt32LE(22, 18)
  return Buffer.concat([h, png])
}

/** ICNS (macOS) con la entrada ic08 (PNG 256 px). */
function icnsFromPng(png) {
  const entry = Buffer.alloc(8)
  entry.write('ic08', 0, 'ascii')
  entry.writeUInt32BE(8 + png.length, 4)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(16 + png.length, 4)
  return Buffer.concat([head, entry, png])
}

// ------------------------------------------------------------------ Zip con permisos Unix

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Escribe `dir` en un zip (prefijo `prefix/`). `isExec(rel)` decide el modo 0755. Sin Zip64: < 4 GiB. */
function writeZip(dir, zipFile, prefix, isExec) {
  const fd = openSync(zipFile, 'w')
  const central = []
  let offset = 0
  const { time, date } = dosTime(new Date())
  const put = (buf) => {
    writeSync(fd, buf)
    offset += buf.length
  }
  const add = (name, data, mode) => {
    const nameBuf = Buffer.from(name, 'utf8')
    const isDir = name.endsWith('/')
    const crc = isDir ? 0 : crc32(data) >>> 0
    const comp = isDir ? Buffer.alloc(0) : deflateRawSync(data, { level: 6 })
    const store = !isDir && comp.length >= data.length
    const body = isDir ? comp : store ? data : comp
    const method = isDir || store ? 0 : 8
    if (offset + 30 + nameBuf.length + body.length > 0xffffffff) fail('El zip supera 4 GiB (sin Zip64)')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(isDir ? 0 : data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    const at = offset
    put(local)
    put(nameBuf)
    put(body)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE((3 << 8) | 20, 4) // creado en Unix: los permisos van en el atributo externo
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(isDir ? 0 : data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE((((mode & 0xffff) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38)
    cd.writeUInt32LE(at, 42)
    central.push(Buffer.concat([cd, nameBuf]))
  }
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(abs, e.name)
      const rel = relative(dir, p).split(sep).join('/')
      if (e.isDirectory()) {
        add(`${prefix}/${rel}/`, null, 0o40755)
        walk(p)
      } else if (e.isFile()) {
        add(`${prefix}/${rel}`, readFileSync(p), isExec(rel) ? 0o100755 : 0o100644)
      }
    }
  }
  add(`${prefix}/`, null, 0o40755)
  walk(dir)
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  writeSync(fd, cdBuf)
  writeSync(fd, end)
  closeSync(fd)
  if (central.length > 0xffff) fail('Demasiados ficheros para un zip sin Zip64')
}

// ------------------------------------------------------------------ Montaje de la carpeta

rmSync(join(outDir, 'portable'), { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const app = join(stage, 'app')
const copy = (from, to) => cpSync(join(root, from), join(app, to ?? from), { recursive: true })

copy('apps/frontend/.output', 'web')
for (const svc of ['device-api', 'library', 'navigation', 'serial-hub', 'vault']) {
  copy(`services/${svc}/dist`)
  copy(`services/${svc}/package.json`)
}
copy('content')
copy('scripts/games-server.mjs')
copy('scripts/content-engine.mjs')
copy('scripts/public-gateway.mjs')
copy('scripts/games-sync.mjs')
copy('scripts/portable-admin.mjs')
for (const f of ['launcher.mjs', 'lib.mjs', 'install.mjs', 'apply-update.mjs', 'win/survival-os.vbs']) copy(`portable/${f}`)
writeFileSync(join(app, 'VERSION'), `${version}\n`)
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'survival-os-portable', version, private: true, type: 'module' }, null, 2))

const png = makeIconPng()
writeFileSync(join(app, 'portable', 'icon.png'), png)
writeFileSync(join(app, 'portable', 'icon.ico'), icoFromPng(png))

// Lanzadores por sistema.
cpSync(join(root, 'portable', 'files', 'Abrir Survival OS.cmd'), join(stage, 'Abrir Survival OS.cmd'))
cpSync(join(root, 'portable', 'files', 'abrir-survival-os.sh'), join(stage, 'abrir-survival-os.sh'))
const macApp = join(stage, 'Survival OS.app', 'Contents')
mkdirSync(join(macApp, 'MacOS'), { recursive: true })
mkdirSync(join(macApp, 'Resources'), { recursive: true })
writeFileSync(join(macApp, 'Info.plist'), readFileSync(join(root, 'portable', 'macos', 'Info.plist'), 'utf8').replaceAll('__VERSION__', version))
cpSync(join(root, 'portable', 'macos', 'survival-os'), join(macApp, 'MacOS', 'survival-os'))
writeFileSync(join(macApp, 'Resources', 'icon.icns'), icnsFromPng(png))
cpSync(join(root, 'portable', 'LEEME.txt'), join(stage, 'LEEME.txt'))
mkdirSync(join(stage, 'data'), { recursive: true })
cpSync(join(root, 'portable', 'data-LEEME.txt'), join(stage, 'data', 'LEEME.txt'))

for (const t of targets) await fetchNode(t)

// Permisos locales (si se monta en macOS/Linux) y en el zip.
const isExec = (rel) =>
  /^runtime\/[^/]+\/node$/.test(rel) || rel === 'abrir-survival-os.sh' || rel === 'Survival OS.app/Contents/MacOS/survival-os'
if (process.platform !== 'win32') {
  for (const rel of ['abrir-survival-os.sh', 'Survival OS.app/Contents/MacOS/survival-os', ...targets.filter((t) => !t.startsWith('win')).map((t) => `runtime/${t}/node`)]) {
    chmodSync(join(stage, rel), 0o755)
  }
}

// Comprobación: el servidor web empaquetado debe tener sus dependencias trazadas.
const serverDeps = Object.keys(JSON.parse(readFileSync(join(app, 'web', 'server', 'package.json'), 'utf8')).dependencies ?? {})
const missing = serverDeps.filter((d) => !existsSync(join(app, 'web', 'server', 'node_modules', d, 'package.json')))
if (missing.length) fail(`.output incompleto, faltan: ${missing.join(', ')}`)

const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0)
console.log(`[portable] Carpeta: ${stage} (${(size(stage) / 1024 ** 2).toFixed(0)} MB; ${targets.join(', ')})`)

if (makeZip) {
  const suffix = argTargets ? `-${targets.join('+')}` : ''
  const zip = join(outDir, `survival-os-${version}-portable${suffix}.zip`)
  writeZip(stage, zip, 'Survival OS', isExec)
  const sum = sha256(zip)
  writeFileSync(`${zip}.sha256`, `${sum}  ${zip.split(sep).pop()}\n`)
  console.log(`[portable] ${relative(root, zip)} (${(statSync(zip).size / 1024 ** 2).toFixed(0)} MB) sha256=${sum}`)
}
