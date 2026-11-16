#!/usr/bin/env node
/**
 * Publica una versión en GitHub Releases para que las instalaciones se actualicen solas (ADR 0021).
 *
 *   npm run release:publish                       comprueba, compila, empaqueta, firma y DESCRIBE (no publica)
 *   npm run release:publish -- --yes              además: etiqueta vX.Y.Z, la sube, crea la release y la verifica
 *   incluye siempre los APK de Android (arm64 y x86_64); --no-android solo para revisar sin el toolchain de Android
 *   opciones: --min-from X.Y.Z (versión mínima para actualizar directamente)
 *             --skip-build (solo sin --yes: revisar lo ya empaquetado en release/)
 *             --keygen (crea la clave de firma si no existe y muestra la pública para TRUSTED_KEYS)
 *
 * Se niega a seguir si algo no cuadra: árbol con cambios, rama distinta de main o sin subir, versiones del monorepo
 * desalineadas, etiqueta existente, versión no mayor que la publicada, sin sección en CHANGELOG.md, tests en rojo,
 * un fichero que no lleva dentro la versión correcta o una firma que las instalaciones no aceptarían.
 * Clave privada: ~/.survival-os/update-signing-key.pem (o SURVIVAL_UPDATE_SIGNING_KEY). Nunca en el repositorio.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { checkVersions } from './set-version.mjs'
import {
  compareVersions, generateSigningKey, LATEST_BASE, MANIFEST_NAME, parseVersion, PORTABLE_TARGETS, publicXOf, SIG_NAME, signManifest, tagBase,
  TRUSTED_KEYS, validateManifest, verifyManifest,
} from './update-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'release')
const WIN = process.platform === 'win32'
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const say = (m) => console.log(`==> ${m}`)
const okMsg = (m) => console.log(`  ✓ ${m}`)
function fail(m) {
  console.error(`\nERROR: ${m}`)
  process.exit(1)
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: WIN && /^(npm|npx)$/.test(cmd), ...opts })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} → código ${r.status}`)
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT })
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const keyFile = () => process.env.SURVIVAL_UPDATE_SIGNING_KEY || join(homedir(), '.survival-os', 'update-signing-key.pem')

// ------------------------------------------------------------------ clave

if (flag('keygen')) {
  const f = keyFile()
  if (existsSync(f)) {
    okMsg(`Ya existe ${f} (pública: ${publicXOf(readFileSync(f, 'utf8'))})`)
  } else {
    mkdirSync(dirname(f), { recursive: true })
    const k = generateSigningKey()
    writeFileSync(f, k.privatePem, { mode: 0o600, flag: 'wx' })
    okMsg(`Clave creada en ${f}. HAZ UNA COPIA DE SEGURIDAD fuera de este equipo: sin ella no se pueden publicar actualizaciones.`)
    console.log(`  Añade a TRUSTED_KEYS (scripts/update-lib.mjs): '<id>': '${k.publicX}'`)
  }
  process.exit(0)
}

// ------------------------------------------------------------------ 1. comprobaciones previas

const yes = flag('yes')
const skipBuild = flag('skip-build')
// Toda versión publicada lleva el APK: Android se actualiza desde las mismas releases (ADR 0020, ADR 0021).
const withAndroid = !flag('no-android')
if (yes && !withAndroid) fail('--no-android solo sirve para revisar (sin --yes): toda versión publicada incluye el APK de Android')
if (yes && skipBuild) fail('--skip-build solo sirve para revisar (sin --yes): lo publicado se compila siempre desde la etiqueta')
const { version, mismatches } = checkVersions(ROOT)
const tag = `v${version}`
say(`Survivelia OS ${version}`)
if (!parseVersion(version)) fail(`versión no válida en package.json: ${version}`)
if (mismatches.length) fail(`versiones desalineadas:\n${mismatches.map((m) => `  ${m.file}: ${m.version}`).join('\n')}\nArreglo: npm run set-version -- ${version}`)
okMsg('versiones del monorepo alineadas')

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out
if (branch !== 'main') fail(`hay que publicar desde main (ahora: ${branch})`)
const dirty = capture('git', ['status', '--porcelain']).out
if (dirty) fail(`hay cambios sin commit:\n${dirty.split('\n').slice(0, 15).join('\n')}`)
if (capture('git', ['fetch', '--quiet', 'origin', 'main', '--tags']).code !== 0) fail('no se pudo consultar origin (¿sin red?)')
const head = capture('git', ['rev-parse', 'HEAD']).out
if (head !== capture('git', ['rev-parse', 'origin/main']).out) fail('main local no coincide con origin/main: haz push (o pull) antes de publicar')
okMsg(`main limpio y subido (${head.slice(0, 10)})`)

if (capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).code === 0) fail(`la etiqueta ${tag} ya existe: sube la versión (npm run set-version -- X.Y.Z)`)
if (capture('git', ['ls-remote', '--tags', 'origin', tag]).out) fail(`la etiqueta ${tag} ya existe en GitHub`)
if (capture('gh', ['auth', 'status']).code !== 0) fail('gh no tiene sesión: gh auth login')
const latestTag = capture('gh', ['release', 'view', '--json', 'tagName', '-q', '.tagName'])
if (latestTag.code === 0 && latestTag.out) {
  const prev = latestTag.out.replace(/^v/, '')
  if (parseVersion(prev) && compareVersions(version, prev) <= 0) fail(`${version} no es mayor que la última publicada (${prev})`)
  okMsg(`mayor que la última publicada (${prev})`)
}

const minFrom = opt('min-from') ?? '0.0.0'
if (!parseVersion(minFrom) || compareVersions(minFrom, version) > 0) fail(`--min-from no válido: ${minFrom}`)

// Notas: la sección del CHANGELOG (español) y, si existen, docs/release-notes/<versión>.<idioma>.md.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const sec = new RegExp(`^## ${version.replaceAll('.', '\\.')}(?: [^\\n]*)?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog)
if (!sec) fail(`falta la sección «## ${version} — fecha · título» en CHANGELOG.md`)
const heading = changelog.slice(sec.index).split('\n')[0]
const title = heading.includes('·') ? heading.slice(heading.indexOf('·') + 1).trim() : ''
const notes = { es: sec[1].trim() }
for (const l of ['en', 'fr', 'it']) {
  const f = join(ROOT, 'docs', 'release-notes', `${version}.${l}.md`)
  if (existsSync(f)) notes[l] = readFileSync(f, 'utf8').trim()
}
if (!notes.es) fail(`la sección ${version} de CHANGELOG.md está vacía`)
okMsg(`notas: ${Object.keys(notes).join(', ')}`)

// Firma: la clave tiene que estar entre las que aceptan las instalaciones.
if (!existsSync(keyFile())) fail(`falta la clave de firma (${keyFile()}). Si es la primera vez: npm run release:publish -- --keygen`)
const pem = readFileSync(keyFile(), 'utf8')
const keyId = Object.entries(TRUSTED_KEYS).find(([, x]) => x === publicXOf(pem))?.[0]
if (!keyId) fail('la clave de firma no está en TRUSTED_KEYS (scripts/update-lib.mjs): las instalaciones rechazarían esta versión')
okMsg(`clave de firma ${keyId}`)

const csc = WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : null
if (!csc || !existsSync(csc)) fail('hay que publicar desde Windows: «Survivelia OS.exe» de la portable se compila con el csc.exe de .NET Framework')

// ------------------------------------------------------------------ 2. tests, compilación y paquetes

const names = {
  system: `survival-os-${version}.tar.gz`,
  portableAll: `survival-os-${version}-portable.zip`,
  portable: (t) => `survival-os-${version}-portable-${t}.zip`,
  apk: (abi) => `survival-os-${version}-android-${abi}.apk`,
}
if (!skipBuild) {
  say('Tests (npm run check)')
  run('npm', ['run', 'check'])
  say('Compilación')
  run('npm', ['run', 'build'])
  run('npm', ['run', 'release'])
  run('npm', ['run', 'release:portable'])
  for (const t of PORTABLE_TARGETS) run('npm', ['run', 'release:portable', '--', `--targets=${t}`])
  if (withAndroid) run('npm', ['run', 'release:android'])
}

// ------------------------------------------------------------------ 3. verificar cada fichero por dentro

/** Contenido de una entrada de un zip (sin Zip64), o null. */
function zipEntry(file, wanted) {
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  try {
    const tailLen = Math.min(size, 65_557)
    const tail = Buffer.alloc(tailLen)
    readSync(fd, tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) return null
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOff = tail.readUInt32LE(eocd + 16)
    const cd = Buffer.alloc(cdSize)
    readSync(fd, cd, 0, cdSize, cdOff)
    let p = 0
    const list = []
    let found = null
    for (let n = 0; n < count; n++) {
      const method = cd.readUInt16LE(p + 10)
      const csize = cd.readUInt32LE(p + 20)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const local = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      list.push(name)
      if (name === wanted) found = { method, csize, local }
      p += 46 + nameLen + extraLen + commentLen
    }
    if (wanted === null) return list
    if (!found) return null
    const lh = Buffer.alloc(30)
    readSync(fd, lh, 0, 30, found.local)
    const start = found.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
    const raw = Buffer.alloc(found.csize)
    readSync(fd, raw, 0, found.csize, start)
    return found.method === 0 ? raw : inflateRawSync(raw)
  } finally {
    closeSync(fd)
  }
}

const assets = []
function addAsset(name, kind, platforms, check) {
  const file = join(OUT, name)
  if (!existsSync(file)) fail(`falta release/${name}`)
  const sum = sha256(file)
  const side = existsSync(`${file}.sha256`) ? readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0] : null
  if (side !== sum) fail(`release/${name}.sha256 no coincide con el fichero`)
  const problem = check?.(file)
  if (problem) fail(`release/${name}: ${problem}`)
  assets.push({ name, kind, platforms, size: statSync(file).size, sha256: sum, file })
  okMsg(`${name} (${(statSync(file).size / 1024 ** 2).toFixed(0)} MB)`)
}

say('Verificando los paquetes por dentro')
const tarBin = WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
addAsset(names.system, 'system', ['linux-arm64', 'linux-x64'], () => {
  const r = spawnSync(tarBin, ['-xzOf', names.system, `survival-os-${version}/VERSION`], { cwd: OUT, encoding: 'utf8' })
  if (r.status !== 0) return 'no se puede leer VERSION del tarball'
  if (r.stdout.trim() !== version) return `VERSION interna ${r.stdout.trim()} ≠ ${version}`
  const list = spawnSync(tarBin, ['-tzf', names.system], { cwd: OUT, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 })
  for (const f of ['scripts/install-system.sh', 'scripts/update-engine.mjs', 'scripts/update-lib.mjs', 'systemd/survival-update.timer']) {
    if (!list.stdout.includes(`survival-os-${version}/${f}`)) return `no contiene ${f}`
  }
  return null
})
const portableCheck = (targets) => (file) => {
  const v = zipEntry(file, 'Survivelia OS/app/VERSION')?.toString('utf8').trim()
  if (v !== version) return `app/VERSION interna ${v ?? '(no está)'} ≠ ${version}`
  const entries = zipEntry(file, null)
  for (const t of targets) {
    const bin = `Survivelia OS/runtime/${t}/${t.startsWith('win') ? 'node.exe' : 'node'}`
    if (!entries.includes(bin)) return `no incluye ${bin}`
  }
  for (const f of ['app/scripts/update-engine.mjs', 'app/scripts/update-lib.mjs', 'app/portable/apply-update.mjs']) {
    if (!entries.includes(`Survivelia OS/${f}`)) return `no contiene ${f}`
  }
  if (targets.includes('win-x64') && !entries.includes('Survivelia OS/Survivelia OS.exe')) return 'no contiene «Survivelia OS.exe»'
  return null
}
addAsset(names.portableAll, 'portable', PORTABLE_TARGETS, portableCheck(PORTABLE_TARGETS))
for (const t of PORTABLE_TARGETS) addAsset(names.portable(t), 'portable', [t], portableCheck([t]))
if (withAndroid) {
  addAsset(names.apk('arm64'), 'android', ['android-arm64'])
  addAsset(names.apk('x86_64'), 'android', ['android-x64'])
}

// ------------------------------------------------------------------ 4. manifiesto firmado

const manifest = {
  schema: 1,
  name: 'Survivelia OS',
  version,
  tag,
  date: new Date().toISOString().slice(0, 10),
  commit: head,
  minFrom,
  notes,
  assets: assets.map(({ name, kind, platforms, size, sha256: s }) => ({ name, kind, platforms, size, sha256: s })),
}
validateManifest(manifest)
const manifestFile = join(OUT, MANIFEST_NAME)
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(manifestFile, bytes)
writeFileSync(join(OUT, SIG_NAME), signManifest(bytes, pem, keyId))
const v = verifyManifest(readFileSync(manifestFile), readFileSync(join(OUT, SIG_NAME), 'utf8'))
if (!v.ok) fail(`la firma recién hecha no verifica: ${v.error}`)
okMsg(`${MANIFEST_NAME} firmado (${keyId}) y verificado con las claves de las instalaciones`)

const uploads = [...assets.flatMap((a) => [a.file, `${a.file}.sha256`]), manifestFile, join(OUT, SIG_NAME)]
const total = assets.reduce((n, a) => n + a.size, 0)
say(`Plan: etiqueta ${tag} en ${head.slice(0, 10)} · ${uploads.length} ficheros · ${(total / 1024 ** 2).toFixed(0)} MB · minFrom ${minFrom}`)
if (!yes) {
  console.log('\nTodo listo y verificado. Para publicar: npm run release:publish -- --yes' + (opt('min-from') ? ` --min-from ${minFrom}` : ''))
  process.exit(0)
}

// ------------------------------------------------------------------ 5. publicar y verificar lo publicado

say(`Publicando ${tag}`)
run('git', ['tag', '-a', tag, '-m', `Survivelia OS ${version}`])
run('git', ['push', 'origin', tag])
const notesFile = join(tmpdir(), `survival-os-notes-${version}.md`)
writeFileSync(notesFile, `${notes.es}\n`)
run('gh', ['release', 'create', tag, '--verify-tag', '--title', `Survivelia OS ${version}${title ? ` · ${title}` : ''}`, '--notes-file', notesFile, ...uploads])

say('Verificando lo publicado (lo mismo que descargarán las instalaciones)')
let published = null
for (let i = 0; i < 20 && !published?.equals(bytes); i++) {
  if (i) await new Promise((r) => setTimeout(r, 6000))
  published = await fetch(`${LATEST_BASE}/${MANIFEST_NAME}`, { redirect: 'follow' }).then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null), () => null)
}
if (!published?.equals(bytes)) fail(`releases/latest/download/${MANIFEST_NAME} no coincide con el firmado (¿otra release marcada como «latest»?)`)
const pubSig = await fetch(`${LATEST_BASE}/${SIG_NAME}`, { redirect: 'follow' }).then((r) => r.text())
if (!verifyManifest(published, pubSig).ok) fail('la firma publicada no verifica')
okMsg('manifiesto y firma publicados correctos')
for (const a of assets) {
  const r = await fetch(`${tagBase(tag)}/${a.name}`, { method: 'HEAD', redirect: 'follow' }).catch(() => null)
  const len = Number(r?.headers.get('content-length'))
  if (!r?.ok || len !== a.size) fail(`${a.name}: publicado ${r ? `HTTP ${r.status}, ${len} bytes` : 'sin respuesta'} ≠ ${a.size}`)
}
okMsg(`${assets.length} ficheros publicados con el tamaño correcto`)
say(`Publicada ${tag}. Las instalaciones la verán en su próxima comprobación (o con «Buscar ahora»).`)
