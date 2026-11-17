/**
 * Survivelia OS portable (ADR 0014): funciones puras compartidas por el lanzador, el instalador y
 * el empaquetado. Sin efectos secundarios: se prueban en apps/frontend/test/portable.test.ts.
 */
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'

/** Plataformas empaquetadas (carpeta runtime/<clave>/). */
export const TARGETS = ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']
/** App Android (ADR 0020): mismo lanzador, binarios dentro del APK. */
export const ANDROID_TARGETS = ['android-arm64', 'android-x64']

/** Clave de runtime para este sistema, o null si no hay runtime para él. */
export function platformKey(platform, arch) {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux', android: 'android' }[platform]
  if (!os || !['x64', 'arm64'].includes(arch)) return null
  const key = `${os}-${arch}`
  return TARGETS.includes(key) || ANDROID_TARGETS.includes(key) ? key : null
}

/** Ruta del ejecutable de Node dentro de la carpeta portable. */
export function nodePath(root, key) {
  return join(root, 'runtime', key, key.startsWith('win') ? 'node.exe' : 'node')
}

/**
 * Puertos preferidos (fijos para que el origen http://127.0.0.1:<web> no cambie entre arranques:
 * el navegador guarda los ajustes por origen). Lejos de 3000/8080 para no chocar con otras apps.
 */
export const PREFERRED_PORTS = { web: 47800, device: 47801, library: 47802, kiwix: 47803, navigation: 47804, llm: 47805, brouter: 47806, mesh: 47807, gpsd: 47808, games: 47810, share: 47880 }

/** Navegadores con modo aplicación (--app), por orden de preferencia. */
export function browserCandidates(platform, env = {}, home = '') {
  if (platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files'
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    const paths = []
    for (const base of [pf, pf86, local]) {
      paths.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      paths.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      paths.push(join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))
      paths.push(join(base, 'Chromium', 'Application', 'chrome.exe'))
    }
    return paths
  }
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Chromium.app/Contents/MacOS/Chromium',
    ]
    return [...apps.map((a) => `/Applications/${a}`), ...apps.map((a) => join(home, 'Applications', a))]
  }
  // Linux: nombres en el PATH (se resuelven con `command -v`) y rutas habituales.
  return ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', '/snap/bin/chromium']
}

/** Argumentos del navegador: ventana propia de aplicación con perfil aislado dentro de data/. */
export function browserArgs(url, profileDir) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--disable-sync',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1280,800',
  ]
}

/** Comando para abrir una URL o carpeta con la aplicación por defecto del sistema. */
export function openCommand(platform, target) {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [target] }
  if (platform === 'darwin') return { cmd: 'open', args: [target] }
  return { cmd: 'xdg-open', args: [target] }
}

/**
 * Carpeta de instalación por usuario (sin permisos de administrador). Si ya hay una instalación con el nombre
 * anterior (Survival OS), se sigue usando esa: actualizar no debe dejar dos copias. `exists` se inyecta en pruebas.
 */
export function defaultInstallDir(platform, env = {}, home = '', exists = () => false) {
  const pick = (base) => (exists(join(base, 'Survival OS')) ? join(base, 'Survival OS') : join(base, 'Survivelia OS'))
  if (platform === 'win32') return pick(join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs'))
  if (platform === 'darwin') return pick(join(home, 'Applications'))
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'survival-os')
}

/** Ficheros de data/ que NO se copian al instalar (propios de cada ejecución o de cada equipo). */
export const DATA_EXCLUDE = new Set(['logs', 'browser', 'run.json', 'ports.json', 'admin', '.cache'])

/**
 * Variables de entorno de cada servicio. Todo vive en <data>; los sockets y FIFO del kiosco
 * apuntan a rutas inexistentes a propósito: esas funciones no existen fuera de la Pi.
 */
/** Canal local de la bóveda: named pipe en Windows; socket Unix (ruta corta: límite ~104 bytes en macOS). */
export function vaultSocket(platform, data, webPort, privateDir = null) {
  if (platform === 'win32') return String.raw`\\.\pipe\survival-os-vault-` + webPort
  // Android: los datos pueden estar en almacenamiento compartido (sin sockets Unix y visible para otras apps con
  // permiso): el socket va en la carpeta privada de la app.
  if (platform === 'android' && privateDir) return join(privateDir, 'vault.sock')
  const p = join(data, 'vault.sock')
  return p.length < 100 ? p : join(tmpdir(), `survival-os-vault-${webPort}.sock`)
}

export function serviceEnv({ root, data, ports, platform, arch, privateDir = null }) {
  const app = join(root, 'app')
  const vault = vaultSocket(platform, data, ports.web, privateDir)
  // Android: el protocolo gpsd (ubicación) va por socket Unix privado, no por TCP en loopback (ADR 0020).
  const gpsdSocket = platform === 'android' && privateDir ? { GPSD_SOCKET: join(privateDir, 'gpsd.sock') } : {}
  const url = (p) => `http://127.0.0.1:${p}`
  const web = url(ports.web)
  const common = { NODE_ENV: 'production', LOG_LEVEL: 'info', SURVIVAL_PORTABLE: '1' }
  return {
    device: {
      ...common,
      DEVICE_API_HOST: '127.0.0.1',
      DEVICE_API_PORT: String(ports.device),
      // Espacio libre: el de la unidad donde está la carpeta (USB o disco).
      DEVICE_API_MOUNTS: platform === 'win32' ? parse(data).root : data,
    },
    library: {
      ...common,
      LIBRARY_HOST: '127.0.0.1',
      LIBRARY_PORT: String(ports.library),
      LIBRARY_DATA_DIR: join(data, 'library'),
      LIBRARY_PROTOCOLS_DIR: join(app, 'content', 'protocols'),
      // pdftotext (Xpdf) descargado con los manuales para este sistema (componente opcional).
      PDFTOTEXT: join(root, 'runtime', platformKey(platform, arch ?? process.arch) ?? 'unknown', 'xpdf', platform === 'win32' ? 'pdftotext.exe' : 'pdftotext'),
      KIWIX_URL: `${url(ports.kiwix)}/kiwix`,
      LLM_URL: url(ports.llm),
    },
    // Bóveda cifrada (ADR 0016): Argon2id + AES-256-GCM en node:crypto, misma API que la de la Pi.
    vault: {
      ...common,
      VAULT_DIR: join(data, 'vault'),
      VAULT_SOCKET: vault,
    },
    // Nodo Meshtastic y receptor GNSS por USB (ADR 0016): misma API que survival-mesh + protocolo gpsd.
    hub: {
      ...common,
      SERIAL_HUB_HOST: '127.0.0.1',
      MESH_PORT: String(ports.mesh),
      GPSD_PORT: String(ports.gpsd),
      ...gpsdSocket,
      SERIAL_HUB_DATA: join(data, 'serial-hub'),
      UV_THREADPOOL_SIZE: '8',
    },
    navigation: {
      ...common,
      GPSD_HOST: '127.0.0.1',
      GPSD_PORT: String(ports.gpsd),
      ...gpsdSocket,
      MESH_URL: url(ports.mesh),
      NAV_HOST: '127.0.0.1',
      NAV_PORT: String(ports.navigation),
      NAV_DATA_DIR: join(data, 'navigation'),
    },
    games: {
      ...common,
      GAMES_HOST: '127.0.0.1',
      GAMES_PORT: String(ports.games),
      GAMES_DIR: join(data, 'games', 'current'),
      GAMES_FRAME_ANCESTORS: `${web} http://localhost:${ports.web}`,
    },
    web: {
      ...common,
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(ports.web),
      NUXT_DEVICE_API_URL: url(ports.device),
      NUXT_LIBRARY_URL: url(ports.library),
      NUXT_KIWIX_URL: url(ports.kiwix),
      NUXT_NAVIGATION_URL: url(ports.navigation),
      // Pasarela ESP32 dentro de serial-hub (/esp32/*): misma API que services/esp32-gateway.
      NUXT_ESP32_URL: `${url(ports.mesh)}/esp32`,
      NUXT_MESH_URL: url(ports.mesh),
      NUXT_GAMES_URL: `${url(ports.games)}/`,
      NUXT_GAMES_DIR: join(data, 'games'),
      NUXT_VAULT_SOCKET: vault,
      NUXT_PUBLIC_PORTABLE: 'true',
      SURVIVAL_MAPS_DIR: join(data, 'maps'),
      SURVIVAL_ROUTING_DIR: join(data, 'routing'),
      SURVIVAL_ADMIN_DIR: join(data, 'admin'),
      SURVIVAL_KIOSK_FIFO: join(data, 'no-kiosk.fifo'),
      SURVIVAL_BROUTER_URL: url(ports.brouter),
      SURVIVAL_PORTABLE_ROOT: root,
      SURVIVAL_PORTABLE_DATA: data,
    },
  }
}

/**
 * Servicios opcionales (ADR 0015): se arrancan solos en cuanto existen su componente (descargado
 * para este sistema en runtime/<so-arq>/) y sus datos. `sig` cambia si hay que reiniciarlos.
 * fs: { exists(p), read(p) } inyectado para poder probarlo.
 */
export function optionalServices({ root, data, key, ports, platform, threads }, fs) {
  const rt = join(root, 'runtime', key)
  const exe = (p) => (platform === 'win32' ? `${p}.exe` : p)
  const out = {}
  const lib = join(data, 'library', 'zim', 'library.xml')
  const kiwix = join(rt, 'kiwix-tools', exe('kiwix-serve'))
  if (fs.exists(kiwix) && fs.exists(lib)) {
    out.kiwix = { cmd: kiwix, args: ['--address=127.0.0.1', `--port=${ports.kiwix}`, '--urlRootLocation=/kiwix', '--monitorLibrary', '--library', lib], sig: 'library', cwd: join(rt, 'kiwix-tools') }
  }
  const active = fs.exists(join(data, 'llm', 'active')) ? fs.read(join(data, 'llm', 'active')).trim() : ''
  const model = active ? join(data, 'llm', 'models', active) : ''
  const llama = join(rt, 'llama', exe('llama-server'))
  if (active && fs.exists(model) && fs.exists(llama)) {
    out.llm = {
      cmd: llama,
      args: ['--host', '127.0.0.1', '--port', String(ports.llm), '-m', model, '-c', '4096', '-t', String(threads), '--no-webui', '--parallel', '1'],
      sig: active,
      cwd: join(rt, 'llama'),
    }
  }
  // Juegos offline (ADR 0012): en cuanto hay una copia descargada.
  if (fs.exists(join(data, 'games', 'current', 'index.html'))) {
    out.games = { cmd: process.execPath, args: [join(root, 'app', 'scripts', 'games-server.mjs')], sig: 'games', cwd: join(data, 'games'), env: 'games' }
  }
  const java = join(rt, 'jre', 'bin', exe('java'))
  const jar = join(rt, 'brouter', 'brouter-1.7.10-all.jar')
  const seg = join(data, 'routing', 'segments4')
  // Android: BRouter va compilado dentro del APK y la app lo ejecuta en un proceso aparte (no hay JRE); del
  // componente descargado solo se usan los perfiles.
  if (platform === 'android') {
    if (fs.exists(join(rt, 'brouter', 'profiles2')) && fs.exists(seg) && fs.hasRd5(seg)) {
      out.brouter = {
        bridge: 'routing',
        params: { segments: seg, profiles: join(rt, 'brouter', 'profiles2'), customProfiles: join(data, 'routing', 'customprofiles'), port: ports.brouter, maxRunningTime: 60 },
        sig: 'routing',
      }
    }
    return out
  }
  if (fs.exists(java) && fs.exists(jar) && fs.exists(seg) && fs.hasRd5(seg)) {
    out.brouter = {
      cmd: java,
      args: ['-Xmx256M', '-Xms64M', '-Xmn8M', '-DmaxRunningTime=60', '-DuseRFCMimeType=false', '-DusePOSTRequests=false', '-cp', jar, 'btools.server.RouteServer', seg, join(rt, 'brouter', 'profiles2'), join(data, 'routing', 'customprofiles'), String(ports.brouter), '1', '127.0.0.1'],
      sig: 'routing',
      cwd: join(data, 'routing'),
    }
  }
  return out
}

/**
 * IPv4 privada de la red local para «Compartir en la red local» (10/8, 172.16/12, 192.168/16).
 * Se prefiere Wi-Fi/Ethernet frente a adaptadores virtuales. null si no hay red local.
 */
export function lanAddress(ifaces) {
  const priv = (a) => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
  const virtual = /vEthernet|VirtualBox|VMware|docker|veth|br-|Hyper-V|WSL|tailscale|ZeroTier/i
  const cands = []
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && priv(i.address)) cands.push({ name, address: i.address, virtual: virtual.test(name) })
    }
  }
  cands.sort((a, b) => Number(a.virtual) - Number(b.virtual))
  return cands[0]?.address ?? null
}

/**
 * Componentes que en Android vienen dentro del APK (ADR 0020): Android solo deja ejecutar lo instalado desde el APK
 * (lib<nombre>.so en la carpeta de bibliotecas nativas). Se publican en runtime/<clave>/<componente>/ como enlaces
 * con el nombre de siempre y la marca .version del catálogo, así el motor de descargas no intenta descargarlos.
 * `versions`: versiones con las que se compiló el APK (app/android-natives.json).
 */
export const ANDROID_BUNDLED = {
  'kiwix-tools': { 'kiwix-serve': 'libkiwix-serve.so', 'kiwix-manage': 'libkiwix-manage.so' },
  llama: { 'llama-server': 'libllama-server.so' },
  pmtiles: { pmtiles: 'libpmtiles.so' },
  xpdf: { pdftotext: 'libpdftotext.so' },
}

export function androidComponentLinks({ root, key, libDir, versions }, exists) {
  const out = []
  for (const [comp, bins] of Object.entries(ANDROID_BUNDLED)) {
    const version = versions?.[comp]
    if (!version) continue
    const links = Object.entries(bins).map(([name, lib]) => ({ name, target: join(libDir, lib) }))
    if (!links.every((l) => exists(l.target))) continue
    out.push({ comp, dir: join(root, 'runtime', key, comp), version, links })
  }
  return out
}

/** Carpetas de datos que se crean al arrancar (y que la interfaz permite abrir). */
export const DATA_DIRS = ['maps', 'library/docs', 'library/zim', 'navigation', 'games', 'logs', 'llm/models', 'routing/segments4', 'routing/customprofiles']

/** Rota un log si pasa de `max` bytes (devuelve true si hay que rotar). */
export function shouldRotate(sizeBytes, max = 5 * 1024 * 1024) {
  return sizeBytes > max
}

/**
 * Por qué se ha cerrado llama-server, a partir de su código, su señal y el final de su salida.
 * reason: 'library' (falta una biblioteca del sistema), 'memory' (sin memoria: el sistema lo cierra con SIGKILL),
 * 'model' (el modelo no se puede cargar) u 'other'. detail: la última línea útil, para mostrarla tal cual.
 */
export function llmFailure({ code = null, signal = null, tail = '' } = {}) {
  const lines = String(tail)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[launcher\]/.test(l))
  const pick = (re) => [...lines].reverse().find((l) => re.test(l))
  const lib = pick(/error while loading shared libraries|cannot open shared object|GLIBC_?[\d.]+'? not found|GLIBCXX_[\d.]+'? not found|Library not loaded|dlopen failed/i)
  if (lib) return { reason: 'library', detail: lib.slice(0, 240) }
  const mem = pick(/out of memory|failed to allocate|bad_alloc|cannot allocate memory|unable to allocate/i)
  if (mem || signal === 'SIGKILL') return { reason: 'memory', detail: (mem ?? `signal=${signal}`).slice(0, 240) }
  const model = pick(/failed to load model|error loading model|unable to load model|invalid magic|gguf/i)
  if (model) return { reason: 'model', detail: model.slice(0, 240) }
  const last = pick(/error|fail|abort/i) ?? lines.at(-1)
  return { reason: 'other', detail: (last ?? `code=${code}, signal=${signal}`).slice(0, 240) }
}
