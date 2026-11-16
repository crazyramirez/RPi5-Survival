/**
 * «Abrir al conectar esta memoria» (ADR 0019): ninguna versión actual de Windows, macOS o Linux arranca un
 * programa de una memoria USB por sí sola. Con el permiso del usuario, y una sola vez por equipo, se instala un
 * vigilante mínimo, por usuario y sin administrador:
 *   Windows  «Survivelia OS.exe --watch» al iniciar sesión (HKCU\…\Run): eventos WMI de llegada de volúmenes.
 *   macOS    LaunchAgent con StartOnMount y WatchPaths=/Volumes → usb-watch.sh check.
 *   Linux    autoarranque de la sesión → usb-watch.sh watch (comprueba los montajes cada 3 s).
 * Solo reacciona ante las memorias EMPAREJADAS (identificador aleatorio en <memoria>/.survival-os/volume-id):
 * nunca ejecuta una memoria cualquiera. Por defecto pregunta; «abrir directamente» es opcional.
 * Además crea el acceso «Survivelia OS (USB)» (menú Inicio, Aplicaciones o menú de aplicaciones).
 *
 * Variables para pruebas: SURVIVAL_AUTOOPEN_DIR (carpeta del vigilante), SURVIVAL_SHORTCUT_DIR (accesos y
 * registro de autoarranque), SURVIVAL_AUTOOPEN_DRY=1 (no toca el registro, launchctl ni lanza procesos).
 */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { ID_RE } from './usb.mjs'

export const MODES = ['ask', 'open']
export const MESSAGE_KEYS = ['title', 'ask', 'yes', 'no', 'connect']
const RUN_VALUE = 'SurvivalOS-USB'
const AGENT_LABEL = 'org.survival-os.usb'

/** Mensajes por defecto (la interfaz manda los del idioma elegido). {name}: nombre o letra de la unidad. */
export const DEFAULT_MESSAGES = {
  title: 'Survivelia OS',
  ask: 'Se ha conectado la memoria USB de Survivelia OS ({name}). ¿Abrir Survivelia OS?',
  yes: 'Abrir',
  no: 'Ahora no',
  connect: 'Conecta la memoria USB de Survivelia OS y vuelve a intentarlo.',
}

/** Rutas del vigilante y de sus accesos en cada sistema. */
export function autoOpenPaths(platform = process.platform, env = process.env, home = homedir()) {
  const shortcuts = env.SURVIVAL_SHORTCUT_DIR || null
  if (platform === 'win32') {
    // Carpeta y .exe internos con el nombre de antes (Survival OS): así siguen valiendo los ya activados.
    const dir = env.SURVIVAL_AUTOOPEN_DIR || join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Survival OS USB')
    const programs = shortcuts || join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    return {
      dir,
      conf: join(dir, 'autoopen.conf'),
      exe: join(dir, 'Survival OS.exe'),
      shortcut: join(programs, 'Survivelia OS (USB).lnk'),
      legacy: [join(programs, 'Survival OS (USB).lnk')],
    }
  }
  if (platform === 'darwin') {
    const dir = env.SURVIVAL_AUTOOPEN_DIR || join(home, 'Library', 'Application Support', 'Survival OS USB')
    return {
      dir,
      conf: join(dir, 'autoopen.conf'),
      script: join(dir, 'usb-watch.sh'),
      agent: join(shortcuts || join(home, 'Library', 'LaunchAgents'), `${AGENT_LABEL}.plist`),
      app: join(shortcuts || join(home, 'Applications'), 'Survivelia OS (USB).app'),
      legacy: [join(shortcuts || join(home, 'Applications'), 'Survival OS (USB).app')],
    }
  }
  const data = env.XDG_DATA_HOME || join(home, '.local', 'share')
  const config = env.XDG_CONFIG_HOME || join(home, '.config')
  const dir = env.SURVIVAL_AUTOOPEN_DIR || join(data, 'survival-os-usb')
  return {
    dir,
    conf: join(dir, 'autoopen.conf'),
    script: join(dir, 'usb-watch.sh'),
    autostart: join(shortcuts ? join(shortcuts, 'autostart') : join(config, 'autostart'), 'survival-os-usb.desktop'),
    desktop: join(shortcuts ? join(shortcuts, 'applications') : join(data, 'applications'), 'survival-os-usb.desktop'),
  }
}

/** Texto seguro para el fichero de configuración: una línea, sin controles, acotado. */
export function cleanText(v, max = 300) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
}

/** Ruta relativa de la carpeta de Survivelia OS dentro de la memoria («.» si está en la raíz). */
export function cleanRel(v) {
  const s = String(v ?? '.').replace(/\\/g, '/')
  if (!s || s.length > 200 || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..') || /[\u0000-\u001f|]/.test(s)) return null
  return s
}

/**
 * autoopen.conf (UTF-8, una clave por línea; lo leen el .exe de Windows y usb-watch.sh):
 *   mode=ask|open · volume=<id>\t<carpeta> · dismissed=<id> · msg.<clave>=<texto>
 */
export function serializeConf({ mode = 'ask', volumes = [], dismissed = [], messages = {} }) {
  const lines = ['# Survivelia OS: abrir al conectar la memoria USB (ADR 0019). Lo gestiona la aplicación.', `mode=${MODES.includes(mode) ? mode : 'ask'}`]
  for (const v of volumes) if (ID_RE.test(v.id) && cleanRel(v.rel)) lines.push(`volume=${v.id}\t${cleanRel(v.rel)}`)
  for (const id of dismissed) if (ID_RE.test(id)) lines.push(`dismissed=${id}`)
  for (const k of MESSAGE_KEYS) lines.push(`msg.${k}=${cleanText(messages[k] ?? DEFAULT_MESSAGES[k])}`)
  return `${lines.join('\n')}\n`
}

export function parseConf(text) {
  const conf = { mode: 'ask', volumes: [], dismissed: [], messages: { ...DEFAULT_MESSAGES } }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const i = raw.indexOf('=')
    if (raw.startsWith('#') || i < 0) continue
    const k = raw.slice(0, i)
    const v = raw.slice(i + 1)
    if (k === 'mode' && MODES.includes(v)) conf.mode = v
    else if (k === 'volume') {
      const [id, rel = '.'] = v.split('\t')
      if (ID_RE.test(id) && cleanRel(rel) && !conf.volumes.some((x) => x.id === id)) conf.volumes.push({ id, rel: cleanRel(rel) })
    } else if (k === 'dismissed' && ID_RE.test(v) && !conf.dismissed.includes(v)) conf.dismissed.push(v)
    else if (k.startsWith('msg.') && MESSAGE_KEYS.includes(k.slice(4))) conf.messages[k.slice(4)] = cleanText(v)
  }
  return conf
}

function readConf(paths) {
  try {
    return parseConf(readFileSync(paths.conf, 'utf8'))
  } catch {
    return null
  }
}

function writeConf(paths, conf) {
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.conf, serializeConf(conf))
}

/** ¿Se puede activar aquí? Windows necesita «Survivelia OS.exe» (lanzador compilado) en la carpeta portable. */
export function support(root, platform = process.platform) {
  if (platform === 'win32') return launcherExe(root) ? null : 'Esta copia no incluye «Survivelia OS.exe»'
  if (platform === 'darwin' || platform === 'linux') return existsSync(join(root, 'app', 'portable', 'usb-watch.sh')) ? null : 'Esta copia no incluye el vigilante de memorias USB'
  return 'Sistema no soportado'
}

/** Estado para la interfaz. */
export function status({ root, volumeId, platform = process.platform }) {
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths)
  const reason = support(root, platform)
  return {
    supported: !reason,
    reason,
    enabled: !!conf && conf.volumes.length > 0,
    paired: !!conf && !!volumeId && conf.volumes.some((v) => v.id === volumeId),
    mode: conf?.mode ?? 'ask',
    dismissed: !!conf && !!volumeId && conf.dismissed.includes(volumeId),
  }
}

const dry = () => process.env.SURVIVAL_AUTOOPEN_DRY === '1'

function copyIfChanged(src, dst) {
  if (!existsSync(src)) return false
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && readFileSync(dst).equals(readFileSync(src))) return false
  mkdirSync(join(dst, '..'), { recursive: true })
  copyFileSync(src, dst)
  return true
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Argumento de Exec= de un .desktop (especificación freedesktop: comillas dobles y \ " ` $ escapados). */
export const desktopArg = (s) => `"${String(s).replace(/([\\"`$])/g, '\\$1')}"`
const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`

/** Copia los ficheros del vigilante desde la carpeta portable (también al arrancar: así se actualiza solo). */
function installFiles(root, paths, platform) {
  mkdirSync(paths.dir, { recursive: true })
  const icons = join(root, 'app', 'portable')
  if (platform === 'win32') {
    // Si el vigilante está en marcha, Windows no deja sustituir su .exe: se reintenta en el próximo arranque.
    try {
      copyIfChanged(launcherExe(root), paths.exe)
    } catch {
      // en uso
    }
    return
  }
  copyIfChanged(join(icons, 'usb-watch.sh'), paths.script)
  chmodSync(paths.script, 0o755)
  copyIfChanged(join(icons, platform === 'darwin' ? 'icon.icns' : 'icon.png'), join(paths.dir, platform === 'darwin' ? 'icon.icns' : 'icon.png'))
}

/** Lanzador de Windows de la carpeta portable: el de Survivelia OS o, en copias anteriores, el de Survival OS. */
function launcherExe(root) {
  return ['Survivelia OS.exe', 'Survival OS.exe'].map((n) => join(root, n)).find((f) => existsSync(f)) ?? null
}

/** Accesos con el nombre anterior (Survival OS): fuera, para que no haya dos. */
function removeLegacy(paths) {
  for (const f of paths.legacy ?? []) rmSync(f, { recursive: true, force: true })
}

/** Registra el vigilante y el acceso «Survivelia OS (USB)». */
function register(root, paths, platform) {
  removeLegacy(paths)
  if (platform === 'win32') {
    const cmd = `"${paths.exe}" --watch`
    if (!dry()) {
      const r = spawnSync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', cmd, '/f'], { windowsHide: true, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`no se pudo registrar el inicio automático: ${(r.stderr || '').trim().slice(0, 200)}`)
    }
    const q = (v) => v.replace(/'/g, "''")
    const ps = [
      '$s = New-Object -ComObject WScript.Shell',
      `New-Item -ItemType Directory -Force -Path '${q(join(paths.shortcut, '..'))}' | Out-Null`,
      `$l = $s.CreateShortcut('${q(paths.shortcut)}')`,
      `$l.TargetPath = '${q(paths.exe)}'`,
      "$l.Arguments = '--open-usb'",
      `$l.WorkingDirectory = '${q(paths.dir)}'`,
      `$l.IconLocation = '${q(paths.exe)},0'`,
      "$l.Description = 'Survivelia OS (USB)'",
      '$l.Save()',
    ].join('; ')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`no se pudo crear el acceso directo: ${(r.stderr || '').trim().slice(0, 200)}`)
    if (!dry()) spawn(paths.exe, ['--watch'], { detached: true, stdio: 'ignore', windowsHide: true, cwd: paths.dir }).unref()
    return
  }
  if (platform === 'darwin') {
    mkdirSync(join(paths.agent, '..'), { recursive: true })
    writeFileSync(paths.agent, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      `  <key>Label</key><string>${AGENT_LABEL}</string>`,
      `  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(paths.script)}</string><string>check</string></array>`,
      '  <key>StartOnMount</key><true/>',
      '  <key>WatchPaths</key><array><string>/Volumes</string></array>',
      '  <key>ProcessType</key><string>Interactive</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'))
    // «Survivelia OS (USB).app»: abre la memoria emparejada que esté conectada.
    const contents = join(paths.app, 'Contents')
    mkdirSync(join(contents, 'MacOS'), { recursive: true })
    mkdirSync(join(contents, 'Resources'), { recursive: true })
    writeFileSync(join(contents, 'Info.plist'), [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>CFBundleName</key><string>Survivelia OS (USB)</string>',
      '  <key>CFBundleIdentifier</key><string>org.survival-os.usb-opener</string>',
      '  <key>CFBundlePackageType</key><string>APPL</string>',
      '  <key>CFBundleExecutable</key><string>survival-os-usb</string>',
      '  <key>CFBundleIconFile</key><string>icon</string>',
      '  <key>LSMinimumSystemVersion</key><string>11.0</string>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'))
    writeFileSync(join(contents, 'MacOS', 'survival-os-usb'), `#!/bin/sh\nexec /bin/sh ${shQuote(paths.script)} open\n`)
    chmodSync(join(contents, 'MacOS', 'survival-os-usb'), 0o755)
    copyIfChanged(join(root, 'app', 'portable', 'icon.icns'), join(contents, 'Resources', 'icon.icns'))
    if (!dry()) {
      // La memoria conectada ahora no debe preguntar: ya está abierta.
      spawnSync('/bin/sh', [paths.script, 'seed'], { stdio: 'ignore', timeout: 15_000 })
      const uid = String(userInfo().uid)
      spawnSync('launchctl', ['bootout', `gui/${uid}/${AGENT_LABEL}`], { stdio: 'ignore' })
      const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, paths.agent], { encoding: 'utf8' })
      if (r.status !== 0) spawnSync('launchctl', ['load', '-w', paths.agent], { stdio: 'ignore' })
    }
    return
  }
  // Linux
  const entry = (name, arg, extra) => ['[Desktop Entry]', 'Type=Application', `Name=${name}`, `Exec=sh ${desktopArg(paths.script)} ${arg}`, `Icon=${join(paths.dir, 'icon.png')}`, 'Terminal=false', ...extra, ''].join('\n')
  mkdirSync(join(paths.autostart, '..'), { recursive: true })
  writeFileSync(paths.autostart, entry('Survivelia OS (USB)', 'watch', ['NoDisplay=true', 'X-GNOME-Autostart-enabled=true', 'Comment=Abre Survivelia OS al conectar su memoria USB']))
  mkdirSync(join(paths.desktop, '..'), { recursive: true })
  writeFileSync(paths.desktop, entry('Survivelia OS (USB)', 'open', ['Categories=Utility;Education;', 'Comment=Abre Survivelia OS desde su memoria USB']), { mode: 0o755 })
  if (!dry()) {
    spawnSync('/bin/sh', [paths.script, 'seed'], { stdio: 'ignore', timeout: 15_000 })
    spawn('/bin/sh', [paths.script, 'watch'], { detached: true, stdio: 'ignore', cwd: paths.dir }).unref()
  }
}

function unregister(paths, platform) {
  removeLegacy(paths)
  if (platform === 'win32') {
    if (!dry()) spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', RUN_VALUE, '/f'], { windowsHide: true, stdio: 'ignore' })
    rmSync(paths.shortcut, { force: true })
    // El vigilante termina solo al ver que ya no existe autoopen.conf (lo comprueba cada 10 s).
    return
  }
  if (platform === 'darwin') {
    if (!dry()) spawnSync('launchctl', ['bootout', `gui/${userInfo().uid}/${AGENT_LABEL}`], { stdio: 'ignore' })
    rmSync(paths.agent, { force: true })
    rmSync(paths.app, { recursive: true, force: true })
    return
  }
  rmSync(paths.autostart, { force: true })
  rmSync(paths.desktop, { force: true })
}

/**
 * Activa «abrir al conectar» para esta memoria en este equipo.
 *   { root, volumeId, rel, mode, messages, platform }
 */
export function enable({ root, volumeId, rel = '.', mode = 'ask', messages = {}, platform = process.platform }) {
  if (!ID_RE.test(String(volumeId))) throw new Error('memoria sin identificador')
  const reason = support(root, platform)
  if (reason) throw new Error(reason)
  const r = cleanRel(rel)
  if (!r) throw new Error('ruta no válida')
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths) ?? parseConf('')
  conf.volumes = [...conf.volumes.filter((v) => v.id !== volumeId), { id: volumeId, rel: r }]
  conf.dismissed = conf.dismissed.filter((d) => d !== volumeId)
  conf.mode = MODES.includes(mode) ? mode : 'ask'
  conf.messages = { ...conf.messages, ...pickMessages(messages) }
  installFiles(root, paths, platform)
  writeConf(paths, conf)
  register(root, paths, platform)
  return status({ root, volumeId, platform })
}

/** Desactiva esta memoria; sin memorias emparejadas se quita el vigilante y su acceso. */
export function disable({ root, volumeId, platform = process.platform }) {
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths)
  if (conf) {
    conf.volumes = conf.volumes.filter((v) => v.id !== volumeId)
    if (conf.volumes.length) writeConf(paths, conf)
    else {
      unregister(paths, platform)
      // Se conservan los «no, gracias» para no volver a preguntar en este equipo.
      if (conf.dismissed.length) writeConf(paths, { ...conf, volumes: [] })
      else rmSync(paths.conf, { force: true })
      if (platform !== 'win32') rmSync(join(paths.dir, 'seen'), { force: true })
    }
  }
  return status({ root, volumeId, platform })
}

/** «No, gracias»: no volver a ofrecerlo en este equipo para esta memoria. */
export function dismiss({ root, volumeId, platform = process.platform }) {
  if (!ID_RE.test(String(volumeId))) throw new Error('memoria sin identificador')
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths) ?? parseConf('')
  if (!conf.dismissed.includes(volumeId)) conf.dismissed.push(volumeId)
  writeConf(paths, conf)
  return status({ root, volumeId, platform })
}

/** Cambia el modo o actualiza los textos (idioma de la interfaz) sin tocar el registro. */
export function update({ root, volumeId, mode, messages = {}, platform = process.platform }) {
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths)
  if (!conf) return status({ root, volumeId, platform })
  if (mode && MODES.includes(mode)) conf.mode = mode
  conf.messages = { ...conf.messages, ...pickMessages(messages) }
  const next = serializeConf(conf)
  if (readFileSync(paths.conf, 'utf8') !== next) writeFileSync(paths.conf, next)
  return status({ root, volumeId, platform })
}

/** Al arrancar desde una memoria emparejada: actualiza el vigilante si esta versión trae uno más nuevo. */
export function refresh({ root, volumeId, platform = process.platform }) {
  const paths = autoOpenPaths(platform)
  const conf = readConf(paths)
  if (!conf || !conf.volumes.some((v) => v.id === volumeId) || support(root, platform)) return false
  installFiles(root, paths, platform)
  return true
}

function pickMessages(messages) {
  const out = {}
  for (const k of MESSAGE_KEYS) if (typeof messages?.[k] === 'string' && cleanText(messages[k])) out[k] = cleanText(messages[k])
  return out
}
