#!/usr/bin/env node
/**
 * Binarios nativos del APK (ADR 0020), por ABI (arm64-v8a para tablets, x86_64 para el emulador y Chromebooks):
 *
 *   - Node 24 LTS y kiwix-tools (kiwix-serve, kiwix-manage) con sus bibliotecas: paquetes de Termux
 *     (compilados para Android/bionic, segmentos alineados a 16 KB). SHA-256 del índice del repositorio;
 *     versiones fijadas en android/natives.lock.json.
 *   - llama-server: llama.cpp compilado aquí con el NDK, misma versión que el catálogo (content/catalog.json),
 *     con todas las variantes de CPU (se elige la mejor en el dispositivo).
 *   - pmtiles: go-pmtiles, misma versión que el catálogo, compilado para Android (GOOS=android, cgo con el NDK).
 *   - pdftotext: Xpdf, misma versión que el catálogo, compilado con el NDK.
 *   - BRouter: el jar del catálogo, que Android ejecuta como Java (sin JRE).
 *
 * Todo ejecutable va como `lib<nombre>.so` en android/app/src/main/jniLibs/<abi>/ (Android solo deja ejecutar
 * lo que instala del APK). Caché de descargas en .data/android-cache.
 *
 *   node android/scripts/natives.mjs [--abi=arm64-v8a,x86_64] [--update-lock] [--only=termux,llama,pmtiles,brouter]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { androidLibName, EM_AARCH64, EM_X86_64, isElf, minLoadAlign, parseElf, patchElf, setRunpathOrigin, SYSTEM_LIBS } from './elf.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ANDROID = join(ROOT, 'android')
const LOCK_FILE = join(ANDROID, 'natives.lock.json')
const CACHE = join(ROOT, '.data', 'android-cache')
const JNI = join(ANDROID, 'app', 'src', 'main', 'jniLibs')
const APP_LIBS = join(ANDROID, 'app', 'libs')
const TERMUX = 'https://packages.termux.dev/apt/termux-main'
const tarBin = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

export const ABIS = {
  'arm64-v8a': { termux: 'aarch64', machine: EM_AARCH64, catalog: 'linux-arm64', ndkTriple: 'aarch64-linux-android' },
  x86_64: { termux: 'x86_64', machine: EM_X86_64, catalog: 'linux-x64', ndkTriple: 'x86_64-linux-android' },
}

/** Paquetes raíz de Termux y los ejecutables que se toman de ellos (→ lib<nombre>.so). */
export const TERMUX_ROOTS = ['nodejs-lts', 'kiwix-tools']
export const TERMUX_BINS = { node: 'libnode.so', 'kiwix-serve': 'libkiwix-serve.so', 'kiwix-manage': 'libkiwix-manage.so' }
/** Dependencias de Termux que no son bibliotecas en tiempo de ejecución (o no hacen falta en la app). */
const TERMUX_SKIP = new Set(['ca-certificates', 'openssl-tool', 'resolv-conf', 'termux-exec', 'libandroid-glob', 'libandroid-posix-semaphore'])

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const say = (m) => console.log(`[android-natives] ${m}`)
const fail = (m) => {
  console.error(`[android-natives] ERROR: ${m}`)
  process.exit(1)
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function download(url, file, expected) {
  if (existsSync(file) && (!expected || sha256(file) === expected)) return file
  say(`Descargando ${url}`)
  mkdirSync(dirname(file), { recursive: true })
  const res = await fetch(url, { headers: { 'user-agent': 'survival-os-build' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  if (expected && sha256(file) !== expected) {
    rmSync(file, { force: true })
    throw new Error(`SHA-256 incorrecto: ${url}`)
  }
  return file
}

function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
  } catch {
    return { schemaVersion: 1, termux: {}, llama: null, pmtiles: null, brouter: null }
  }
}

// ------------------------------------------------------------------ Termux

/** Índice Packages de Debian → Map(nombre → campos). */
export function parsePackages(text) {
  const out = new Map()
  for (const stanza of text.split(/\n\n+/)) {
    const f = {}
    for (const line of stanza.split('\n')) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line)
      if (m) f[m[1]] = m[2]
    }
    if (f.Package) out.set(f.Package, f)
  }
  return out
}

/** Dependencias de un paquete (sin versiones ni alternativas: se toma la primera). */
export function depsOf(fields) {
  return (fields.Depends ?? '')
    .split(',')
    .map((d) => d.split('|')[0].trim().replace(/\s*\(.*\)$/, ''))
    .filter(Boolean)
}

/** Cierre de dependencias desde las raíces. */
export function closure(index, roots, skip = TERMUX_SKIP) {
  const seen = new Set()
  const stack = [...roots]
  while (stack.length) {
    const p = stack.pop()
    if (seen.has(p) || skip.has(p)) continue
    const f = index.get(p)
    if (!f) throw new Error(`paquete no encontrado en Termux: ${p}`)
    seen.add(p)
    stack.push(...depsOf(f))
  }
  return [...seen].sort()
}

/**
 * Extrae los ficheros regulares de bin/ y lib/ de un .deb. Los enlaces simbólicos no se extraen (en Windows no se
 * pueden crear): se devuelven como alias { name, target } para resolver DT_NEEDED de bibliotecas sin soname.
 */
function extractDeb(deb, dest) {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  let r = spawnSync(tarBin, ['-xf', deb, '-C', dest], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`no se pudo abrir ${deb}: ${r.stderr}`)
  const data = readdirSync(dest).find((f) => f.startsWith('data.tar'))
  if (!data) throw new Error(`${deb} sin data.tar`)
  const list = spawnSync(tarBin, ['-tvf', join(dest, data)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const links = list.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('l'))
    .map((l) => /\/usr\/lib\/([^/\s]+) -> ([^/\s]+)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ name: m[1], target: m[2] }))
  const members = list.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('-'))
    .map((l) => /\s((?:\.\/)?data\/data\/com\.termux\/files\/\S.*)$/.exec(l)?.[1]?.trim())
    .filter((m) => m && /\/usr\/(lib\/[^/]+\.so[.\d]*|bin\/[^/]+)$/.test(m))
  if (members.length) {
    r = spawnSync(tarBin, ['-xf', join(dest, data), '-C', dest, ...members], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`no se pudo extraer ${deb}: ${r.stderr}`)
  }
  return links
}

function walkFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

async function termux(abi, lock, updateLock) {
  const { termux: arch, machine } = ABIS[abi]
  const pinned = lock.termux[arch]
  let pkgs
  if (pinned && !updateLock) {
    pkgs = pinned
  } else {
    const idx = await (await fetch(`${TERMUX}/dists/stable/main/binary-${arch}/Packages`)).text()
    const index = parsePackages(idx)
    pkgs = {}
    for (const p of closure(index, TERMUX_ROOTS)) {
      const f = index.get(p)
      pkgs[p] = { version: f.Version, filename: f.Filename, sha256: f.SHA256 }
    }
    lock.termux[arch] = pkgs
  }
  const work = join(CACHE, 'termux', arch, 'x')
  rmSync(work, { recursive: true, force: true })
  const elfs = []
  const aliases = new Map() // nombre del enlace → fichero real (mismo paquete)
  for (const [name, p] of Object.entries(pkgs)) {
    const deb = join(CACHE, 'termux', arch, p.filename.split('/').pop())
    try {
      await download(`${TERMUX}/${p.filename}`, deb, p.sha256)
    } catch (err) {
      throw new Error(`${err.message}\nTermux ya no publica ${name} ${p.version}: ejecuta con --update-lock para fijar la versión actual.`)
    }
    const dest = join(work, name)
    for (const l of extractDeb(deb, dest)) aliases.set(l.name, l.target)
    for (const f of walkFiles(dest)) {
      const buf = readFileSync(f)
      if (!isElf(buf)) continue
      const info = parseElf(buf)
      if (info.machine !== machine) throw new Error(`${f}: arquitectura ${info.machine}, se esperaba ${machine}`)
      const base = f.split(/[\\/]/).pop()
      const isBin = /[\\/]usr[\\/]bin[\\/]/.test(f)
      if (isBin && !TERMUX_BINS[base]) continue
      elfs.push({ pkg: name, file: f, base, isBin, buf, info })
    }
  }
  // Bibliotecas por soname y por los enlaces que apuntan a ellas (las que no tienen soname se enlazan por el
  // nombre del enlace, p. ej. libsqlite3.so → libsqlite3.so.3.54.1). Nombre Android: el del soname o el enlace .so.
  const libs = new Map()
  const map = new Map()
  const resolveLink = (n) => {
    for (let i = 0; i < 8 && aliases.has(n); i++) n = aliases.get(n)
    return n
  }
  for (const e of elfs.filter((x) => !x.isBin)) {
    const names = new Set([e.info.soname?.name ?? e.base, ...[...aliases.keys()].filter((a) => resolveLink(a) === e.base)])
    const plain = [...names].filter((n) => /^lib.*\.so$/.test(n)).sort((a, b) => a.length - b.length)[0]
    e.androidName = e.info.soname ? androidLibName(e.info.soname.name) : (plain ?? androidLibName(e.base))
    for (const n of names) {
      if (libs.has(n)) continue
      libs.set(n, e)
      if (e.info.soname || n !== e.androidName) map.set(n, e.androidName)
    }
  }
  // Solo lo alcanzable desde los ejecutables (DT_NEEDED); el resto de cada paquete sobra.
  const keep = new Set()
  const missing = new Set()
  const visit = (e) => {
    for (const n of e.info.needed) {
      if (SYSTEM_LIBS.has(n.name)) continue
      const dep = libs.get(n.name)
      if (!dep) {
        missing.add(`${n.name} (de ${e.base})`)
        continue
      }
      if (keep.has(dep)) continue
      keep.add(dep)
      visit(dep)
    }
  }
  const bins = elfs.filter((x) => x.isBin)
  for (const b of bins) visit(b)
  for (const b of Object.keys(TERMUX_BINS)) if (!bins.some((x) => x.base === b)) throw new Error(`falta el ejecutable ${b} en Termux`)
  if (missing.size) throw new Error(`dependencias sin resolver: ${[...missing].join(', ')}`)
  const out = join(JNI, abi)
  const written = []
  for (const e of [...bins, ...keep]) {
    const buf = Buffer.from(e.buf)
    patchElf(buf, map)
    if (!setRunpathOrigin(buf)) say(`AVISO: ${e.base} sin RUNPATH: depende de LD_LIBRARY_PATH`)
    const align = minLoadAlign(parseElf(buf))
    if (align < 16384) say(`AVISO: ${e.base} alineado a ${align} B (no cargará en dispositivos con páginas de 16 KB)`)
    const name = e.isBin ? TERMUX_BINS[e.base] : e.androidName
    writeFileSync(join(out, name), buf)
    written.push(name)
  }
  say(`${abi}: Termux ${Object.keys(pkgs).length} paquetes → ${written.length} ficheros (${written.filter((n) => Object.values(TERMUX_BINS).includes(n)).join(', ')})`)
  return written
}

// ------------------------------------------------------------------ llama.cpp (NDK)

function sdkDir() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
  if (!existsSync(sdk)) throw new Error('No se encuentra el Android SDK (ANDROID_HOME)')
  return sdk
}
const newest = (dir) => readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()

export function ndkPaths() {
  const sdk = sdkDir()
  const ndk = join(sdk, 'ndk', newest(join(sdk, 'ndk')))
  const cmakeDir = join(sdk, 'cmake', newest(join(sdk, 'cmake')), 'bin')
  const exe = process.platform === 'win32' ? '.exe' : ''
  return { sdk, ndk, cmake: join(cmakeDir, `cmake${exe}`), ninja: join(cmakeDir, `ninja${exe}`) }
}

async function llama(abi, lock, catalog) {
  const version = catalog.components.llama.version // bNNNNN
  const src = join(CACHE, 'llama', `llama.cpp-${version}`)
  if (!existsSync(join(src, 'CMakeLists.txt'))) {
    const tgz = join(CACHE, 'llama', `${version}.tar.gz`)
    const pinned = lock.llama?.version === version ? lock.llama.sha256 : null
    await download(`https://github.com/ggml-org/llama.cpp/archive/refs/tags/${version}.tar.gz`, tgz, pinned)
    lock.llama = { version, sha256: sha256(tgz), url: `https://github.com/ggml-org/llama.cpp/archive/refs/tags/${version}.tar.gz` }
    const r = spawnSync(tarBin, ['-xzf', tgz, '-C', join(CACHE, 'llama')], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`no se pudo extraer llama.cpp: ${r.stderr}`)
  }
  const { ndk, cmake, ninja } = ndkPaths()
  const build = join(CACHE, 'llama', `build-${abi}`)
  const cfg = spawnSync(cmake, [
    '-S', src, '-B', build, '-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    `-DCMAKE_TOOLCHAIN_FILE=${join(ndk, 'build', 'cmake', 'android.toolchain.cmake')}`,
    `-DANDROID_ABI=${abi}`, '-DANDROID_PLATFORM=android-29', '-DANDROID_STL=c++_shared',
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=ON',
    '-DGGML_NATIVE=OFF', '-DGGML_BACKEND_DL=ON', '-DGGML_CPU_ALL_VARIANTS=ON', '-DGGML_OPENMP=OFF',
    '-DLLAMA_CURL=OFF', '-DLLAMA_OPENSSL=OFF', '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_SERVER=ON', '-DLLAMA_BUILD_TOOLS=ON',
    // Páginas de 16 KB y RUNPATH=$ORIGIN: las bibliotecas se buscan junto al ejecutable (ver elf.mjs,
    // setRunpathOrigin). Las variantes de CPU son add_library(MODULE): también llevan el suyo.
    '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-rpath,$ORIGIN', '-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-rpath,$ORIGIN',
    '-DCMAKE_MODULE_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-rpath,$ORIGIN',
  ], { stdio: 'inherit' })
  if (cfg.status !== 0) throw new Error('cmake (configuración de llama.cpp) falló')
  const b = spawnSync(cmake, ['--build', build, '--target', 'llama-server', '-j', String(cpus().length)], { stdio: 'inherit' })
  if (b.status !== 0) throw new Error('la compilación de llama.cpp falló')
  const bin = join(build, 'bin')
  const out = join(JNI, abi)
  const written = []
  // Ejecutable + bibliotecas (libllama, libggml*, libmtmd…) + variantes de CPU (libggml-cpu-*.so, se cargan solas).
  for (const f of readdirSync(bin)) {
    if (f === 'llama-server') {
      cpSync(join(bin, f), join(out, 'libllama-server.so'))
      written.push('libllama-server.so')
    } else if (/^lib.*\.so$/.test(f)) {
      cpSync(join(bin, f), join(out, f))
      written.push(f)
    }
  }
  if (!written.includes('libllama-server.so')) throw new Error('no se generó llama-server')
  // Sin símbolos de depuración (de ~200 MB a ~20 MB por ABI).
  const strip = join(ndk, 'toolchains', 'llvm', 'prebuilt', readdirSync(join(ndk, 'toolchains', 'llvm', 'prebuilt'))[0], 'bin', `llvm-strip${process.platform === 'win32' ? '.exe' : ''}`)
  const s = spawnSync(strip, ['--strip-unneeded', ...written.map((f) => join(out, f))], { encoding: 'utf8' })
  if (s.status !== 0) throw new Error(`llvm-strip: ${s.stderr}`)
  // libc++_shared.so del NDK (la de Termux es la misma ABI; se usa la del NDK solo si no hay otra).
  const libcxx = join(ndk, 'toolchains', 'llvm', 'prebuilt', readdirSync(join(ndk, 'toolchains', 'llvm', 'prebuilt'))[0], 'sysroot', 'usr', 'lib', ABIS[abi].ndkTriple, 'libc++_shared.so')
  if (!existsSync(join(out, 'libc++_shared.so'))) cpSync(libcxx, join(out, 'libc++_shared.so'))
  say(`${abi}: llama.cpp ${version} → ${written.length} ficheros`)
  return written
}

// ------------------------------------------------------------------ pmtiles y BRouter (catálogo)

async function fromCatalogArchive(comp, key, catalog, pick) {
  const c = catalog.components[comp]
  const asset = c.assets[key] ?? c.assets.any
  const file = join(CACHE, comp, decodeURIComponent(asset.url.split('/').pop()))
  await download(asset.url, file, asset.sha256)
  const x = join(CACHE, comp, `x-${key}`)
  rmSync(x, { recursive: true, force: true })
  mkdirSync(x, { recursive: true })
  const r = spawnSync(tarBin, ['-xf', file, '-C', x], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`no se pudo extraer ${file}: ${r.stderr}`)
  const found = walkFiles(x).find(pick)
  if (!found) throw new Error(`${comp}: fichero no encontrado en ${file}`)
  return { file: found, version: c.version, sha256: asset.sha256 }
}

/**
 * pmtiles (go-pmtiles, misma versión que el catálogo) compilado desde el código para Android (GOOS=android, cgo con el
 * NDK): resuelve nombres con el sistema (el binario oficial de Linux no tiene DNS en Android) y carga como cualquier
 * ejecutable de bionic. Necesita Go (GO o el PATH; en Windows, también %LOCALAPPDATA%\Programs\go*\go\bin).
 * Las dependencias de Go se verifican con go.sum.
 */
const PMTILES_SRC = { sha256: '022386795fae441dd35927e4061daaed8cda7e21ba0a2e2253c8fd0d85bc482f' }

function findGo() {
  const exe = process.platform === 'win32' ? 'go.exe' : 'go'
  if (process.env.GO && existsSync(process.env.GO)) return process.env.GO
  const progs = join(process.env.LOCALAPPDATA ?? '', 'Programs')
  if (existsSync(progs)) {
    const d = readdirSync(progs).filter((x) => /^go[\d.]*$/.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
    if (d && existsSync(join(progs, d, 'go', 'bin', exe))) return join(progs, d, 'go', 'bin', exe)
  }
  const r = spawnSync(exe, ['version'], { encoding: 'utf8' })
  return r.status === 0 ? exe : null
}

async function pmtiles(abi, lock, catalog) {
  const version = catalog.components.pmtiles.version
  const go = findGo()
  if (!go) throw new Error('pmtiles: hace falta Go 1.25 o posterior (https://go.dev/dl/)')
  const base = join(CACHE, 'pmtiles-src')
  const src = join(base, `go-pmtiles-${version}`)
  if (!existsSync(join(src, 'go.mod'))) {
    const pinned = lock.pmtiles?.version === version ? lock.pmtiles.sha256 : null
    const url = `https://github.com/protomaps/go-pmtiles/archive/refs/tags/v${version}.tar.gz`
    const tgz = await download(url, join(base, `v${version}.tar.gz`), pinned ?? (version === '1.31.2' ? PMTILES_SRC.sha256 : null))
    const r = spawnSync(tarBin, ['-xzf', tgz, '-C', base], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`no se pudo extraer go-pmtiles: ${r.stderr}`)
  }
  const tgz = join(base, `v${version}.tar.gz`)
  if (existsSync(tgz)) lock.pmtiles = { version, sha256: sha256(tgz), url: `https://github.com/protomaps/go-pmtiles/archive/refs/tags/v${version}.tar.gz` }
  const { ndk } = ndkPaths()
  const prebuilt = join(ndk, 'toolchains', 'llvm', 'prebuilt', readdirSync(join(ndk, 'toolchains', 'llvm', 'prebuilt'))[0], 'bin')
  const clang = join(prebuilt, `clang${process.platform === 'win32' ? '.exe' : ''}`).replaceAll('\\', '/')
  const goarch = abi === 'arm64-v8a' ? 'arm64' : 'amd64'
  const out = join(JNI, abi, 'libpmtiles.so')
  const b = spawnSync(go, ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version} -extldflags=-Wl,-z,max-page-size=16384`, '-o', out, '.'], {
    cwd: src,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'android', GOARCH: goarch, CGO_ENABLED: '1', CC: `${clang} --target=${ABIS[abi].ndkTriple}29`, GOFLAGS: '-mod=mod' },
  })
  if (b.status !== 0) throw new Error('la compilación de pmtiles falló')
  const info = parseElf(readFileSync(out))
  if (info.machine !== ABIS[abi].machine) throw new Error('pmtiles: arquitectura incorrecta')
  say(`${abi}: pmtiles ${version} (GOOS=android)`)
}

/**
 * pdftotext (Xpdf 4.06, misma versión que el componente del catálogo) compilado con el NDK, solo la herramienta de
 * texto: sin FreeType, Qt ni libpng. Sin él los manuales se leen igual, pero no entran en la búsqueda.
 */
const XPDF = { version: '4.06', url: 'https://dl.xpdfreader.com/xpdf-4.06.tar.gz', sha256: '1c38f527c46caee0f712386d42a885b96a31ed9ce11904e872559859894d137e' }

async function xpdf(abi, lock, catalog) {
  if (catalog.components.xpdf?.version !== XPDF.version) throw new Error(`xpdf: el catálogo pide ${catalog.components.xpdf?.version}; actualiza XPDF en natives.mjs`)
  const base = join(CACHE, 'xpdf')
  const src = join(base, `xpdf-${XPDF.version}`)
  if (!existsSync(join(src, 'CMakeLists.txt'))) {
    const tgz = await download(XPDF.url, join(base, `xpdf-${XPDF.version}.tar.gz`), XPDF.sha256)
    const r = spawnSync(tarBin, ['-xzf', tgz, '-C', base], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`no se pudo extraer xpdf: ${r.stderr}`)
  }
  const { ndk, cmake, ninja } = ndkPaths()
  const build = join(base, `build-${abi}`)
  const cfg = spawnSync(cmake, [
    '-S', src, '-B', build, '-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    `-DCMAKE_TOOLCHAIN_FILE=${join(ndk, 'build', 'cmake', 'android.toolchain.cmake')}`,
    `-DANDROID_ABI=${abi}`, '-DANDROID_PLATFORM=android-29', '-DANDROID_STL=c++_shared', '-DCMAKE_BUILD_TYPE=Release',
    // gfile.cc usa getcwd/getuid sin incluir unistd.h cuando la configuración se hace desde Windows.
    '-DCMAKE_CXX_FLAGS=-include unistd.h', '-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-rpath,$ORIGIN',
    ...['Qt4', 'Qt5', 'Qt6', 'Freetype', 'PNG', 'Cups'].map((p) => `-DCMAKE_DISABLE_FIND_PACKAGE_${p}=ON`),
  ], { stdio: 'inherit' })
  if (cfg.status !== 0) throw new Error('cmake (configuración de xpdf) falló')
  const b = spawnSync(cmake, ['--build', build, '--target', 'pdftotext', '-j', String(cpus().length)], { stdio: 'inherit' })
  if (b.status !== 0) throw new Error('la compilación de pdftotext falló')
  const out = join(JNI, abi, 'libpdftotext.so')
  cpSync(join(build, 'xpdf', 'pdftotext'), out)
  const strip = join(ndk, 'toolchains', 'llvm', 'prebuilt', readdirSync(join(ndk, 'toolchains', 'llvm', 'prebuilt'))[0], 'bin', `llvm-strip${process.platform === 'win32' ? '.exe' : ''}`)
  spawnSync(strip, ['--strip-unneeded', out])
  lock.xpdf = { version: XPDF.version, sha256: XPDF.sha256, url: XPDF.url }
  say(`${abi}: pdftotext ${XPDF.version}`)
}

async function brouter(lock, catalog) {
  const r = await fromCatalogArchive('brouter', 'any', catalog, (f) => /brouter-[\d.]+-all\.jar$/.test(f))
  mkdirSync(APP_LIBS, { recursive: true })
  for (const f of readdirSync(APP_LIBS)) if (/^brouter-.*\.jar$/.test(f)) rmSync(join(APP_LIBS, f))
  cpSync(r.file, join(APP_LIBS, `brouter-${r.version}-all.jar`))
  lock.brouter = { version: r.version }
  say(`BRouter ${r.version} (jar)`)
}

// ------------------------------------------------------------------ principal

async function main() {
  const abis = (arg('abi') ?? Object.keys(ABIS).join(',')).split(',')
  for (const a of abis) if (!ABIS[a]) fail(`ABI desconocida: ${a}`)
  const only = new Set((arg('only') ?? 'termux,llama,pmtiles,xpdf,brouter').split(','))
  const updateLock = process.argv.includes('--update-lock')
  const catalog = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8'))
  const lock = readLock()
  for (const abi of abis) {
    const out = join(JNI, abi)
    mkdirSync(out, { recursive: true })
    if (only.has('termux')) await termux(abi, lock, updateLock)
    if (only.has('llama')) await llama(abi, lock, catalog)
    if (only.has('pmtiles')) await pmtiles(abi, lock, catalog)
    if (only.has('xpdf')) await xpdf(abi, lock, catalog)
  }
  if (only.has('brouter')) await brouter(lock, catalog)
  lock.components = {
    'kiwix-tools': lock.termux.aarch64?.['kiwix-tools']?.version?.split('-')[0] ?? null,
    llama: lock.llama?.version ?? null,
    pmtiles: lock.pmtiles?.version ?? null,
    brouter: lock.brouter?.version ?? null,
    xpdf: lock.xpdf?.version ?? null,
    node: lock.termux.aarch64?.['nodejs-lts']?.version ?? null,
  }
  writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`)
  for (const abi of abis) {
    const dir = join(JNI, abi)
    // Todo ELF que dependa de bibliotecas propias debe buscarlas junto a sí (RUNPATH=$ORIGIN): bajo la traducción
    // ARM de los emuladores x86, LD_LIBRARY_PATH no llega al enlazador.
    const noOrigin = readdirSync(dir).filter((f) => {
      const i = parseElf(readFileSync(join(dir, f)))
      return i.needed.some((n) => !SYSTEM_LIBS.has(n.name)) && i.runpath !== '$ORIGIN'
    })
    if (noOrigin.length) throw new Error(`${abi}: sin RUNPATH=$ORIGIN: ${noOrigin.join(', ')}`)
    const total = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)
    say(`${abi}: ${readdirSync(dir).length} ficheros, ${(total / 1024 ** 2).toFixed(0)} MB`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
}
