#!/usr/bin/env node
/**
 * Survival OS · instalación y configuración EXPRÉS (personas y agentes LLM; ver AGENTS.md).
 * Node sin dependencias. Windows, macOS y Linux. Usa el ssh/scp del sistema (OpenSSH).
 *
 *   npm run express -- doctor                                  comprobar requisitos de este ordenador
 *   npm run express -- portable [--dest DIR] [--no-open] [--install]
 *                                                              versión portable para ESTE sistema, lista para usar
 *   npm run express -- ssh-setup --host IP --user USUARIO      preparar el acceso SSH sin contraseña a la Pi
 *   npm run express -- pi --host IP --user USUARIO [--key F] [--port 22] [--no-kiosk] [--reboot] [--yes]
 *                                                              instalar o actualizar en una Raspberry Pi (o Linux) por SSH
 *   npm run express -- defaults --lang es|en|fr|it --country esp (--host IP --user U | --dest DIR)
 *                                                              idioma y país por defecto del equipo
 *   npm run express -- status (--host IP --user U | --url http://127.0.0.1:47800)
 *   npm run express -- download [--recommended] [--lang L] [--country C] [--yes] (--host … | --url …)
 *                                                              plan de «Descargarlo todo» y, con --yes, lanzarlo
 *   npm run express -- update [--check] [--mode auto|notify|off] [--yes] (--host … | --url …)
 *                                                              actualizaciones desde GitHub (ADR 0021); --yes instala
 *
 * Códigos de salida: 0 bien · 1 error · 2 uso incorrecto · 3 falta acceso SSH · 4 falta sudo sin contraseña.
 * Nunca guarda contraseñas. La clave SSH se crea en ~/.ssh/survival_os_ed25519 (solo con ssh-setup).
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, platform as osPlatform, arch as osArch } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIN = osPlatform() === 'win32'
const DEFAULT_KEY = join(homedir(), '.ssh', 'survival_os_ed25519')

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

// ------------------------------------------------------------------ SSH

function target() {
  const host = opt('host')
  const user = opt('user')
  if (!host || !user) fail('indica --host <IP o nombre> y --user <usuario de la Pi>', 2)
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
Survival OS necesita entrar en ${t.dest} por SSH SIN escribir la contraseña cada vez.
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

function doctor() {
  say(`Este ordenador: ${osPlatform()} ${osArch()} · Node ${process.versions.node}`)
  const [maj, min] = process.versions.node.split('.').map(Number)
  ;(maj > 24 || (maj === 24 && min >= 15) ? ok : bad)('Node 24.15 o posterior')
  ;(existsSync(join(ROOT, 'node_modules')) ? ok : bad)('dependencias instaladas (npm install)')
  ;(existsSync(join(ROOT, 'apps', 'frontend', 'public', 'map-assets', 'fonts')) ? ok : bad)('recursos del mapa (node scripts/fetch-map-assets.mjs)')
  ;(capture('ssh', ['-V']).code === 0 ? ok : bad)('cliente SSH (solo para instalar en una Pi)')
  ;(existsSync(DEFAULT_KEY) ? ok : bad)(`clave SSH de Survival OS (${DEFAULT_KEY}; la crea «ssh-setup»)`)
  ;(platformKey() ? ok : bad)(`versión portable disponible para este sistema (${platformKey() ?? 'no'})`)
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

function pi() {
  const t = target()
  say(`Comprobando el acceso a ${t.dest}…`)
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
    console.log(`  Arreglo (en la Pi, una vez):  echo "${t.user} ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/010-survival-os`)
    process.exit(4)
  }
  ok('sudo sin contraseña')

  if (!flag('yes')) {
    console.log(`\nSe instalará (o actualizará) Survival OS en ${t.dest}:`)
    console.log('  /opt/survival-os, usuario de servicio «survival», servicios survival-*, modo quiosco (salvo --no-kiosk).')
    console.log('  Los datos y la configuración existentes se conservan. Vuelve a lanzar con --yes para continuar.')
    process.exit(0)
  }

  prepare()
  build()
  say('Empaquetando (npm run release)…')
  if (run(process.execPath, ['scripts/release.mjs']) !== 0) fail('npm run release ha fallado')
  const tgz = newest(join(ROOT, 'release'), /^survival-os-\d+\.\d+\.\d+\.tar\.gz$/)
  if (!tgz) fail('no se encuentra el paquete en release/')
  say(`Copiando ${tgz.split(/[\\/]/).pop()} a la Pi…`)
  if (t.scp([tgz, `${tgz}.sha256`, join(ROOT, 'scripts', 'install-system.sh')], '/tmp/') !== 0) fail('scp ha fallado')
  const name = tgz.split(/[\\/]/).pop()
  say('Instalando (sudo install-system.sh)…')
  if (t.ssh(`cd /tmp && sha256sum -c ${name}.sha256 && sudo -n bash /tmp/install-system.sh /tmp/${name}${flag('no-kiosk') ? ' --no-kiosk' : ''}`, true) !== 0) fail('la instalación ha fallado (ver mensajes)')
  say('Comprobando que responde…')
  let health = ''
  for (let i = 0; i < 30 && !health.includes('"status"'); i++) {
    health = t.ssh('curl -s -m 5 http://127.0.0.1:3000/api/health').out
    if (!health.includes('"status"')) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)'])
  }
  if (!health.includes('"status"')) fail('Survival OS no responde tras instalar (ver: journalctl -u survival-web)')
  ok(`Survival OS responde: ${health.slice(0, 120)}`)
  if (flag('reboot')) {
    say('Reiniciando la Pi para arrancar en modo quiosco…')
    t.ssh('sudo -n systemctl reboot')
  } else console.log('\nListo. Reinicia la Pi para arrancar en modo quiosco (o añade --reboot).')
  console.log('En la pantalla aparecerá la bienvenida: idioma, país y «Descargarlo todo».')
}

function portable() {
  const key = platformKey()
  if (!key) fail(`sistema no soportado: ${osPlatform()} ${osArch()}`)
  prepare()
  build()
  say(`Generando la versión portable para ${key}…`)
  if (run(process.execPath, ['scripts/release-portable.mjs', `--targets=${key}`, '--no-zip']) !== 0) fail('release:portable ha fallado')
  const src = join(ROOT, 'release', 'portable', 'Survival OS')
  const dest = resolve(opt('dest', join(homedir(), 'Survival OS')))
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
  ok(`Survival OS portable en: ${dest}`)
  const node = join(dest, 'runtime', key, WIN ? 'node.exe' : 'node')
  const args = [join(dest, 'app', 'portable', 'launcher.mjs'), ...(flag('install') ? ['--install'] : [])]
  if (flag('no-open') && !flag('install')) {
    console.log(`\nPara abrirla: ${WIN ? '«Abrir Survival OS»' : osPlatform() === 'darwin' ? '«Survival OS.app»' : 'sh abrir-survival-os.sh'} dentro de esa carpeta.`)
    return
  }
  say(flag('install') ? 'Instalando en este equipo y abriendo…' : 'Abriendo Survival OS…')
  spawn(node, args, { cwd: dest, detached: true, stdio: 'ignore', windowsHide: true }).unref()
  console.log('Se abre en una ventana propia. La primera vez aparece la bienvenida: idioma, país y «Descargarlo todo».')
}

/** Petición a la API local de un Survival OS: por SSH (Pi) o directamente (portable en este equipo). */
function api(method, path, body = null) {
  const url = opt('url')
  if (url) {
    return fetch(`${url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'x-survival-action': '1', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
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
  if (!h.ok) fail('Survival OS no responde')
  say(`Estado: ${h.data.status} · versión ${h.data.version}`)
  for (const [k, v] of Object.entries(h.data.components ?? {})) console.log(`  ${v.state === 'ok' ? '✓' : '·'} ${k}: ${v.state}`)
  const c = await api('GET', '/api/content')
  if (c.ok) {
    const items = c.data.items ?? []
    const inst = items.filter((i) => i.state === 'installed').length
    const busy = items.filter((i) => i.state === 'downloading' || i.state === 'verifying').length
    console.log(`  Contenidos: ${inst} instalados · ${busy} descargando · ${c.data.freeBytes != null ? `${(c.data.freeBytes / 1e9).toFixed(1)} GB libres` : ''}`)
  }
  const p = await api('GET', '/api/content/plan?mode=all')
  if (p.ok) console.log(p.data.complete ? '  «Descargarlo todo»: no falta nada ✓' : `  «Descargarlo todo»: faltan ${p.data.items.length} (${(p.data.bytes / 1e9).toFixed(1)} GB)`)
}

async function download() {
  const q = new URLSearchParams({ mode: flag('recommended') ? 'recommended' : 'all' })
  if (opt('lang')) q.set('lang', opt('lang'))
  if (opt('country')) q.set('country', opt('country'))
  const p = await api('GET', `/api/content/plan?${q}`)
  if (!p.ok) fail('no se pudo calcular el plan (¿Survival OS en marcha?)')
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
  if (opt('dest')) {
    const dir = join(resolve(opt('dest')), 'data')
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
  if (!s.ok) fail('Survival OS no responde, o es anterior a 0.10.0 (sin actualizaciones desde GitHub: actualiza con «pi» o con la portable nueva)')
  const d = s.data
  if (!d.supported) fail('instalación de desarrollo: no hay actualizaciones automáticas')
  say(`Instalada ${d.installed} · modo ${d.mode}${d.latest ? ` · última ${d.latest.version} (${d.latest.date})` : ''}`)
  console.log(`  Última comprobación: ${d.okAt ?? d.checkedAt ?? 'nunca'}${d.error ? ` · ${d.error.code}: ${d.error.message}` : ''}`)
  if (d.prepared) console.log(`  Versión ${d.prepared} preparada: se aplica al cerrar Survival OS.`)
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

const COMMANDS = { doctor, 'ssh-setup': sshSetup, pi, portable, status, download, defaults, update }
if (!COMMANDS[cmd]) {
  console.log('Uso: npm run express -- <doctor | portable | ssh-setup | pi | defaults | status | download | update> [opciones]')
  console.log('Detalles al principio de scripts/express.mjs y en AGENTS.md.')
  process.exit(cmd ? 2 : 0)
}
await COMMANDS[cmd]()
