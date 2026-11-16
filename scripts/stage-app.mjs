/**
 * Carpeta `app/` de Survivelia OS fuera de la Pi: web (Nuxt), servicios Node, contenido y lanzador. La comparten la
 * versión portable (release-portable.mjs, ADR 0014) y la app Android (android/scripts/build.mjs, ADR 0020), así
 * las dos llevan exactamente lo mismo. Más el zip con permisos Unix que usan ambas.
 */
import { closeSync, cpSync, existsSync, openSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { makeIcns, makeIco, makeIconPng } from '../portable/icon.mjs'

/** Ficheros de scripts/ que necesita la carpeta app/ (motor de descargas, tareas, pasarela, juegos). */
export const APP_SCRIPTS = ['games-server.mjs', 'content-engine.mjs', 'country-maps.mjs', 'public-gateway.mjs', 'games-sync.mjs', 'portable-admin.mjs', 'zip.mjs', 'update-engine.mjs', 'update-lib.mjs']
/** Ficheros de portable/ (lanzador y utilidades; android-guard.mjs solo actúa en Android). */
export const APP_PORTABLE = ['launcher.mjs', 'lib.mjs', 'install.mjs', 'apply-update.mjs', 'usb.mjs', 'autoopen.mjs', 'icon.mjs', 'usb-watch.sh', 'data-LEEME.txt', 'win/survival-os.vbs', 'android-guard.mjs']
export const APP_SERVICES = ['device-api', 'library', 'navigation', 'serial-hub', 'vault']

/** Comprueba que hay compilación (`npm run build`). Devuelve la lista de lo que falta. */
export function missingBuild(root) {
  return ['apps/frontend/.output/server/index.mjs', ...APP_SERVICES.map((s) => `services/${s}/dist/server.js`)].filter((f) => !existsSync(join(root, f)))
}

/** Monta `app` (carpeta vacía o inexistente) desde el repositorio `root`. */
export function stageApp(root, app, version) {
  const copy = (from, to) => cpSync(join(root, from), join(app, to ?? from), { recursive: true })
  copy('apps/frontend/.output', 'web')
  for (const svc of APP_SERVICES) {
    copy(`services/${svc}/dist`)
    copy(`services/${svc}/package.json`)
  }
  copy('content')
  for (const f of APP_SCRIPTS) copy(`scripts/${f}`)
  for (const f of APP_PORTABLE) copy(`portable/${f}`)
  writeFileSync(join(app, 'VERSION'), `${version}\n`)
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'survival-os-portable', version, private: true, type: 'module' }, null, 2))
  // Iconos (ADR 0019): ventana, accesos directos, unidad USB.
  writeFileSync(join(app, 'portable', 'icon.png'), makeIconPng(256))
  writeFileSync(join(app, 'portable', 'icon.ico'), makeIco())
  writeFileSync(join(app, 'portable', 'icon.icns'), makeIcns())
  // El servidor web empaquetado debe tener sus dependencias trazadas.
  const serverDeps = Object.keys(JSON.parse(readFileSync(join(app, 'web', 'server', 'package.json'), 'utf8')).dependencies ?? {})
  const missing = serverDeps.filter((d) => !existsSync(join(app, 'web', 'server', 'node_modules', d, 'package.json')))
  if (missing.length) throw new Error(`.output incompleto, faltan: ${missing.join(', ')}`)
  // Ficheros de código llenos de ceros: compilación dañada (p. ej. dos `npm run build` a la vez). Pasó una vez y el
  // APK no arrancaba; mejor fallar aquí que publicar.
  const zeroed = zeroFilledFiles(app)
  if (zeroed.length) throw new Error(`compilación dañada: ${zeroed.length} fichero(s) llenos de ceros (${zeroed.slice(0, 3).join(', ')}…). Borra apps/frontend/.output y ejecuta "npm run build" otra vez.`)
}

/** Ficheros de código (.js, .mjs, .cjs, .json) no vacíos cuyo contenido son solo bytes 0. */
export function zeroFilledFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && /\.(m?js|cjs|json)$/.test(e.name)) {
        const b = readFileSync(p)
        if (b.length > 0 && b.every((x) => x === 0)) out.push(relative(dir, p))
      }
    }
  }
  walk(dir)
  return out
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * Escribe `dir` en un zip (prefijo `prefix/`, o sin prefijo si es ''). `isExec(rel)` decide el modo 0755.
 * Sin Zip64: < 4 GiB y < 65 535 entradas. Devuelve el número de ficheros.
 */
export function writeZip(dir, zipFile, prefix, isExec = () => false) {
  const fd = openSync(zipFile, 'w')
  const central = []
  let offset = 0
  let files = 0
  const { time, date } = dosTime(new Date())
  const put = (buf) => {
    writeSync(fd, buf)
    offset += buf.length
  }
  const name = (rel) => (prefix ? `${prefix}/${rel}` : rel)
  const add = (entry, data, mode) => {
    const nameBuf = Buffer.from(entry, 'utf8')
    const isDir = entry.endsWith('/')
    const crc = isDir ? 0 : crc32(data) >>> 0
    const comp = isDir ? Buffer.alloc(0) : deflateRawSync(data, { level: 6 })
    const store = !isDir && comp.length >= data.length
    const body = isDir ? comp : store ? data : comp
    const method = isDir || store ? 0 : 8
    if (offset + 30 + nameBuf.length + body.length > 0xffffffff) throw new Error('El zip supera 4 GiB (sin Zip64)')
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
        add(`${name(rel)}/`, null, 0o40755)
        walk(p)
      } else if (e.isFile()) {
        add(name(rel), readFileSync(p), isExec(rel) ? 0o100755 : 0o100644)
        files++
      }
    }
  }
  if (prefix) add(`${prefix}/`, null, 0o40755)
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
  if (central.length > 0xffff) throw new Error('Demasiados ficheros para un zip sin Zip64')
  return files
}
