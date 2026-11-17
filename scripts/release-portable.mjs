#!/usr/bin/env node
/**
 * Versión portable (ADR 0014): carpeta autocontenida para Windows, macOS y Linux.
 *   npm run build && npm run release:portable [-- --targets=win-x64,darwin-arm64] [--no-zip]
 * Resultado:
 *   release/portable/Survivelia OS/             carpeta lista para copiar a un USB o a un disco
 *   release/survival-os-<v>-portable.zip      la misma carpeta comprimida (+ .sha256)
 * El zip guarda permisos Unix (node, .sh, .app ejecutables): se descomprime bien en macOS y Linux.
 * Node se descarga de nodejs.org y se verifica con su SHASUMS256.txt (caché en .data/portable-cache).
 * En Windows se compila además «Survivelia OS.exe» (lanzador con icono y vigilante de memorias USB, ADR 0019).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeIcns, makeIco } from '../portable/icon.mjs'
import { TARGETS } from '../portable/lib.mjs'
import { missingBuild, stageApp, writeZip } from './stage-app.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const NODE_VERSION = 'v24.22.2' // la misma que en la Pi (install-system.sh)
const argTargets = process.argv.find((a) => a.startsWith('--targets='))
const targets = argTargets ? argTargets.slice(10).split(',').filter(Boolean) : TARGETS
const makeZip = !process.argv.includes('--no-zip')
const outDir = join(root, 'release')
const stage = join(outDir, 'portable', 'Survivelia OS')
const cache = join(root, '.data', 'portable-cache')

const fail = (m) => {
  console.error(`[portable] ${m}`)
  process.exit(1)
}
for (const t of targets) if (!TARGETS.includes(t)) fail(`Destino desconocido: ${t} (válidos: ${TARGETS.join(', ')})`)
for (const f of missingBuild(root)) fail(`Falta ${f}. Ejecuta "npm run build" primero.`)

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

/**
 * libgomp (OpenMP de GCC) para Linux: el llama-server publicado para Ubuntu la necesita y un Ubuntu/Debian de
 * escritorio recién instalado no siempre la trae (sin ella el asistente no arranca: «libgomp.so.1: cannot open
 * shared object file»). Se toma de conda-forge (glibc ≥ 2.17) con SHA-256 fijado y va en runtime/<so-arq>/lib,
 * que el lanzador añade a LD_LIBRARY_PATH.
 */
const LIBGOMP = {
  'linux-x64': { url: 'https://conda.anaconda.org/conda-forge/linux-64/libgomp-12.2.0-h65d4601_19.tar.bz2', sha256: '81a76d20cfdee9fe0728b93ef057ba93494fd1450d42bc3717af4e468235661e' },
  'linux-arm64': { url: 'https://conda.anaconda.org/conda-forge/linux-aarch64/libgomp-12.2.0-h607ecd0_19.tar.bz2', sha256: 'd802eaceaf6f77fb8cb2e990aacf9b3eaa83361b16369a760fc1585841d7885c' },
}

async function fetchLibgomp(key) {
  const src = LIBGOMP[key]
  if (!src) return
  const file = join(cache, 'libgomp', src.url.split('/').pop())
  await download(src.url, file)
  if (sha256(file) !== src.sha256) {
    rmSync(file, { force: true })
    fail(`Checksum incorrecto de ${file} (descarga borrada; vuelve a intentarlo)`)
  }
  const tmp = join(cache, 'libgomp', `x-${key}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const r = spawnSync(tarBin, ['-xf', file, '-C', tmp, 'lib/libgomp.so.1.0.0', 'share/licenses/gcc-libs/RUNTIME.LIBRARY.EXCEPTION.gomp_copy'], { encoding: 'utf8' })
  if (r.status !== 0) fail(`No se pudo extraer ${file}: ${r.stderr}`)
  const dest = join(stage, 'runtime', key, 'lib')
  mkdirSync(dest, { recursive: true })
  // El paquete solo trae libgomp.so.1.0.0 (el enlace lo crea conda al instalar): se copia con su soname.
  cpSync(join(tmp, 'lib', 'libgomp.so.1.0.0'), join(dest, 'libgomp.so.1'))
  cpSync(join(tmp, 'share', 'licenses', 'gcc-libs', 'RUNTIME.LIBRARY.EXCEPTION.gomp_copy'), join(dest, 'LICENSE-libgomp.txt'))
  rmSync(tmp, { recursive: true, force: true })
}

// ------------------------------------------------------------------ Montaje de la carpeta

rmSync(join(outDir, 'portable'), { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const app = join(stage, 'app')
try {
  stageApp(root, app, version)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
// Iconos de los lanzadores (la carpeta app/ ya trae los suyos).
const icns = makeIcns()
const ico = makeIco()

// Lanzadores por sistema.
// Windows: «Survivelia OS.exe» con icono propio (ADR 0019), compilado con el csc.exe de .NET Framework 4 que trae
// Windows. Sin él (empaquetado fuera de Windows) se usa «Abrir Survivelia OS.cmd» y no hay «abrir al conectar».
const csc = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : null
let builtExe = false
if (targets.includes('win-x64') && csc && existsSync(csc)) {
  const tmp = join(cache, 'win-launcher')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  // Versión de ensamblado: solo números (0.8.0 → 0.8.0.0).
  writeFileSync(join(tmp, 'SurvivalOS.cs'), readFileSync(join(root, 'portable', 'win', 'SurvivalOS.cs'), 'utf8').replaceAll('__VERSION__', version.replace(/[^0-9.]/g, '').split('.').slice(0, 3).join('.')))
  writeFileSync(join(tmp, 'icon.ico'), ico)
  const r = spawnSync(csc, ['-nologo', '-target:winexe', '-optimize+', '-win32icon:icon.ico', '-r:System.Management.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-out:Survivelia OS.exe', 'SurvivalOS.cs'], { cwd: tmp, encoding: 'utf8' })
  if (r.status !== 0) fail(`No se pudo compilar «Survivelia OS.exe»:\n${r.stdout}${r.stderr}`)
  cpSync(join(tmp, 'Survivelia OS.exe'), join(stage, 'Survivelia OS.exe'))
  builtExe = true
} else if (targets.includes('win-x64')) {
  console.warn('[portable] AVISO: sin csc.exe (empaquetado fuera de Windows): Windows usará «Abrir Survivelia OS.cmd», sin icono propio ni «abrir al conectar».')
}
if (!builtExe && targets.includes('win-x64')) cpSync(join(root, 'portable', 'files', 'Abrir Survivelia OS.cmd'), join(stage, 'Abrir Survivelia OS.cmd'))
cpSync(join(root, 'portable', 'files', 'abrir-survival-os.sh'), join(stage, 'abrir-survival-os.sh'))
const macApp = join(stage, 'Survivelia OS.app', 'Contents')
mkdirSync(join(macApp, 'MacOS'), { recursive: true })
mkdirSync(join(macApp, 'Resources'), { recursive: true })
writeFileSync(join(macApp, 'Info.plist'), readFileSync(join(root, 'portable', 'macos', 'Info.plist'), 'utf8').replaceAll('__VERSION__', version))
cpSync(join(root, 'portable', 'macos', 'survival-os'), join(macApp, 'MacOS', 'survival-os'))
writeFileSync(join(macApp, 'Resources', 'icon.icns'), icns)
cpSync(join(root, 'portable', 'LEEME.txt'), join(stage, 'LEEME.txt'))
mkdirSync(join(stage, 'data'), { recursive: true })
cpSync(join(root, 'portable', 'data-LEEME.txt'), join(stage, 'data', 'LEEME.txt'))

for (const t of targets) {
  await fetchNode(t)
  await fetchLibgomp(t)
}

// Permisos locales (si se monta en macOS/Linux) y en el zip.
const isExec = (rel) =>
  /^runtime\/[^/]+\/node$/.test(rel) || ['abrir-survival-os.sh', 'Survivelia OS.app/Contents/MacOS/survival-os', 'app/portable/usb-watch.sh'].includes(rel)
if (process.platform !== 'win32') {
  for (const rel of ['abrir-survival-os.sh', 'Survivelia OS.app/Contents/MacOS/survival-os', 'app/portable/usb-watch.sh', ...targets.filter((t) => !t.startsWith('win')).map((t) => `runtime/${t}/node`)]) {
    chmodSync(join(stage, rel), 0o755)
  }
}

const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0)
console.log(`[portable] Carpeta: ${stage} (${(size(stage) / 1024 ** 2).toFixed(0)} MB; ${targets.join(', ')})`)

if (makeZip) {
  const suffix = argTargets ? `-${targets.join('+')}` : ''
  const zip = join(outDir, `survival-os-${version}-portable${suffix}.zip`)
  writeZip(stage, zip, 'Survivelia OS', isExec)
  const sum = sha256(zip)
  writeFileSync(`${zip}.sha256`, `${sum}  ${zip.split(sep).pop()}\n`)
  console.log(`[portable] ${relative(root, zip)} (${(statSync(zip).size / 1024 ** 2).toFixed(0)} MB) sha256=${sum}`)
}
