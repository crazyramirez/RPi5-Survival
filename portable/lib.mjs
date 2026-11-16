/**
 * Survival OS portable (ADR 0014): funciones puras compartidas por el lanzador, el instalador y
 * el empaquetado. Sin efectos secundarios: se prueban en apps/frontend/test/portable.test.ts.
 */
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'

/** Plataformas empaquetadas (carpeta runtime/<clave>/). */
export const TARGETS = ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']

/** Clave de runtime para este sistema, o null si no hay runtime para él. */
export function platformKey(platform, arch) {
  const os = { win32: 'win', darwin: 'darwin', linux: 'linux' }[platform]
  if (!os || !['x64', 'arm64'].includes(arch)) return null
  const key = `${os}-${arch}`
  return TARGETS.includes(key) ? key : null
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

/** Carpeta de instalación por usuario (sin permisos de administrador). */
export function defaultInstallDir(platform, env = {}, home = '') {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'Survival OS')
  if (platform === 'darwin') return join(home, 'Applications', 'Survival OS')
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'survival-os')
}

/** Ficheros de data/ que NO se copian al instalar (propios de cada ejecución o de cada equipo). */
export const DATA_EXCLUDE = new Set(['logs', 'browser', 'run.json', 'ports.json', 'admin', '.cache'])

/**
 * Variables de entorno de cada servicio. Todo vive en <data>; los sockets y FIFO del kiosco
 * apuntan a rutas inexistentes a propósito: esas funciones no existen fuera de la Pi.
 */
/** Canal local de la bóveda: named pipe en Windows; socket Unix (ruta corta: límite ~104 bytes en macOS). */
export function vaultSocket(platform, data, webPort) {
  if (platform === 'win32') return String.raw`\\.\pipe\survival-os-vault-` + webPort
  const p = join(data, 'vault.sock')
  return p.length < 100 ? p : join(tmpdir(), `survival-os-vault-${webPort}.sock`)
}

export function serviceEnv({ root, data, ports, platform, arch }) {
  const app = join(root, 'app')
  const vault = vaultSocket(platform, data, ports.web)
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
      SERIAL_HUB_DATA: join(data, 'serial-hub'),
      UV_THREADPOOL_SIZE: '8',
    },
    navigation: {
      ...common,
      GPSD_HOST: '127.0.0.1',
      GPSD_PORT: String(ports.gpsd),
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
      NUXT_ESP32_URL: 'http://127.0.0.1:1',
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

/** Carpetas de datos que se crean al arrancar (y que la interfaz permite abrir). */
export const DATA_DIRS = ['maps', 'library/docs', 'library/zim', 'navigation', 'games', 'logs', 'llm/models', 'routing/segments4', 'routing/customprofiles']

/** Rota un log si pasa de `max` bytes (devuelve true si hay que rotar). */
export function shouldRotate(sizeBytes, max = 5 * 1024 * 1024) {
  return sizeBytes > max
}
