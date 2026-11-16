#!/usr/bin/env node
/**
 * Motor de descargas de Survival OS (ADR 0015). Node sin dependencias; lo usan la Pi (tarea
 * `content` vía admin-job.py, como root) y la versión portable (proceso hijo del servidor web).
 *
 *   node content-engine.mjs install <id[:variante]>... [--profile pi|portable] [--root <carpeta portable>]
 *   node content-engine.mjs remove <id>...
 *   node content-engine.mjs status
 *
 * - Catálogo único: content/catalog.json (español por defecto; inglés solo sin equivalente).
 * - Componentes por sistema (kiwix-tools, llama.cpp, go-pmtiles, Temurin JRE, BRouter) con SHA-256
 *   fijado: detecta el sistema y baja el adecuado.
 * - ZIM: última versión del catálogo OPDS de Kiwix, espejos con reanudación, SHA-256 del servidor
 *   maestro, registro en library.xml y retirada de versiones anteriores.
 * - Estado legible por la interfaz en <datos>/content-state.json; progreso en stdout (registro de la tarea).
 * Nunca inventa: un tamaño o versión desconocidos se dejan en null.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countryLand, countryMaxZoom, countryName, countryZones, estimateMapBytes, ROUTING_TILE_BYTES, routingTiles } from './country-maps.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ------------------------------------------------------------------ Plataforma y rutas

export function platformKey(platform = process.platform, arch = process.arch) {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux' }[platform]
  return os && ['x64', 'arm64'].includes(arch) ? `${os}-${arch}` : null
}

/** Rutas según el perfil. En la Pi los componentes del sistema ya existen (install-system.sh). */
export function profilePaths(profile, root) {
  if (profile === 'pi') {
    const v = '/var/lib/survival-os'
    return {
      profile,
      data: v,
      zimDir: `${v}/library/zim`,
      libraryXml: `${v}/library/zim/library.xml`,
      manifest: `${v}/library/manifest.json`,
      docsDir: `${v}/library/docs`,
      llmDir: `${v}/llm`,
      mapsDir: `${v}/maps`,
      routingDir: `${v}/routing`,
      componentsDir: '/opt/survival-os/runtime',
      kiwixManage: '/opt/survival-os/runtime/kiwix-tools/kiwix-manage',
      scripts: '/opt/survival-os/current/scripts',
      state: `${v}/content-state.json`,
      owner: 'survival',
    }
  }
  const data = process.env.SURVIVAL_PORTABLE_DATA || join(root, 'data')
  const key = platformKey()
  return {
    profile: 'portable',
    data,
    zimDir: join(data, 'library', 'zim'),
    libraryXml: join(data, 'library', 'zim', 'library.xml'),
    manifest: join(data, 'library', 'manifest.json'),
    docsDir: join(data, 'library', 'docs'),
    llmDir: join(data, 'llm'),
    mapsDir: join(data, 'maps'),
    routingDir: join(data, 'routing'),
    // Componentes descargados para ESTE sistema: <raíz>/runtime/<so-arq>/<componente>/
    componentsDir: join(root, 'runtime', key ?? 'unknown'),
    kiwixManage: null,
    scripts: null,
    state: join(data, 'content-state.json'),
    owner: null,
  }
}

export function loadCatalog(file = resolve(HERE, '..', 'content', 'catalog.json')) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Países para los mapas «de cualquier país» (ADR 0018), junto al catálogo. */
export function loadCountries(file = resolve(HERE, '..', 'content', 'countries.json')) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).countries
  } catch {
    return []
  }
}

/**
 * «mapa-pais:esp» / «rutas-pais:esp»: elemento concreto a partir de la plantilla del catálogo y del país.
 * Devuelve null si el país no existe. El id con variante es el que se guarda en el estado.
 */
export function expandCountry(template, iso3, countries = loadCountries()) {
  const c = countries.find((x) => x.id === iso3)
  if (!c) return null
  const zones = countryZones(c)
  if (template.kind === 'maps') {
    const maxzoom = countryMaxZoom(countryLand(c))
    return {
      ...template,
      id: `${template.id}:${c.id}`,
      title: `Mapa: ${countryName(c, 'es')}`,
      maps: { region: `pais-${c.id}`, zones: zones.map((z, i) => ({ region: i ? `pais-${c.id}-${i + 1}` : `pais-${c.id}`, bbox: z.bbox })), maxzoom },
      approxBytes: zones.reduce((n, z) => n + estimateMapBytes(z.areaKm2, maxzoom), 0),
    }
  }
  const tiles = routingTiles(c)
  return { ...template, id: `${template.id}:${c.id}`, title: `Rutas: ${countryName(c, 'es')}`, routing: { region: `pais-${c.id}`, tiles }, approxBytes: tiles.length * ROUTING_TILE_BYTES }
}

// ------------------------------------------------------------------ Utilidades

/** Algunos servidores (FAO, archive.org…) rechazan peticiones sin User-Agent. */
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; SurvivalOS/0.8; biblioteca offline)' }
const MiB = 1024 * 1024
const GiB = 1024 * MiB
const fmt = (b) => (b == null ? '?' : b >= GiB ? `${(b / GiB).toFixed(2)} GiB` : `${(b / MiB).toFixed(0)} MiB`)
const say = (m) => process.stdout.write(`==> ${m}\n`)
const warn = (m) => process.stdout.write(`AVISO: ${m}\n`)

function own(paths, p) {
  if (!paths.owner || typeof process.getuid !== 'function' || process.getuid() !== 0) return
  const r = spawnSync('chown', ['-R', `${paths.owner}:${paths.owner}`, p])
  if (r.status !== 0) warn(`chown ${p}: ${r.stderr}`)
}

export async function freeBytes(dir) {
  mkdirSync(dir, { recursive: true })
  const s = await statfs(dir)
  return s.bavail * s.bsize
}

export function sha256File(file) {
  return new Promise((ok, ko) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko)
  })
}

// ------------------------------------------------------------------ Estado (lo lee la interfaz)

export function readState(paths) {
  try {
    return JSON.parse(readFileSync(paths.state, 'utf8'))
  } catch {
    return { schemaVersion: 1, items: {}, components: {}, updatedAt: null }
  }
}

function writeState(paths, mutate) {
  const st = readState(paths)
  mutate(st)
  st.updatedAt = new Date().toISOString()
  mkdirSync(dirname(paths.state), { recursive: true })
  const tmp = `${paths.state}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(st, null, 2))
  renameSync(tmp, paths.state)
  own(paths, paths.state)
}

function setItem(paths, id, patch) {
  writeState(paths, (st) => {
    st.items[id] = { ...(st.items[id] ?? {}), ...patch, at: new Date().toISOString() }
  })
}

// ------------------------------------------------------------------ Descarga con reanudación

let lastProgress = 0
function progress(label, done, total) {
  const now = Date.now()
  if (now - lastProgress < 2000 && done !== total) return
  lastProgress = now
  const pct = total ? ` ${((done / total) * 100).toFixed(1)} %` : ''
  process.stdout.write(`   ${label}: ${fmt(done)} / ${fmt(total)}${pct}\n`)
}

/**
 * Descarga `urls` (espejos en orden) a `dest` vía `dest.part`, reanudando con Range. Abandona un
 * espejo si baja de 200 KB/s durante 30 s. La descarga está completa cuando el fichero mide lo que
 * anuncia el servidor (Content-Length); `total` solo sirve para mostrar progreso (el `length` del
 * catálogo de Kiwix va redondeado a KiB). La integridad la garantiza siempre el SHA-256.
 */
export async function download(urls, dest, { total = null, onBytes = () => undefined, label = '' } = {}) {
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let lastErr = null
  for (const url of urls) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const have = existsSync(part) ? statSync(part).size : 0
      const ctrl = new AbortController()
      let res
      try {
        res = await fetch(url, { headers: { ...UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: ctrl.signal, redirect: 'follow' })
      } catch (err) {
        lastErr = err
        continue
      }
      if (res.status === 416 && have) {
        // El servidor no tiene más bytes que dar: la parte ya está completa.
        renameSync(part, dest)
        return dest
      }
      if (!(res.ok || res.status === 206)) {
        lastErr = new Error(`HTTP ${res.status} en ${url}`)
        break // siguiente espejo
      }
      const resumed = res.status === 206
      const len = Number(res.headers.get('content-length')) || null
      const expected = len == null ? null : resumed ? have + len : len
      const shown = total ?? expected
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      let done = resumed ? have : 0
      let windowBytes = 0
      let windowStart = Date.now()
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
          done += chunk.length
          windowBytes += chunk.length
          onBytes(done, shown)
          progress(label || dest.split(/[\\/]/).pop(), done, shown)
          if (Date.now() - windowStart > 30_000) {
            if (windowBytes < 200_000 * 30) {
              ctrl.abort()
              throw new Error('demasiado lento')
            }
            windowBytes = 0
            windowStart = Date.now()
          }
        }
        await new Promise((r) => out.end(r))
        const got = statSync(part).size
        if (expected != null && got !== expected) throw new Error(`tamaño incompleto (${got}/${expected})`)
        renameSync(part, dest)
        return dest
      } catch (err) {
        lastErr = err
        await new Promise((r) => out.end(r))
        warn(`${url}: ${err instanceof Error ? err.message : err}; reintentando`)
      }
    }
  }
  throw lastErr ?? new Error('descarga fallida')
}

/** Descarga y verifica contra un SHA-256 conocido; borra si no coincide. */
export async function downloadVerified(urls, dest, sha256, opts = {}) {
  if (existsSync(dest) && (await sha256File(dest)) === sha256) return dest
  await download(urls, dest, opts)
  const actual = await sha256File(dest)
  if (actual !== sha256) {
    rmSync(dest, { force: true })
    throw new Error(`SHA-256 incorrecto para ${dest.split(/[\\/]/).pop()} (borrado)`)
  }
  return dest
}

/** GET de texto con reintentos y espera creciente (429/5xx del servidor maestro). */
export async function fetchText(url, tries = 5) {
  let wait = 5000
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
    if (res?.ok) return await res.text()
    if (res && res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status} en ${url}`)
    await new Promise((r) => setTimeout(r, wait))
    wait *= 2
  }
  throw new Error(`Sin respuesta de ${url}`)
}

// ------------------------------------------------------------------ Componentes por sistema

const tarBin = () => (process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

function extract(archive, dir) {
  mkdirSync(dir, { recursive: true })
  const r = spawnSync(tarBin(), ['-xf', archive, '-C', dir], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`No se pudo extraer ${archive}: ${r.stderr}`)
}

/** Ruta de un binario de componente instalado, o null. */
export function componentBin(paths, comp, bin) {
  const exe = process.platform === 'win32' ? `${bin}.exe` : bin
  const p = join(paths.componentsDir, comp, exe)
  return existsSync(p) ? p : null
}

/** Instala un componente para este sistema si falta (SHA-256 fijado en el catálogo). */
export async function ensureComponent(catalog, paths, comp) {
  const c = catalog.components[comp]
  if (!c) throw new Error(`Componente desconocido: ${comp}`)
  const dir = join(paths.componentsDir, comp)
  const marker = join(dir, '.version')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === c.version) return dir
  const key = platformKey()
  const asset = c.assets[key] ?? c.assets.any
  if (!asset) throw new Error(`${comp} no está disponible para ${key}`)
  say(`Componente ${comp} ${c.version} para ${key}`)
  const cache = join(paths.data, '.cache')
  const file = join(cache, decodeURIComponent(asset.url.split('/').pop()))
  // Lo publicado en download.kiwix.org está también en sus espejos oficiales (el maestro limita con 429).
  const urls = asset.url.startsWith(`${catalog.sources.kiwixMaster}/`)
    ? catalog.sources.kiwixMirrors.map((m) => `${m}/${asset.url.slice(catalog.sources.kiwixMaster.length + 1)}`)
    : [asset.url]
  await downloadVerified(urls, file, asset.sha256, { total: asset.bytes || null, label: comp })
  const tmp = join(cache, `x-${comp}-${process.pid}`)
  rmSync(tmp, { recursive: true, force: true })
  extract(file, tmp)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dirname(dir), { recursive: true })
  renameSync(join(tmp, asset.strip ?? ''), dir)
  rmSync(tmp, { recursive: true, force: true })
  rmSync(file, { force: true })
  if (process.platform !== 'win32') {
    for (const b of c.bins) if (existsSync(join(dir, b))) spawnSync('chmod', ['755', join(dir, b)])
    if (process.platform === 'darwin') spawnSync('xattr', ['-dr', 'com.apple.quarantine', dir], { stdio: 'ignore' })
  }
  writeFileSync(marker, `${c.version}\n`)
  writeState(paths, (st) => {
    st.components[comp] = { version: c.version, platform: key, at: new Date().toISOString() }
  })
  return dir
}

// ------------------------------------------------------------------ ZIM (Kiwix)

/** Última versión de name:flavour en el catálogo OPDS. → { url, size, updated, title } | null */
export async function resolveZim(catalog, name, flavour) {
  const res = await fetch(`${catalog.sources.kiwixCatalog}?name=${encodeURIComponent(name)}&count=50`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Catálogo Kiwix: HTTP ${res.status}`)
  const xml = await res.text()
  let best = null
  for (const entry of xml.split('<entry>').slice(1)) {
    const tag = (t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(entry)?.[1] ?? ''
    if (tag('name') !== name || tag('flavour') !== (flavour ?? '')) continue
    const link = /<link[^>]*type="application\/x-zim"[^>]*>/.exec(entry)?.[0] ?? ''
    const href = /href="([^"]+)"/.exec(link)?.[1]?.replace(/\.meta4$/, '')
    const size = Number(/length="(\d+)"/.exec(link)?.[1]) || null
    const row = { url: href, size, updated: tag('updated').slice(0, 10), title: tag('title') }
    if (href && (!best || row.updated > best.updated)) best = row
  }
  return best
}

function kiwixManage(paths) {
  return paths.kiwixManage ?? componentBin(paths, 'kiwix-tools', 'kiwix-manage')
}

function libraryCall(paths, args) {
  const km = kiwixManage(paths)
  if (!km) throw new Error('kiwix-manage no disponible')
  const r = spawnSync(km, [paths.libraryXml, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`kiwix-manage ${args[0]}: ${r.stderr || r.stdout}`)
  return r.stdout
}

function writeManifest(paths, entry) {
  let m = { schemaVersion: 1, entries: [] }
  try {
    m = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  } catch {
    // primera entrada
  }
  m.entries = m.entries.filter((e) => e.id !== entry.id && !(entry.replaces && e.path?.startsWith(entry.replaces)))
  const { replaces: _r, ...clean } = entry
  m.entries.push(clean)
  mkdirSync(dirname(paths.manifest), { recursive: true })
  writeFileSync(`${paths.manifest}.tmp`, JSON.stringify(m, null, 2))
  renameSync(`${paths.manifest}.tmp`, paths.manifest)
  own(paths, paths.manifest)
}

async function installZim(catalog, paths, item, variant) {
  if (paths.profile === 'portable') await ensureComponent(catalog, paths, 'kiwix-tools')
  const flavour = variant ?? item.zim.flavour
  const z = await resolveZim(catalog, item.zim.name, flavour)
  if (!z) throw new Error(`${item.zim.name}:${flavour} no está en el catálogo de Kiwix`)
  const file = z.url.split('/').pop()
  const dest = join(paths.zimDir, file)
  if (existsSync(dest)) {
    say(`${item.title}: ya instalado (${file})`)
    setItem(paths, item.id, { state: 'installed', file, version: z.updated, bytes: statSync(dest).size, variant: flavour })
    return
  }
  const have = existsSync(`${dest}.part`) ? statSync(`${dest}.part`).size : 0
  const free = await freeBytes(paths.zimDir)
  if (z.size && z.size - have + 2 * GiB > free) throw new Error(`sin espacio: necesita ${fmt(z.size)} + 2 GiB de margen, libres ${fmt(free)}`)
  const rel = `zim/${z.url.split('/zim/')[1]}`
  say(`${item.title}: descargando ${file} (${fmt(z.size)})`)
  setItem(paths, item.id, { state: 'downloading', file, total: z.size, done: have, variant: flavour, error: null })
  let lastSave = 0
  await download(
    catalog.sources.kiwixMirrors.map((m) => `${m}/${rel}`),
    dest,
    {
      total: z.size,
      label: item.title,
      onBytes: (done) => {
        if (Date.now() - lastSave > 5000) {
          lastSave = Date.now()
          setItem(paths, item.id, { done })
        }
      },
    },
  )
  setItem(paths, item.id, { state: 'verifying', done: z.size })
  const expected = await fetchText(`${catalog.sources.kiwixMaster}/${rel}.sha256`).then((t) => t.trim().split(/\s+/)[0], () => null)
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) throw new Error(`no se pudo obtener el SHA-256 de ${file}`)
  const actual = await sha256File(dest)
  if (actual !== expected) {
    rmSync(dest, { force: true })
    throw new Error(`SHA-256 incorrecto para ${file} (borrado)`)
  }
  own(paths, dest)
  libraryCall(paths, ['add', dest])
  own(paths, paths.libraryXml)
  // Retirar versiones anteriores y otras variantes del mismo libro.
  const base = file.replace(/(_(maxi|nopic|mini))?_\d{4}-\d{2}\.zim$/, '')
  for (const old of readdirSync(paths.zimDir)) {
    if (old === file || !old.endsWith('.zim') || old.replace(/(_(maxi|nopic|mini))?_\d{4}-\d{2}\.zim$/, '') !== base) continue
    say(`Retirando versión anterior ${old}`)
    removeZimFile(paths, old)
  }
  writeManifest(paths, {
    id: file.replace(/\.zim$/, ''),
    kind: 'zim',
    title: item.title,
    language: item.lang,
    version: z.updated,
    source: z.url,
    retrievedAt: new Date().toISOString().slice(0, 10),
    license: item.license,
    sizeBytes: z.size,
    sha256: actual,
    path: `zim/${file}`,
    replaces: `zim/${base}_`,
  })
  setItem(paths, item.id, { state: 'installed', file, version: z.updated, bytes: z.size, sha256: actual })
  say(`OK ${item.title} (SHA-256 verificado)`)
}

function removeZimFile(paths, file) {
  const full = join(paths.zimDir, file)
  try {
    const out = libraryCall(paths, ['show'])
    let id = null
    for (const line of out.split('\n')) {
      const m = /^id:\s*(\S+)/.exec(line.trim())
      if (m) id = m[1]
      if (line.includes(full) && id) {
        libraryCall(paths, ['remove', id])
        break
      }
    }
  } catch (err) {
    warn(String(err instanceof Error ? err.message : err))
  }
  rmSync(full, { force: true })
}

// ------------------------------------------------------------------ Mapas (go-pmtiles extract)

async function latestProtomapsBuild(catalog) {
  const res = await fetch(catalog.sources.protomapsBuilds, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Builds de Protomaps: HTTP ${res.status}`)
  const builds = (await res.json()).filter((b) => /^\d{8}\.pmtiles$/.test(b.key)).sort((a, b) => a.key.localeCompare(b.key))
  if (!builds.length) throw new Error('No hay builds de Protomaps')
  return builds[builds.length - 1].key
}

async function installMaps(catalog, paths, item) {
  // Un país puede tener varias zonas (España y Canarias): una extracción por zona, un solo elemento.
  const zones = item.maps.zones ?? [{ region: item.maps.region, bbox: item.maps.bbox }]
  if (zones.length === 1) return installMapZone(catalog, paths, item, zones[0], item.approxBytes)
  const files = []
  let bytes = 0
  for (const z of zones) {
    const share = Math.round(item.approxBytes / zones.length)
    const r = await installMapZone(catalog, paths, { ...item, title: `${item.title} (${files.length + 1}/${zones.length})` }, z, share, true)
    files.push(r.file)
    bytes += r.bytes
  }
  setItem(paths, item.id, { state: 'installed', file: files[0], files, bytes })
  say(`OK ${item.title}: ${files.length} zonas`)
}

async function installMapZone(catalog, paths, item, zone, approxBytes, partOfMany = false) {
  const dir = await ensureComponent(catalog, paths, 'pmtiles')
  const bin = join(dir, process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles')
  const build = await latestProtomapsBuild(catalog)
  const { region, bbox } = zone
  const { maxzoom } = item.maps
  const name = `${region}-${build.slice(0, 8)}-z${maxzoom}.pmtiles`
  const dest = join(paths.mapsDir, name)
  mkdirSync(paths.mapsDir, { recursive: true })
  if (existsSync(dest)) {
    say(`${item.title}: ya instalado (${name})`)
    if (!partOfMany) setItem(paths, item.id, { state: 'installed', file: name, version: build.slice(0, 8), bytes: statSync(dest).size })
    return { file: name, bytes: statSync(dest).size }
  }
  const free = await freeBytes(paths.mapsDir)
  if (approxBytes * 1.3 + 2 * GiB > free) throw new Error(`sin espacio para ${item.title}: libres ${fmt(free)}`)
  say(`${item.title}: extrayendo de ${catalog.sources.protomapsBase}/${build} (zoom ≤ ${maxzoom})`)
  setItem(paths, item.id, { state: 'downloading', file: name, total: approxBytes, done: 0, error: null })
  const tmp = `${dest}.part`
  rmSync(tmp, { force: true })
  await new Promise((ok, ko) => {
    const child = spawn(bin, ['extract', `${catalog.sources.protomapsBase}/${build}`, tmp, `--bbox=${bbox.join(',')}`, `--maxzoom=${maxzoom}`, '--download-threads=4'], { stdio: ['ignore', 'pipe', 'pipe'] })
    // pmtiles redibuja su barra con \r: se registra solo cada 10 % y las líneas informativas.
    let lastPct = -10
    const pass = (d) => {
      for (const line of String(d).split(/[\r\n]+/)) {
        const m = /fetching chunks\s+(\d+)%/.exec(line)
        if (m) {
          const pct = Number(m[1])
          if (pct >= lastPct + 10) {
            lastPct = pct - (pct % 10)
            process.stdout.write(`   mapa: ${pct} %\n`)
          }
        } else if (line.trim()) process.stdout.write(`   ${line.trim()}\n`)
      }
    }
    child.stdout.on('data', pass)
    child.stderr.on('data', pass)
    child.on('error', ko)
    child.on('close', (code) => (code === 0 ? ok() : ko(new Error(`pmtiles extract terminó con código ${code}`))))
  })
  renameSync(tmp, dest)
  const sha = await sha256File(dest)
  const sums = join(paths.mapsDir, 'SHA256SUMS')
  const prev = existsSync(sums) ? readFileSync(sums, 'utf8').split('\n').filter((l) => l && !l.endsWith(`  ${name}`)) : []
  // Retirar extracciones anteriores de la misma región.
  for (const old of readdirSync(paths.mapsDir)) {
    if (old !== name && old.startsWith(`${region}-`) && old.endsWith('.pmtiles')) {
      say(`Retirando mapa anterior ${old}`)
      rmSync(join(paths.mapsDir, old), { force: true })
    }
  }
  writeFileSync(sums, [...prev.filter((l) => !new RegExp(`  ${region}-\\d{8}`).test(l)), `${sha}  ${name}`].join('\n') + '\n')
  own(paths, paths.mapsDir)
  if (!partOfMany) setItem(paths, item.id, { state: 'installed', file: name, version: build.slice(0, 8), bytes: statSync(dest).size, sha256: sha })
  say(`OK ${item.title} (${fmt(statSync(dest).size)}, SHA-256 ${sha.slice(0, 12)}…)`)
  return { file: name, bytes: statSync(dest).size }
}

// ------------------------------------------------------------------ Rutas (BRouter)

/** Índice de cuadrículas de BRouter (las de mar no existen). null si no se puede leer: se intentan todas. */
async function brouterIndex(catalog) {
  try {
    const html = await fetchText(`${catalog.sources.brouterSegments}/`)
    return new Set([...html.matchAll(/href="([EW]\d{1,3}_[NS]\d{1,2})\.rd5"/g)].map((m) => m[1]))
  } catch {
    return null
  }
}

async function installRouting(catalog, paths, item) {
  const index = await brouterIndex(catalog)
  const available = index ? item.routing.tiles.filter((t) => index.has(t)) : item.routing.tiles
  if (!available.length) throw new Error('no hay datos de rutas para esta zona')
  if (index && available.length < item.routing.tiles.length) say(`${item.title}: ${item.routing.tiles.length - available.length} cuadrícula(s) sin datos (mar) omitidas`)
  item = { ...item, routing: { ...item.routing, tiles: available } }
  if (paths.profile === 'pi') {
    const regionArgs = ['espana', 'canarias'].includes(item.routing.region) ? ['install', item.routing.region] : ['install-tiles', ...available]
    return runScript(paths, 'routing-install.sh', regionArgs, item)
  }
  await ensureComponent(catalog, paths, 'jre')
  await ensureComponent(catalog, paths, 'brouter')
  const seg = join(paths.routingDir, 'segments4')
  mkdirSync(seg, { recursive: true })
  mkdirSync(join(paths.routingDir, 'customprofiles'), { recursive: true })
  setItem(paths, item.id, { state: 'downloading', total: item.approxBytes, done: 0, error: null })
  let done = 0
  const tiles = []
  for (const t of item.routing.tiles) {
    const dest = join(seg, `${t}.rd5`)
    const url = `${catalog.sources.brouterSegments}/${t}.rd5`
    const head = await fetch(url, { method: 'HEAD' })
    const size = Number(head.headers.get('content-length')) || null
    if (!(existsSync(dest) && size && statSync(dest).size === size)) {
      say(`${item.title}: cuadrícula ${t} (${fmt(size)})`)
      rmSync(dest, { force: true })
      await download([url], dest, { total: size, label: t })
    }
    done += statSync(dest).size
    tiles.push({ name: t, bytes: statSync(dest).size, sha256: await sha256File(dest) })
    setItem(paths, item.id, { done })
  }
  setItem(paths, item.id, { state: 'installed', bytes: done, tiles })
  say(`OK ${item.title}`)
}

// ------------------------------------------------------------------ Asistente (llama.cpp + modelo)

async function installLlm(catalog, paths, item, modelId = item.llm.model) {
  if (paths.profile === 'pi') return runScript(paths, 'llm-install.sh', [modelId], item)
  const model = catalog.models[modelId]
  if (!model) throw new Error(`Modelo desconocido: ${modelId}`)
  await ensureComponent(catalog, paths, 'llama')
  const dest = join(paths.llmDir, 'models', model.file)
  const free = await freeBytes(paths.llmDir)
  if (!existsSync(dest) && model.bytes + 2 * GiB > free) throw new Error(`sin espacio para el modelo: libres ${fmt(free)}`)
  setItem(paths, item.id, { state: 'downloading', file: model.file, total: model.bytes, done: 0, error: null })
  let lastSave = 0
  await downloadVerified([`${catalog.sources.huggingface}/${model.repo}/resolve/main/${model.file}`], dest, model.sha256, {
    total: model.bytes,
    label: model.file,
    onBytes: (d) => {
      if (Date.now() - lastSave > 5000) {
        lastSave = Date.now()
        setItem(paths, item.id, { done: d })
      }
    },
  })
  writeFileSync(join(paths.llmDir, 'active'), `${model.file}\n`)
  setItem(paths, item.id, { state: 'installed', file: model.file, bytes: model.bytes, sha256: model.sha256 })
  say(`OK ${item.title} (SHA-256 verificado)`)
}

/** En la Pi, rutas y asistente siguen en sus scripts (systemd, Java del sistema, compilación nativa). */
function runScript(paths, script, args, item) {
  setItem(paths, item.id, { state: 'downloading', error: null })
  return new Promise((ok, ko) => {
    const child = spawn('bash', [join(paths.scripts, script), ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', ko)
    child.on('close', (code) => {
      if (code === 0) {
        setItem(paths, item.id, { state: 'installed' })
        ok()
      } else ko(new Error(`${script} terminó con código ${code}`))
    })
  })
}

// ------------------------------------------------------------------ Manuales PDF

/** Carpeta de los manuales del catálogo dentro de los documentos de la biblioteca. */
const MANUALS = 'manuales'

/** Pide a la biblioteca que vuelva a indexar los documentos (búsqueda de texto completo). */
async function reindexLibrary() {
  const base = process.env.NUXT_LIBRARY_URL || process.env.LIBRARY_URL_INTERNAL || 'http://127.0.0.1:8782'
  await fetch(`${base.replace(/\/$/, '')}/reindex`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
}

async function installDoc(catalog, paths, item) {
  const d = item.doc
  // Portable: pdftotext para que el manual salga en las búsquedas (opcional: sin él se puede leer igual).
  if (paths.profile === 'portable' && catalog.components.xpdf) {
    await ensureComponent(catalog, paths, 'xpdf').catch((err) => warn(`pdftotext no disponible: ${err instanceof Error ? err.message : err}`))
  }
  const base = join(paths.docsDir, MANUALS)
  mkdirSync(base, { recursive: true })
  const free = await freeBytes(base)
  if ((d.bytes ?? 0) + 512 * MiB > free) throw new Error(`sin espacio para ${item.title}: libres ${fmt(free)}`)
  // Libros publicados por capítulos (p. ej. Hesperian): una carpeta con los capítulos numerados.
  const files = d.parts ? d.parts.map((p) => ({ ...p, dest: join(base, item.id, p.file) })) : [{ ...d, dest: join(base, d.file) }]
  const total = files.reduce((a, f) => a + (f.bytes ?? 0), 0)
  let done = 0
  setItem(paths, item.id, { state: 'downloading', file: d.parts ? item.id : d.file, total, done: 0, error: null })
  say(`${item.title}: ${files.length > 1 ? `${files.length} capítulos` : d.file} (${fmt(total)})`)
  for (const f of files) {
    mkdirSync(dirname(f.dest), { recursive: true })
    await downloadVerified([f.url], f.dest, f.sha256, { total: f.bytes ?? null, label: files.length > 1 ? `${item.title} · ${f.file}` : item.title })
    done += f.bytes ?? 0
    setItem(paths, item.id, { done })
  }
  // Títulos legibles para la búsqueda de la biblioteca (el indexador los usa en vez del nombre de fichero).
  const titlesFile = join(base, 'titles.json')
  let titles = {}
  try {
    titles = JSON.parse(readFileSync(titlesFile, 'utf8'))
  } catch {
    // primera vez
  }
  for (const f of files) {
    const rel = d.parts ? `${MANUALS}/${item.id}/${f.file}` : `${MANUALS}/${d.file}`
    titles[rel] = d.parts && f.title ? `${item.title} · ${f.title}` : item.title
  }
  writeFileSync(titlesFile, JSON.stringify(titles, null, 1))
  own(paths, base)
  writeManifest(paths, {
    id: `doc-${item.id}`,
    kind: 'doc',
    title: item.title,
    language: item.lang,
    version: d.edition ?? null,
    source: d.url,
    retrievedAt: new Date().toISOString().slice(0, 10),
    license: item.license,
    sizeBytes: total,
    sha256: d.sha256 ?? null,
    path: d.parts ? `docs/${MANUALS}/${item.id}/` : `docs/${MANUALS}/${d.file}`,
  })
  setItem(paths, item.id, { state: 'installed', file: d.parts ? item.id : d.file, bytes: total, sha256: d.sha256 ?? null })
  say(`OK ${item.title} (SHA-256 verificado)`)
}

// ------------------------------------------------------------------ Orquestación

export function findItem(catalog, id) {
  return catalog.items.find((i) => i.id === id) ?? null
}

/** Instala una lista de "id" o "id:variante" en orden; sigue con el resto si uno falla. */
export async function install(catalog, paths, specs) {
  let failed = 0
  for (const spec of specs) {
    const [id, variant] = spec.split(':')
    let item = findItem(catalog, id)
    if (item?.template === 'country') item = variant ? expandCountry(item, variant) : null
    if (!item) {
      warn(`${id}: no está en el catálogo; se omite`)
      failed++
      continue
    }
    try {
      if (item.kind === 'zim') await installZim(catalog, paths, item, variant)
      else if (item.kind === 'maps') await installMaps(catalog, paths, item)
      else if (item.kind === 'routing') await installRouting(catalog, paths, item)
      else if (item.kind === 'llm') await installLlm(catalog, paths, item)
      else if (item.kind === 'doc') await installDoc(catalog, paths, item)
      else throw new Error(`tipo desconocido ${item.kind}`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      warn(`${item.title}: ${msg}`)
      setItem(paths, item.id, { state: 'failed', error: msg.slice(0, 300) })
    }
  }
  // Manuales nuevos o quitados: la biblioteca vuelve a indexar para que aparezcan en la búsqueda.
  if (specs.some((s) => findItem(catalog, s.split(':')[0])?.kind === 'doc')) await reindexLibrary()
  return failed
}

export async function remove(catalog, paths, ids) {
  for (const id of ids) {
    const [baseId, variant] = id.split(':')
    let item = findItem(catalog, baseId)
    if (item?.template === 'country') item = variant ? expandCountry(item, variant) : null
    const st = readState(paths).items[id]
    if (!item || !st) continue
    if (item.kind === 'zim' && st.file) removeZimFile(paths, st.file)
    if (item.kind === 'maps') for (const f of st.files ?? (st.file ? [st.file] : [])) rmSync(join(paths.mapsDir, f), { force: true })
    if (item.kind === 'doc' && st.file) rmSync(join(paths.docsDir, MANUALS, item.doc.parts ? item.id : item.doc.file), { recursive: true, force: true })
    if (item.kind === 'llm' && st.file) {
      if (paths.profile === 'pi') spawnSync('bash', [join(paths.scripts, 'llm-install.sh'), '--remove', item.llm.model], { stdio: 'inherit' })
      else {
        rmSync(join(paths.llmDir, 'models', st.file), { force: true })
        if (existsSync(join(paths.llmDir, 'active')) && readFileSync(join(paths.llmDir, 'active'), 'utf8').trim() === st.file) rmSync(join(paths.llmDir, 'active'))
      }
    }
    if (item.kind === 'routing') {
      if (paths.profile === 'pi') spawnSync('bash', [join(paths.scripts, 'routing-install.sh'), 'remove'], { stdio: 'inherit' })
      else for (const t of st.tiles?.map((x) => x.name) ?? item.routing.tiles) rmSync(join(paths.routingDir, 'segments4', `${t}.rd5`), { force: true })
    }
    writeState(paths, (s) => {
      delete s.items[id]
    })
    say(`Quitado ${item.title}`)
  }
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
  const catalogFile = opt('--catalog')
  const [cmd, ...rest] = args
  const catalog = loadCatalog(catalogFile ?? undefined)
  const paths = profilePaths(profile, root)
  if (cmd === 'status') {
    process.stdout.write(`${JSON.stringify({ platform: platformKey(), paths, state: readState(paths) }, null, 2)}\n`)
    return
  }
  if (cmd === 'install') {
    say(`Sistema detectado: ${platformKey()} · perfil ${profile}`)
    const failed = await install(catalog, paths, rest)
    say(failed ? `Terminado con ${failed} error(es).` : 'Terminado.')
    process.exitCode = failed ? 1 : 0
    return
  }
  if (cmd === 'remove') {
    await remove(catalog, paths, rest)
    return
  }
  // Órdenes de las tarjetas de Mantenimiento (mismos parámetros que las tareas de la Pi).
  if (cmd === 'model') {
    const [action, id] = rest
    const item = catalog.items.find((i) => i.kind === 'llm')
    const model = id ? catalog.models[id] : null
    if (action === 'install' && model) {
      say(`Sistema detectado: ${platformKey()} · perfil ${profile}`)
      await installLlm(catalog, paths, item, id)
    } else if (action === 'remove' && model) {
      rmSync(join(paths.llmDir, 'models', model.file), { force: true })
      const act = join(paths.llmDir, 'active')
      if (existsSync(act) && readFileSync(act, 'utf8').trim() === model.file) rmSync(act)
      say(`Borrado ${model.file}`)
    } else if (action === 'disable') {
      rmSync(join(paths.llmDir, 'active'), { force: true })
      say('Asistente desactivado')
    } else throw new Error('Orden de modelo no válida')
    return
  }
  if (cmd === 'zim-delete' && /^[a-z0-9_.-]+_\d{4}-\d{2}\.zim$/i.test(rest[0] ?? '')) {
    removeZimFile(paths, rest[0])
    say(`Borrado ${rest[0]}`)
    return
  }
  if (cmd === 'maps-delete' && /^[A-Za-z0-9_-]{1,80}\.pmtiles$/.test(rest[0] ?? '')) {
    rmSync(join(paths.mapsDir, rest[0]), { force: true })
    say(`Borrado ${rest[0]}`)
    return
  }
  process.stderr.write('Uso: content-engine.mjs install|remove|status ...\n')
  process.exitCode = 2
}

// ¿Ejecutado como programa? Se comparan rutas REALES: en la Pi /opt/survival-os/current es un enlace.
const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.stack : err}\n`)
    process.exitCode = 1
  })
}

