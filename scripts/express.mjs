#!/usr/bin/env node
/**
 * Survivelia OS · instalación y configuración EXPRÉS (personas y agentes LLM; ver AGENTS.md).
 * Node sin dependencias. Windows, macOS y Linux. Usa el ssh/scp del sistema (OpenSSH) y, para Android, adb.
 *
 * Origen de la app (portable, pi, android):
 *   --release   descargar la última versión PUBLICADA en GitHub (firma Ed25519 + SHA-256 verificados; sin compilar,
 *               solo hace falta Node). Lo recomendado para instalar a una persona.
 *   (sin nada)  compilar desde este código (npm install + build: minutos; para desarrollo o sin Internet).
 *
 *   npm run express -- doctor                                  requisitos de este ordenador y última versión publicada
 *   npm run express -- portable [--release] [--all-systems] [--dest DIR] [--no-open] [--install]
 *                                                              versión portable para ESTE sistema, lista para usar
 *   npm run express -- stop [--dest DIR]                       cerrar la portable (p. ej. antes de actualizar su carpeta)
 *   npm run express -- ssh-setup --host IP --user USUARIO      preparar el acceso SSH sin contraseña a la Pi
 *   npm run express -- pi (--host IP --user USUARIO [--key F] [--port 22] | --local) [--release] [--no-kiosk] [--reboot] [--yes]
 *                                                              instalar o actualizar en una Raspberry Pi o Linux con systemd
 *                                                              (--local: en ESTE Linux, p. ej. el agente corre en la propia Pi)
 *   npm run express -- android [--release | --apk FICHERO] [--abi arm64|x86_64] [--serial S] [--yes]
 *                                                              APK para Android: descargar/compilar y, con adb, instalar
 *   npm run express -- defaults --lang es|en|fr|it --country esp (DESTINO)
 *                                                              idioma y país por defecto del equipo
 *   npm run express -- status [--watch] (DESTINO)              estado, contenidos y descargas en curso (--watch: seguir)
 *   npm run express -- download [--recommended] [--lang L] [--country C] [--yes] (DESTINO)
 *                                                              plan de «Descargarlo todo» y, con --yes, lanzarlo
 *   npm run express -- update [--check] [--mode auto|notify|off] [--yes] (DESTINO)
 *                                                              actualizaciones desde GitHub (ADR 0021); --yes instala
 *
 * DESTINO: --host IP --user U (Pi por SSH) · --local (este Linux) · --url http://127.0.0.1:PUERTO · --dest CARPETA
 * (portable: lee el puerto de CARPETA/data/run.json). Sin DESTINO: la portable de ~/Survivelia OS si está abierta.
 *
 * Códigos de salida: 0 bien · 1 error · 2 uso incorrecto · 3 falta acceso SSH · 4 falta sudo sin contraseña
 * · 5 no hay ningún Android conectado por adb.
 * Nunca guarda contraseñas. La clave SSH se crea en ~/.ssh/survival_os_ed25519 (solo con ssh-setup).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform as osPlatform, arch as osArch, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { LATEST_BASE, MANIFEST_NAME, PORTABLE_TARGETS, SIG_NAME, parseManifest, pickAsset, tagBase, verifyManifest } from './update-lib.mjs'
import { extractZip } from './zip.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIN = osPlatform() === 'win32'
const DEFAULT_KEY = join(homedir(), '.ssh', 'survival_os_ed25519')
const DEFAULT_PORTABLE = join(homedir(), 'Survivelia OS')
const CACHE = join(tmpdir(), 'survival-os-express')

// ------------------------------------------------------------------ utilidades

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d = undefined) => {
  const i = argv.indexOf(`--${n}`)
  return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const say = (m) => console.log(`==> ${m}`)
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => console.log(`  ✗ ${m}`)
function fail(m, code = 1) {
  console.error(`ERROR: ${m}`)
  process.exit(code)
}

/** Ejecuta un comando mostrando su salida; devuelve el código. */
function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, shell: WIN && /^(npm|npx)$/.test(command), ...opts })
  return r.status ?? 1
}

/** Ejecuta y devuelve la salida (sin mostrarla). */
function capture(command, args, opts = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', cwd: ROOT, shell: WIN && /^(npm|npx)$/.test(command), ...opts })
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

function platformKey() {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux' }[osPlatform()]
  return os ? `${os}-${osArch()}` : null
}

const fmtMB = (b) => `${(b / 1e6).toFixed(0)} MB`

async function getBytes(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'survival-os-express' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Manifiesto de la última release, con la firma Ed25519 verificada (ADR 0021). */
async function latestManifest() {
  const [bytes, sig] = await Promise.all([getBytes(`${LATEST_BASE}/${MANIFEST_NAME}`), getBytes(`${LATEST_BASE}/${SIG_NAME}`)])
  const v = verifyManifest(bytes, sig.toString('utf8'))
  if (!v.ok) throw new Error(`el manifiesto de la release no es auténtico: ${v.error}`)
  return parseManifest(bytes)
}

function sha256File(file) {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex')
}

/**
 * Descarga el fichero publicado de este tipo y plataforma (con caché) y comprueba tamaño y SHA-256 contra el
 * manifiesto firmado. → { file, asset, manifest }
 */
async function fetchRelease({ kind, platform, runtimes = [] }) {
  say('Consultando la última versión publicada en GitHub…')
  let manifest
  try {
    manifest = await latestManifest()
  } catch (e) {
    fail(`no se pudo obtener la versión publicada (${e.message}). Sin Internet, quita --release para compilar desde el código.`)
  }
  const asset = pickAsset(manifest, { kind, platform, runtimes })
  if (!asset) fail(`la versión ${manifest.version} no trae fichero para ${kind} ${platform}`)
  mkdirSync(CACHE, { recursive: true })
  const file = join(CACHE, asset.name)
  if (existsSync(file) && statSync(file).size === asset.size && sha256File(file) === asset.sha256) {
    ok(`${asset.name} ya descargado y verificado (${fmtMB(asset.size)})`)
    return { file, asset, manifest }
  }
  say(`Descargando ${asset.name} (${fmtMB(asset.size)}, versión ${manifest.version})…`)
  const r = await fetch(`${tagBase(manifest.tag)}/${asset.name}`, { redirect: 'follow', headers: { 'user-agent': 'survival-os-express' } })
  if (!r.ok || !r.body) fail(`no se pudo descargar ${asset.name} (HTTP ${r.status})`)
  let done = 0
  let shown = 0
  const tmp = `${file}.part`
  const src = Readable.fromWeb(r.body)
  src.on('data', (c) => {
    done += c.length
    const pct = Math.floor((done / asset.size) * 10) * 10
    if (pct > shown && pct < 100) {
      shown = pct
      console.log(`  … ${pct} %`)
    }
  })
  await pipeline(src, createWriteStream(tmp))
  if (statSync(tmp).size !== asset.size || sha256File(tmp) !== asset.sha256) {
    rmSync(tmp, { force: true })
    fail(`${asset.name} no coincide con el manifiesto firmado (descarga dañada o manipulada): no se usa`)
  }
  rmSync(file, { force: true })
  copyFileSync(tmp, file)
  rmSync(tmp, { force: true })
  ok(`descargado y verificado (firma de la release + SHA-256): ${asset.name}`)
  return { file, asset, manifest }
}

// ------------------------------------------------------------------ SSH

function target() {
  if (flag('local')) {
    if (osPlatform() !== 'linux') fail('--local solo sirve en Linux (en Windows o macOS usa la versión portable)', 2)
    const user = process.env.USER ?? capture('id', ['-un']).out
    return {
      host: 'localhost',
      user,
      dest: 'este equipo',
      local: true,
      ssh: (cmdline, show = false) => (show ? run('bash', ['-c', cmdline]) : capture('bash', ['-c', cmdline])),
      scp: (files, dir) => {
        for (const f of files) copyFileSync(f, join(dir, basename(f)))
        return 0
      },
    }
  }
  const host = opt('host')
  const user = opt('user')
  if (!host || !user) fail('indica --host <IP o nombre> y --user <usuario de la Pi> (o --local para este mismo Linux)', 2)
  if (!/^[\w.:-]+$/.test(host) || !/^[a-z_][\w.-]*$/i.test(user)) fail('host o usuario no válidos', 2)
  const key = opt('key') ?? (existsSync(DEFAULT_KEY) ? DEFAULT_KEY : null)
  const port = opt('port', '22')
  const base = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', ...(key ? ['-i', key] : [])]
  return {
    host,
    user,
    dest: `${user}@${host}`,
    ssh: (remote, show = false) => (show ? run('ssh', [...base, '-p', port, `${user}@${host}`, remote]) : capture('ssh', [...base, '-p', port, `${user}@${host}`, remote])),
    scp: (files, remoteDir) => run('scp', [...base, '-P', port, ...files, `${user}@${host}:${remoteDir}`]),
  }
}

function keySetupHelp(t) {
  const pub = `${DEFAULT_KEY}.pub`
  console.log(`
Survivelia OS necesita entrar en ${t.dest} por SSH SIN escribir la contraseña cada vez.
Hazlo una sola vez:

  1. Crea la clave (si no existe):   npm run express -- ssh-setup --host ${t.host} --user ${t.user}
  2. Cópiala a la Pi (te pedirá la contraseña de la Pi UNA vez):
${WIN
    ? `       type "${pub}" | ssh ${t.dest} "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`
    : `       ssh-copy-id -i "${pub}" ${t.dest}`}
  3. Vuelve a lanzar el comando anterior.

¿No conoces la IP? En la Pi: icono de red → «Información de la conexión», o en una terminal de la Pi: hostname -I
¿SSH desactivado? En la Pi: Preferencias → Configuración de Raspberry Pi → Interfaces → SSH (activar).
`)
}

// ------------------------------------------------------------------ preparar el código

function prepare() {
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 24 || (maj === 24 && min < 15)) fail(`hace falta Node 24.15 o posterior (tienes ${process.versions.node}): https://nodejs.org`)
  if (!existsSync(join(ROOT, 'node_modules'))) {
    say('Instalando dependencias (npm install)…')
    if (run('npm', ['install']) !== 0) fail('npm install ha fallado')
  }
  if (!existsSync(join(ROOT, 'apps', 'frontend', 'public', 'map-assets', 'fonts'))) {
    say('Descargando tipografías e iconos del mapa…')
    if (run(process.execPath, ['scripts/fetch-map-assets.mjs']) !== 0) fail('fetch-map-assets ha fallado')
  }
}

function build() {
  say('Compilando la aplicación (npm run build)…')
  if (run('npm', ['run', 'build']) !== 0) fail('la compilación ha fallado')
}

// ------------------------------------------------------------------ órdenes

/** adb: en el PATH o en las rutas habituales del Android SDK. → ruta | null */
function findAdb() {
  if (capture('adb', ['version']).code === 0) return 'adb'
  const exe = WIN ? 'adb.exe' : 'adb'
  const sdks = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    WIN && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean)
  for (const sdk of sdks) if (existsSync(join(sdk, 'platform-tools', exe))) return join(sdk, 'platform-tools', exe)
  return null
}

/** Dispositivos de `adb devices`. → [{ serial, state }] */
function adbDevices(adb) {
  return capture(adb, ['devices'])
    .out.split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((x) => x[0] && x[1])
    .map(([serial, state]) => ({ serial, state }))
}

async function doctor() {
  say(`Este ordenador: ${osPlatform()} ${osArch()} · Node ${process.versions.node}`)
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj > 24 || (maj === 24 && min >= 15)) ok('Node 24.15 o posterior')
  else if (maj >= 20) bad('Node 24.15 o posterior para COMPILAR (con --release basta este Node)')
  else bad('Node 20 o posterior (mejor 24 LTS): https://nodejs.org')
  console.log('  Para compilar desde el código (sin --release):')
  ;(existsSync(join(ROOT, 'node_modules')) ? ok : bad)('  dependencias (npm install; «portable», «pi» y «android» las instalan solas)')
  ;(existsSync(join(ROOT, 'apps', 'frontend', 'public', 'map-assets', 'fonts')) ? ok : bad)('  recursos del mapa (node scripts/fetch-map-assets.mjs; también automático)')
  console.log('  Raspberry Pi o Linux por SSH:')
  ;(capture('ssh', ['-V']).code === 0 ? ok : bad)('  cliente SSH')
  ;(existsSync(DEFAULT_KEY) ? ok : bad)(`  clave SSH de Survivelia OS (${DEFAULT_KEY}; la crea «ssh-setup»)`)
  console.log('  Android:')
  const adb = findAdb()
  if (!adb) bad('  adb (opcional; sin él se descarga el APK para copiarlo a mano): https://developer.android.com/tools/releases/platform-tools')
  else {
    ok(`  adb (${adb})`)
    const devs = adbDevices(adb)
    if (!devs.length) bad('  ningún Android conectado por USB con la depuración activada')
    for (const d of devs) (d.state === 'device' ? ok : bad)(`  ${d.serial}: ${d.state === 'unauthorized' ? 'acepta la depuración USB en la pantalla' : d.state}`)
  }
  console.log('  Este ordenador:')
  ;(PORTABLE_TARGETS.includes(platformKey()) ? ok : bad)(`  versión portable para este sistema (${platformKey() ?? 'no'})`)
  const open = runningPortable(DEFAULT_PORTABLE)
  if (open) ok(`  portable abierta en ${DEFAULT_PORTABLE} (${open})`)
  else if (existsSync(join(DEFAULT_PORTABLE, 'data'))) ok(`  portable instalada en ${DEFAULT_PORTABLE} (cerrada)`)
  try {
    const m = await latestManifest()
    const local = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
    ok(`última versión publicada: ${m.version} (${m.date}), firma verificada · este código: ${local}`)
  } catch (e) {
    bad(`GitHub no responde (${e.message}): sin Internet, compila desde el código (sin --release)`)
  }
}

function sshSetup() {
  const t = target()
  if (!existsSync(DEFAULT_KEY)) {
    mkdirSync(dirname(DEFAULT_KEY), { recursive: true })
    say(`Creando la clave ${DEFAULT_KEY}…`)
    if (run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'survival-os', '-f', DEFAULT_KEY]) !== 0) fail('ssh-keygen ha fallado')
  } else ok(`la clave ya existe: ${DEFAULT_KEY}`)
  if (t.ssh('true').code === 0) {
    ok(`acceso SSH sin contraseña a ${t.dest}: listo`)
    return
  }
  keySetupHelp(t)
  process.exit(3)
}

function newest(dir, re) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)) : []
  files.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)
  return files[0] ? join(dir, files[0]) : null
}

async function pi() {
  const t = target()
  say(t.local ? 'Comprobando este equipo…' : `Comprobando el acceso a ${t.dest}…`)
  const probe = t.ssh('uname -m; . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"; command -v systemctl >/dev/null && echo systemd')
  if (probe.code !== 0) {
    bad(`no hay acceso SSH sin contraseña (${probe.err.split('\n')[0] || 'sin respuesta'})`)
    keySetupHelp(t)
    process.exit(3)
  }
  const [machine, osName, init] = probe.out.split('\n')
  ok(`${osName} · ${machine}`)
  if (!/aarch64|arm64|x86_64/.test(machine ?? '')) fail(`arquitectura no soportada: ${machine}`)
  if (init !== 'systemd') fail('el equipo no usa systemd: usa la versión portable')
  if (t.ssh('sudo -n true').code !== 0) {
    bad('el usuario necesita sudo sin contraseña (Raspberry Pi OS lo trae así para el primer usuario).')
    console.log(`  Arreglo (en ${t.local ? 'este equipo' : 'la Pi'}, una vez):  echo "${t.user} ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/010-survival-os`)
    process.exit(4)
  }
  ok('sudo sin contraseña')
  const installed = /"version":"([^"]+)"/.exec(t.ssh('curl -s -m 5 http://127.0.0.1:3000/api/health').out)?.[1]
  if (installed) ok(`ya instalado: versión ${installed} (se actualizará conservando datos y configuración)`)

  if (!flag('yes')) {
    console.log(`\nSe instalará (o actualizará) Survivelia OS en ${t.dest}:`)
    console.log(`  Origen: ${flag('release') ? 'última versión publicada en GitHub (verificada)' : 'compilado desde este código (añade --release para descargar la publicada)'}.`)
    console.log('  /opt/survival-os, usuario de servicio «survival», servicios survival-*, modo quiosco (salvo --no-kiosk).')
    console.log('  Los datos y la configuración existentes se conservan. Vuelve a lanzar con --yes para continuar.')
    process.exit(0)
  }

  let tgz
  if (flag('release')) {
    const plat = /x86_64/.test(machine) ? 'linux-x64' : 'linux-arm64'
    const r = await fetchRelease({ kind: 'system', platform: plat })
    tgz = r.file
    writeFileSync(`${tgz}.sha256`, `${r.asset.sha256}  ${r.asset.name}\n`)
  } else {
    prepare()
    build()
    say('Empaquetando (npm run release)…')
    if (run(process.execPath, ['scripts/release.mjs']) !== 0) fail('npm run release ha fallado')
    tgz = newest(join(ROOT, 'release'), /^survival-os-\d+\.\d+\.\d+\.tar\.gz$/)
    if (!tgz) fail('no se encuentra el paquete en release/')
  }
  const name = basename(tgz)
  say(t.local ? `Preparando ${name}…` : `Copiando ${name} a la Pi…`)
  if (t.scp([tgz, `${tgz}.sha256`], '/tmp/') !== 0) fail('la copia ha fallado')
  say('Instalando (sudo install-system.sh)…')
  // install-system.sh sale del propio paquete: siempre la misma versión que se instala.
  const top = name.replace(/\.tar\.gz$/, '')
  const installCmd = [
    'cd /tmp',
    `sha256sum -c ${name}.sha256`,
    `tar -xzf ${name} -O ${top}/scripts/install-system.sh > /tmp/survival-install-system.sh`,
    `sudo -n bash /tmp/survival-install-system.sh /tmp/${name}${flag('no-kiosk') ? ' --no-kiosk' : ''}`,
  ].join(' && ')
  if (t.ssh(installCmd, true) !== 0) fail('la instalación ha fallado (ver mensajes)')
  say('Comprobando que responde…')
  let health = ''
  for (let i = 0; i < 30 && !health.includes('"status"'); i++) {
    health = t.ssh('curl -s -m 5 http://127.0.0.1:3000/api/health').out
    if (!health.includes('"status"')) await new Promise((r) => setTimeout(r, 2000))
  }
  if (!health.includes('"status"')) fail('Survivelia OS no responde tras instalar (ver: journalctl -u survival-web)')
  ok(`Survivelia OS responde: ${health.slice(0, 120)}`)
  if (flag('no-kiosk')) {
    console.log(`\nListo. Se usa en ${t.local ? 'este equipo' : t.dest} en http://127.0.0.1:3000 (solo desde ese equipo).`)
    return
  }
  if (flag('reboot')) {
    say('Reiniciando para arrancar en modo quiosco…')
    t.ssh('sudo -n systemctl reboot')
  } else console.log('\nListo. Reinicia la Pi para arrancar en modo quiosco (o añade --reboot).')
  console.log('En la pantalla aparecerá la bienvenida: idioma, país y «Descargarlo todo».')
}

/** ¿Hay una portable abierta en esa carpeta? → url | null (data/run.json con un proceso vivo). */
function runningPortable(dir) {
  try {
    const r = JSON.parse(readFileSync(join(dir, 'data', 'run.json'), 'utf8'))
    process.kill(r.pid, 0)
    return r.url ?? null
  } catch {
    return null
  }
}

async function portable() {
  const key = platformKey()
  if (!key || !PORTABLE_TARGETS.includes(key)) fail(`sistema no soportado por la portable: ${osPlatform()} ${osArch()}`)
  const dest = resolve(opt('dest', DEFAULT_PORTABLE))
  const open = runningPortable(dest)
  if (open) fail(`Survivelia OS está abierto desde ${dest} (${open}). Ciérralo antes (npm run express -- stop --dest "${dest}") o actualízalo desde dentro (npm run express -- update --dest "${dest}" --yes)`)
  let src
  if (flag('release')) {
    const { file } = await fetchRelease({ kind: 'portable', platform: key, runtimes: flag('all-systems') ? PORTABLE_TARGETS : [] })
    const stage = join(CACHE, 'stage')
    rmSync(stage, { recursive: true, force: true })
    say('Descomprimiendo…')
    extractZip(file, stage)
    src = join(stage, 'Survivelia OS')
    if (!existsSync(src)) fail('el zip descargado no tiene la carpeta «Survivelia OS»')
  } else {
    prepare()
    build()
    const targets = flag('all-systems') ? PORTABLE_TARGETS.join(',') : key
    say(`Generando la versión portable para ${targets}…`)
    if (run(process.execPath, ['scripts/release-portable.mjs', `--targets=${targets}`, '--no-zip']) !== 0) fail('release:portable ha fallado')
    src = join(ROOT, 'release', 'portable', 'Survivelia OS')
  }
  if (existsSync(join(dest, 'data'))) {
    // Actualizar una carpeta existente sin tocar los datos.
    say(`Actualizando ${dest} (tus datos en data/ se conservan)…`)
    for (const e of readdirSync(src)) if (e !== 'data') {
      rmSync(join(dest, e), { recursive: true, force: true })
      cpSync(join(src, e), join(dest, e), { recursive: true })
    }
  } else {
    say(`Copiando a ${dest}…`)
    cpSync(src, dest, { recursive: true })
  }
  ok(`Survivelia OS portable en: ${dest}`)
  const node = join(dest, 'runtime', key, WIN ? 'node.exe' : 'node')
  const args = [join(dest, 'app', 'portable', 'launcher.mjs'), ...(flag('install') ? ['--install'] : [])]
  if (flag('no-open') && !flag('install')) {
    console.log(`\nPara abrirla: ${WIN ? '«Abrir Survivelia OS»' : osPlatform() === 'darwin' ? '«Survivelia OS.app»' : 'sh abrir-survival-os.sh'} dentro de esa carpeta.`)
    return
  }
  say(flag('install') ? 'Instalando en este equipo y abriendo…' : 'Abriendo Survivelia OS…')
  spawn(node, args, { cwd: dest, detached: true, stdio: 'ignore', windowsHide: true }).unref()
  console.log('Se abre en una ventana propia. La primera vez aparece la bienvenida: idioma, país y «Descargarlo todo».')
  // Esperar a que responda: así «defaults», «status» y «download» se pueden encadenar justo después.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const url = runningPortable(dest)
    if (url && (await fetch(`${url}/api/health`).then((r) => r.ok).catch(() => false))) {
      ok(`responde en ${url} (para «status», «download»…: --dest "${dest}")`)
      return
    }
  }
  console.log('  (todavía no responde; puede tardar más la primera vez. Comprueba con «status».)')
}

/** Dirección de la API: --url, --local, --dest (portable) o la portable de ~/Survivelia OS abierta. null = Pi por SSH. */
function apiUrl() {
  if (opt('url')) return opt('url').replace(/\/$/, '')
  if (flag('local')) return 'http://127.0.0.1:3000'
  if (opt('host')) return null
  const dir = resolve(opt('dest', DEFAULT_PORTABLE))
  const url = runningPortable(dir)
  if (url) return url
  if (opt('dest') || !opt('user')) fail(`no hay un Survivelia OS abierto en ${dir}: ábrelo, o indica --url, --local o --host/--user`, 2)
  return null
}

/** Petición a la API local de un Survivelia OS: por SSH (Pi) o directamente (portable en este equipo). */
function api(method, path, body = null) {
  const url = apiUrl()
  if (url) {
    return fetch(`${url}${path}`, {
      method,
      headers: { 'x-survival-action': '1', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .catch(() => ({ ok: false, data: null }))
  }
  const t = target()
  const data = body ? ` -H 'content-type: application/json' -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : ''
  const r = t.ssh(`curl -s -m 30 -X ${method} -H 'x-survival-action: 1'${data} http://127.0.0.1:3000${path}`)
  let parsed = null
  try {
    parsed = JSON.parse(r.out)
  } catch {
    // respuesta no JSON
  }
  return Promise.resolve({ ok: r.code === 0 && parsed !== null, data: parsed })
}

async function status() {
  const h = await api('GET', '/api/health')
  if (!h.ok) fail('Survivelia OS no responde')
  say(`Estado: ${h.data.status} · versión ${h.data.version}`)
  for (const [k, v] of Object.entries(h.data.components ?? {})) console.log(`  ${v.state === 'ok' ? '✓' : '·'} ${k}: ${v.state}`)
  for (;;) {
    const c = await api('GET', '/api/content')
    let busy = []
    if (c.ok) {
      const items = c.data.items ?? []
      const inst = items.filter((i) => i.state === 'installed').length
      busy = items.filter((i) => i.state === 'downloading' || i.state === 'verifying')
      const failed = items.filter((i) => i.state === 'failed')
      console.log(`  Contenidos: ${inst} instalados · ${busy.length} descargando · ${failed.length} con error${c.data.freeBytes != null ? ` · ${(c.data.freeBytes / 1e9).toFixed(1)} GB libres` : ''}`)
      for (const i of busy) console.log(`    ↓ ${i.id}: ${i.state}${i.total ? ` ${Math.floor(((i.done ?? 0) / i.total) * 100)} % de ${fmtMB(i.total)}` : ''}`)
      for (const i of failed) console.log(`    ✗ ${i.id}: ${i.error ?? 'error'}`)
    }
    const p = await api('GET', '/api/content/plan?mode=all')
    if (p.ok) console.log(p.data.complete ? '  «Descargarlo todo»: no falta nada ✓' : `  «Descargarlo todo»: faltan ${p.data.items.length} (${(p.data.bytes / 1e9).toFixed(1)} GB)`)
    if (!flag('watch') || !busy.length) return
    await new Promise((r) => setTimeout(r, 30_000))
    console.log(`--- ${new Date().toLocaleTimeString()}`)
  }
}

async function download() {
  const q = new URLSearchParams({ mode: flag('recommended') ? 'recommended' : 'all' })
  if (opt('lang')) q.set('lang', opt('lang'))
  if (opt('country')) q.set('country', opt('country'))
  const p = await api('GET', `/api/content/plan?${q}`)
  if (!p.ok) fail('no se pudo calcular el plan (¿Survivelia OS en marcha?)')
  const d = p.data
  if (d.complete || !d.items.length) {
    ok('No falta nada: todo está descargado.')
    return
  }
  say(`Plan (${d.lang}${d.country ? `, ${d.country.name}` : ''}): ${d.items.length} elementos · ${(d.bytes / 1e9).toFixed(1)} GB · libres ${d.freeBytes != null ? (d.freeBytes / 1e9).toFixed(1) : '?'} GB`)
  if (d.dropped.length) console.log(`  No caben ${d.dropped.length} (${(d.droppedBytes / 1e9).toFixed(1)} GB): ${d.dropped.join(', ')}`)
  console.log(`  ${d.items.join(' ')}`)
  if (!flag('yes')) {
    console.log('\nVuelve a lanzar con --yes para empezar la descarga (puede tardar horas; el equipo se puede usar mientras).')
    return
  }
  const r = await api('POST', '/api/admin/content', { action: 'install', items: d.items })
  if (!r.ok) fail(`no se pudo lanzar la descarga: ${JSON.stringify(r.data).slice(0, 200)}`)
  ok('Descarga en marcha. Sigue el progreso con «status» o en la pantalla de inicio.')
}

function defaults() {
  const lang = opt('lang')
  const country = opt('country')
  if (lang && !['es', 'en', 'fr', 'it'].includes(lang)) fail('--lang debe ser es, en, fr o it', 2)
  if (country && !/^[a-z]{3}$/.test(country)) fail('--country es el código de 3 letras (esp, fra, ita, usa…; ver content/countries.json)', 2)
  if (!lang && !country) fail('indica --lang y/o --country', 2)
  const json = JSON.stringify({ locale: lang ?? null, country: country ?? null })
  const portableDir = opt('dest') ?? (!opt('host') && !flag('local') && existsSync(join(DEFAULT_PORTABLE, 'data')) ? DEFAULT_PORTABLE : null)
  if (portableDir) {
    const dir = join(resolve(portableDir), 'data')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'defaults.json'), `${json}\n`)
    ok(`Guardado en ${join(dir, 'defaults.json')}`)
    return
  }
  const t = target()
  const r = t.ssh(`echo '${json}' | sudo -n tee /etc/survival-os/defaults.json >/dev/null && sudo -n chmod 0644 /etc/survival-os/defaults.json && echo ok`)
  if (!r.out.endsWith('ok')) fail(`no se pudo guardar (${r.err.split('\n')[0]})`)
  ok(`Idioma${lang ? ` ${lang}` : ''}${country ? ` · país ${country}` : ''} por defecto en ${t.dest}. Se aplican en pantalla si el usuario no eligió otros.`)
}

/** Espera a que termine una tarea de mantenimiento (tolera que la web se reinicie al actualizar). → último estado */
async function waitJob(job, maxMs, prevStartedAt = null) {
  const end = Date.now() + maxMs
  let last = null
  let seenActive = false
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3000))
    const r = await api('GET', `/api/admin/${job}`).catch(() => ({ ok: false }))
    if (!r.ok) continue // la interfaz se está reiniciando (instalación en la Pi)
    last = r.data
    const active = last.state === 'active' || last.state === 'activating'
    if (active) seenActive = true
    else if (seenActive || (last.startedAt && last.startedAt !== prevStartedAt && last.finishedAt)) return last
  }
  return last
}

/** Actualizaciones desde GitHub (ADR 0021): estado, «Buscar ahora», modo y, con --yes, instalar. */
async function update() {
  if (opt('mode')) {
    if (!['auto', 'notify', 'off'].includes(opt('mode'))) fail('--mode debe ser auto, notify u off', 2)
    const m = await api('POST', '/api/update/settings', { mode: opt('mode') })
    if (!m.ok) fail(`no se pudo cambiar el modo: ${JSON.stringify(m.data).slice(0, 200)}`)
    ok(`Modo de actualización: ${opt('mode')}`)
  }
  if (flag('check')) {
    say('Buscando actualizaciones…')
    const prev = await api('GET', '/api/admin/update-online')
    const r = await api('POST', '/api/admin/update-online', { action: 'check' })
    if (!r.ok) fail(`no se pudo lanzar la comprobación: ${JSON.stringify(r.data).slice(0, 200)}`)
    await waitJob('update-online', 120_000, prev.data?.startedAt ?? null)
  }
  const s = await api('GET', '/api/update')
  if (!s.ok) fail('Survivelia OS no responde, o es anterior a 0.10.0 (sin actualizaciones desde GitHub: actualiza con «pi» o con la portable nueva)')
  const d = s.data
  if (!d.supported) fail('instalación de desarrollo: no hay actualizaciones automáticas')
  say(`Instalada ${d.installed} · modo ${d.mode}${d.latest ? ` · última ${d.latest.version} (${d.latest.date})` : ''}`)
  console.log(`  Última comprobación: ${d.okAt ?? d.checkedAt ?? 'nunca'}${d.error ? ` · ${d.error.code}: ${d.error.message}` : ''}`)
  if (d.prepared) console.log(`  Versión ${d.prepared} preparada: se aplica al cerrar Survivelia OS.`)
  if (d.deferred) console.log(`  Descargada; instalación aplazada (${d.deferred.reason}).`)
  if (d.lastInstall) console.log(`  Última instalación: ${d.lastInstall.version} ${d.lastInstall.ok ? 'correcta' : `FALLÓ (${d.lastInstall.message})`}`)
  if (d.status !== 'available') {
    ok(d.status === 'up-to-date' ? 'Al día.' : `Nada que instalar (${d.status ?? 'sin comprobar: añade --check'}).`)
    return
  }
  console.log(`  Nueva versión ${d.latest.version}${d.asset ? ` · ${(d.asset.size / 1e6).toFixed(0)} MB` : ''}`)
  if (!flag('yes')) {
    console.log('\nVuelve a lanzar con --yes para instalarla (tras confirmarlo con la persona). Los datos se conservan.')
    return
  }
  say(`Instalando ${d.latest.version}…`)
  const prev = await api('GET', '/api/admin/update-online')
  const r = await api('POST', '/api/admin/update-online', { action: 'install' })
  if (!r.ok) fail(`no se pudo lanzar la instalación: ${JSON.stringify(r.data).slice(0, 200)}`)
  const end = await waitJob('update-online', 30 * 60_000, prev.data?.startedAt ?? null)
  for (const l of (end?.log ?? []).slice(-8)) console.log(`  ${l}`)
  if (end?.state === 'failed') fail('la instalación falló (la versión anterior sigue funcionando)')
  ok(d.kind === 'android' ? 'Descargada: confirma la instalación en la pantalla de Android.' : 'Instalada. Comprueba con: npm run express -- status')
}

/** Cerrar la portable (como su botón «Cerrar Survivelia OS»): p. ej. antes de actualizar su carpeta con «portable». */
async function stop() {
  const dir = resolve(opt('dest', DEFAULT_PORTABLE))
  const url = runningPortable(dir)
  if (!url) {
    ok(`no está abierto en ${dir}`)
    return
  }
  const r = await api('POST', '/api/portable/quit')
  if (!r.ok) fail(`no se pudo cerrar (${JSON.stringify(r.data).slice(0, 160)})`)
  for (let i = 0; i < 30 && runningPortable(dir); i++) await new Promise((res) => setTimeout(res, 1000))
  if (runningPortable(dir)) fail('sigue abierto tras 30 s: ciérralo desde su ventana («Cerrar Survivelia OS»)')
  ok('Survivelia OS cerrado (si había una actualización preparada, se ha aplicado)')
}

const ANDROID_ID = 'org.survivalos.app'

/** Android: obtener el APK (publicado, compilado o --apk) y, con adb y --yes, instalarlo y abrirlo. */
async function android() {
  const adb = findAdb()
  let dev = null
  if (!adb) bad('adb no está instalado: el APK se prepara para copiarlo a la tablet a mano (AGENTS.md §6.2)')
  else {
    const devs = adbDevices(adb)
    for (const d of devs.filter((x) => x.state === 'unauthorized')) bad(`${d.serial}: acepta «¿Permitir depuración USB?» en la pantalla del dispositivo`)
    const ready = devs.filter((d) => d.state === 'device' && (!opt('serial') || d.serial === opt('serial')))
    if (ready.length > 1) fail(`hay ${ready.length} dispositivos: elige uno con --serial (${ready.map((d) => d.serial).join(', ')})`, 2)
    dev = ready[0] ?? null
    if (!dev) bad('ningún Android conectado y autorizado (Depuración USB: AGENTS.md §6.2)')
  }
  const sh = (c) => capture(adb, ['-s', dev.serial, 'shell', c]).out
  let abi = opt('abi')
  if (abi && !['arm64', 'x86_64'].includes(abi)) fail('--abi debe ser arm64 o x86_64', 2)
  if (dev) {
    const cpu = sh('getprop ro.product.cpu.abi')
    const sdk = Number(sh('getprop ro.build.version.sdk'))
    ok(`${sh('getprop ro.product.manufacturer')} ${sh('getprop ro.product.model')} · Android ${sh('getprop ro.build.version.release')} · ${cpu}`)
    if (sdk && sdk < 29) fail('Survivelia OS necesita Android 10 o posterior')
    abi ??= cpu.startsWith('arm64') ? 'arm64' : cpu === 'x86_64' ? 'x86_64' : null
    if (!abi) fail(`arquitectura no soportada: ${cpu} (hace falta un Android de 64 bits)`)
    const ver = /versionName=(\S+)/.exec(sh(`dumpsys package ${ANDROID_ID}`))?.[1]
    if (ver) ok(`Survivelia OS ${ver} ya instalado: se actualizará conservando los datos`)
  }
  abi ??= 'arm64'
  if (!flag('yes')) {
    const from = opt('apk') ?? (flag('release') ? 'la última versión publicada en GitHub (verificada)' : 'compilado desde el código (JDK 17+, SDK, NDK y Go; añade --release para descargarlo)')
    console.log(`\nAPK ${abi}: ${from}.`)
    console.log(dev ? `Se instalará en ${dev.serial} con adb y se abrirá. Vuelve a lanzar con --yes.` : 'Sin dispositivo por adb: con --yes solo se prepara el APK para copiarlo a mano.')
    return
  }
  let apk = opt('apk')
  if (apk) {
    if (!existsSync(apk)) fail(`no existe ${apk}`, 2)
    if (existsSync(`${apk}.sha256`)) {
      if (readFileSync(`${apk}.sha256`, 'utf8').split(/\s/)[0] !== sha256File(apk)) fail(`${apk} no coincide con ${apk}.sha256`)
      ok('SHA-256 correcto')
    }
  } else if (flag('release')) {
    apk = (await fetchRelease({ kind: 'android', platform: abi === 'arm64' ? 'android-arm64' : 'android-x64' })).file
  } else {
    prepare()
    build()
    say('Compilando el APK (npm run release:android)…')
    if (run(process.execPath, ['android/scripts/build.mjs', `--abi=${abi === 'arm64' ? 'arm64-v8a' : 'x86_64'}`]) !== 0) fail('release:android ha fallado')
    apk = newest(join(ROOT, 'release'), new RegExp(`^survival-os-\\d+\\.\\d+\\.\\d+-android-${abi}\\.apk$`))
    if (!apk) fail('no se encuentra el APK en release/')
  }
  if (!dev) {
    console.log(`\nAPK listo: ${apk}`)
    console.log('Cópialo a la tablet (cable, microSD o descarga) y ábrelo; Android pedirá permitir «instalar apps desconocidas».')
    process.exit(5)
  }
  say(`Instalando ${basename(apk)} en ${dev.serial}…`)
  const r = capture(adb, ['-s', dev.serial, 'install', '-r', apk])
  if (r.code !== 0 || !/Success/.test(r.out)) {
    const msg = `${r.out}\n${r.err}`
    if (/UPDATE_INCOMPATIBLE|signatures do not match/i.test(msg)) {
      fail(`la app instalada está firmada con otra clave y Android no deja actualizarla. Desinstalarla
  (adb uninstall ${ANDROID_ID}) borra sus datos internos; los de la carpeta SurvivalOS o la microSD se conservan.
  Pregúntalo a la persona antes de hacerlo.`)
    }
    fail(`adb install ha fallado: ${msg.trim().split('\n').pop()}`)
  }
  ok('instalado')
  capture(adb, ['-s', dev.serial, 'shell', 'monkey', '-p', ANDROID_ID, '-c', 'android.intent.category.LAUNCHER', '1'])
  ok('abierto en el dispositivo')
  console.log(`
En la pantalla, la persona:
  1. elige dónde guardar los datos (mejor «Memoria interna (carpeta SurvivalOS)» o la microSD) y activa «Acceso a todos los archivos»;
  2. acepta notificaciones, ubicación y batería sin restricciones;
  3. en la bienvenida: idioma, país y «Descargarlo todo».
(Realme, Xiaomi, Huawei, Oppo…: activar también «Inicio automático» y «Actividad en segundo plano».)`)
}

const COMMANDS = { doctor, 'ssh-setup': sshSetup, pi, portable, android, stop, status, download, defaults, update }
if (!COMMANDS[cmd]) {
  console.log('Uso: npm run express -- <doctor | portable | stop | ssh-setup | pi | android | defaults | status | download | update> [opciones]')
  console.log('Detalles al principio de scripts/express.mjs y en AGENTS.md.')
  process.exit(cmd ? 2 : 0)
}
await COMMANDS[cmd]()
