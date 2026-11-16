/**
 * Memoria USB de Survivelia OS (ADR 0019): unidades externas, identidad del volumen, integración visual en
 * Windows/macOS/Linux (icono y nombre de la unidad, carpetas internas ocultas, «Ejecutar» en GNOME),
 * expulsión segura y «Preparar una memoria USB». Node sin dependencias.
 *
 * Lo usan el lanzador (al arrancar: integración del volumen; «Expulsar»), portable-admin.mjs (tarea
 * usb-prepare) y el servidor web (estado). Las funciones puras se prueban en apps/frontend/test/portable.test.ts.
 */
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  closeSync, copyFileSync, createReadStream, createWriteStream, existsSync, ftruncateSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeSync,
} from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, delimiter, dirname, join, parse, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { DATA_EXCLUDE, TARGETS } from './lib.mjs'

/** Carpeta oculta en la raíz de la memoria con su identificador (emparejar «abrir al conectar»). */
export const MARKER_DIR = '.survival-os'
export const ID_RE = /^[0-9a-f]{32}$/
/** Nombre de la unidad: como mucho 11 caracteres (límite de FAT32). */
export const VOLUME_LABEL = 'SURVIVELIA'
/** Límite de tamaño de fichero en FAT32. */
export const FAT32_MAX = 4 * 1024 ** 3 - 1

/** Lanzadores y ficheros de la raíz de la carpeta portable (lo que se copia además de app/ y runtime/). */
export const ROOT_FILES = ['Survivelia OS.exe', 'Abrir Survivelia OS.cmd', 'abrir-survival-os.sh', 'Survivelia OS.app', 'LEEME.txt']
/** Lanzadores con el nombre anterior (Survival OS): se quitan al preparar una memoria que ya los tenía. */
export const LEGACY_ROOT_FILES = ['Survival OS.exe', 'Abrir Survival OS.cmd', 'Survival OS.app']

/** Ficheros de integración en la raíz del volumen. */
export const VOLUME_FILES = ['autorun.inf', 'autorun.sh', '.VolumeIcon.icns', '.VolumeIcon.png', '.xdg-volume-info', '.hidden']

// ------------------------------------------------------------------ sistemas de ficheros y unidades

/** Normaliza el tipo de sistema de ficheros: fat32 | exfat | ntfs | apfs | hfs | ext | otro (minúsculas) | null. */
export function fsKind(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (['fat32', 'fat', 'vfat', 'msdos', 'fat16', 'fat12'].includes(v)) return 'fat32'
  if (v === 'exfat') return 'exfat'
  if (['ntfs', 'ntfs3', 'fuseblk', 'ntfs-3g'].includes(v)) return 'ntfs'
  if (v === 'apfs') return 'apfs'
  if (v === 'hfs' || v === 'hfsplus') return 'hfs'
  if (/^ext[234]$/.test(v)) return 'ext'
  return v.replace(/[^a-z0-9_-]/g, '').slice(0, 20) || null
}

function safeList(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** Puntos de montaje de macOS con su tipo («/dev/disk4s1 on /Volumes/USB (msdos, local, …)»). */
export function parseMacMount(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const m = / on (.+) \(([^,)]+)/.exec(line)
    if (m) out.set(m[1], m[2])
  }
  return out
}

/** /proc/mounts → Map(punto de montaje → { fs, dev }). */
export function parseProcMounts(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const [dev, mnt, fs] = line.split(' ')
    if (mnt) out.set(mnt.replace(/\\040/g, ' '), { fs, dev })
  }
  return out
}

/**
 * volumes.json de la app Android → [{ uuid, path, label, fs }] (solo /storage/<uuid> montados y extraíbles).
 * Lo escribe la app; se valida igualmente (otra versión de la app, fichero a medias).
 */
export function parseAndroidVolumes(text) {
  let list = []
  try {
    const parsed = JSON.parse(text || '[]')
    list = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  return list
    .filter((v) => v && typeof v === 'object' && v.removable === true && v.state === 'mounted' && /^[0-9A-Fa-f-]{4,36}$/.test(String(v.uuid ?? '')) && v.path === `/storage/${v.uuid}`)
    .map((v) => ({ uuid: String(v.uuid), path: v.path, label: typeof v.label === 'string' ? v.label.replace(/[/\\\0]/g, '_').slice(0, 80) : String(v.uuid), fs: typeof v.fs === 'string' ? v.fs : null }))
}

/**
 * Memorias USB y discos externos montados, con un identificador estable «grupo/etiqueta» (mismo formato que
 * la Pi, validado por el servidor web). Nunca se acepta una ruta del cliente: el id se resuelve contra esta lista.
 *   [{ media, path, label, fs, freeBytes, totalBytes }]
 */
export function mountedMedia(platform = process.platform) {
  const probe = mediaProbe(platform)
  let raw = ''
  if (probe) {
    try {
      raw = execFileSync(probe.cmd, probe.args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    } catch {
      if (platform === 'win32') throw new Error('no se pudieron listar las unidades de Windows')
    }
  }
  return collectMedia(platform, raw)
}

/** Igual que mountedMedia, sin bloquear (para el servidor web). */
export function mountedMediaAsync(platform = process.platform) {
  const probe = mediaProbe(platform)
  if (!probe) return Promise.resolve(collectMedia(platform, ''))
  return new Promise((ok, ko) => {
    execFile(probe.cmd, probe.args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 }, (err, stdout) => {
      if (err && platform === 'win32') return ko(new Error('no se pudieron listar las unidades de Windows'))
      try {
        ok(collectMedia(platform, err ? '' : String(stdout)))
      } catch (e) {
        ko(e)
      }
    })
  })
}

/** Orden que describe las unidades: PowerShell en Windows, `mount` en macOS; en Linux basta /proc/mounts. */
function mediaProbe(platform) {
  if (platform === 'win32') {
    // Solo medios externos: unidades extraíbles y discos conectados por USB (no los discos internos).
    // Get-Disk no necesita permisos de administrador.
    const ps = [
      '$usb = @{}',
      "try { Get-Disk -ErrorAction Stop | Where-Object BusType -eq 'USB' | ForEach-Object { Get-Partition -DiskNumber $_.Number -ErrorAction SilentlyContinue | Where-Object DriveLetter | ForEach-Object { $usb[[string]$_.DriveLetter] = $true } } } catch {}",
      "@(Get-Volume | Where-Object { $_.DriveLetter -and ($_.DriveType -eq 'Removable' -or $usb.ContainsKey([string]$_.DriveLetter)) } | Select-Object @{n='L';e={[string]$_.DriveLetter}},@{n='Label';e={$_.FileSystemLabel}},@{n='T';e={[string]$_.DriveType}},@{n='F';e={[string]$_.FileSystem}}) | ConvertTo-Json -Compress",
    ].join('; ')
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', ps] }
  }
  if (platform === 'darwin') return { cmd: 'mount', args: [] }
  return null
}

function collectMedia(platform, raw) {
  const out = []
  const add = (id, path, label, fs) => {
    try {
      const st = statfsSync(path)
      out.push({ media: id.slice(0, 190), path, label, fs: fsKind(fs), freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize })
    } catch {
      // medio retirado o sin permiso
    }
  }
  if (platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase()
    let disks = []
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : []
      disks = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      throw new Error('no se pudieron listar las unidades de Windows')
    }
    for (const d of disks) {
      const letter = `${String(d.L ?? '').toUpperCase()}:`
      if (!/^[A-Z]:$/.test(letter) || letter === sys) continue
      const label = String(d.Label || (d.T === 'Removable' ? 'USB' : 'Disco USB')).replace(/[/\\\0]/g, '_')
      add(`${letter[0]}/${label}`, `${letter}\\`, String(d.Label || ''), d.F)
    }
  } else if (platform === 'android') {
    // App Android (ADR 0020): la app nativa publica los volúmenes extraíbles (microSD y memorias USB OTG) de
    // StorageManager en su carpeta privada; las rutas /storage/<uuid> se leen con el permiso «todos los archivos».
    for (const v of parseAndroidVolumes(readFileSafe(join(process.env.SURVIVAL_ANDROID_PRIVATE ?? '', 'volumes.json')))) {
      add(`android/${v.uuid}`, v.path, v.label, v.fs)
    }
  } else if (platform === 'darwin') {
    const types = parseMacMount(raw)
    for (const name of safeList('/Volumes')) {
      const p = join('/Volumes', name)
      try {
        if (lstatSync(p).isSymbolicLink()) continue // «Macintosh HD» → /
      } catch {
        continue
      }
      add(`Volumes/${name}`, p, name, types.get(p))
    }
  } else {
    const mounts = parseProcMounts(readFileSafe('/proc/mounts'))
    const user = userInfo().username
    for (const base of [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt']) {
      for (const name of safeList(base)) {
        const p = join(base, name)
        if (mounts.has(p)) add(`${base === '/mnt' ? 'mnt' : base === '/media' ? 'media' : user}/${name}`, p, name, mounts.get(p).fs)
      }
    }
  }
  // Carpetas tratadas como medios (pruebas automáticas y uso avanzado).
  for (const dir of (process.env.SURVIVAL_EXTRA_MEDIA ?? '').split(delimiter).filter(Boolean)) add(`extra/${basename(dir)}`, dir, basename(dir), process.env.SURVIVAL_EXTRA_MEDIA_FS ?? null)
  // El mismo medio puede salir dos veces (/media/<usuario> y /run/media/<usuario>).
  return out.filter((m, i) => out.findIndex((o) => o.media === m.media) === i)
}

/** ¿`child` está dentro de `parent` (o es el mismo)? En Windows sin distinguir mayúsculas. */
export function isInside(child, parent, platform = process.platform) {
  const norm = (p) => {
    const r = resolve(p)
    return platform === 'win32' ? r.toLowerCase() : r
  }
  const c = norm(child)
  const p = norm(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/** Medio que contiene `root` (el más específico), o null si se ejecuta desde un disco interno. */
export function findVolume(root, media, platform = process.platform) {
  const hits = media.filter((m) => isInside(root, m.path, platform))
  hits.sort((a, b) => b.path.length - a.path.length)
  return hits[0] ?? null
}

/** Identificador de la memoria (32 hex) o null. */
export function readVolumeId(mount) {
  const id = readFileSafe(join(mount, MARKER_DIR, 'volume-id')).trim().slice(0, 64)
  return ID_RE.test(id) ? id : null
}

/** Crea el identificador si no existe (solo al preparar la memoria o al activar «abrir al conectar»). */
export function ensureVolumeId(mount) {
  const cur = readVolumeId(mount)
  if (cur) return cur
  const id = randomBytes(16).toString('hex')
  mkdirSync(join(mount, MARKER_DIR), { recursive: true })
  writeText(join(mount, MARKER_DIR, 'volume-id'), `${id}\n`)
  writeText(join(mount, MARKER_DIR, 'LEEME.txt'), 'Identificador de esta memoria USB de Survivelia OS (para «Abrir al conectar» en cada equipo).\nNo lo borres ni lo copies a otra memoria.\n')
  return id
}

/** Dónde se ejecuta Survivelia OS: { removable, mount, label, fs, volumeRoot, id, rel }. */
export function volumeInfo(root, platform = process.platform, media = null) {
  let list = media
  if (!list) {
    try {
      list = mountedMedia(platform)
    } catch {
      list = []
    }
  }
  const v = findVolume(root, list, platform)
  if (!v) return { removable: false, mount: null, label: null, fs: null, volumeRoot: false, id: null, rel: null, media: null }
  const rel = relative(v.path, resolve(root)).split(sep).join('/') || '.'
  return { removable: true, mount: v.path, label: v.label || null, fs: v.fs, volumeRoot: rel === '.', id: readVolumeId(v.path), rel, media: v.media }
}

// ------------------------------------------------------------------ integración visual

/** Escribe un texto aunque el fichero esté oculto (en Windows abrir con 'w' un fichero oculto da EPERM). */
export function writeText(path, text) {
  const buf = Buffer.from(text, 'utf8')
  if (existsSync(path)) {
    if (readFileSync(path).equals(buf)) return false
    const fd = openSync(path, 'r+')
    try {
      ftruncateSync(fd, 0)
      writeSync(fd, buf, 0, buf.length, 0)
    } finally {
      closeSync(fd)
    }
    return true
  }
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
  return true
}

function writeBin(path, buf) {
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  if (existsSync(path)) {
    const fd = openSync(path, 'r+')
    try {
      ftruncateSync(fd, 0)
      writeSync(fd, buf, 0, buf.length, 0)
    } finally {
      closeSync(fd)
    }
    return true
  }
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
  return true
}

/** autorun.inf: Windows solo respeta el icono y el nombre en memorias USB (el arranque automático está bloqueado). */
export function autorunInf() {
  return ['[autorun]', 'icon=app\\portable\\icon.ico', 'label=Survivelia OS', ''].join('\r\n')
}

/** autorun.sh: GNOME pregunta «¿Ejecutar?» al conectar la memoria (nunca se ejecuta sin preguntar). */
export function autorunSh() {
  return ['#!/bin/sh', '# Survivelia OS: el escritorio pregunta antes de ejecutarlo al conectar la memoria (ADR 0019).', 'cd "$(dirname "$0")" && exec sh ./abrir-survival-os.sh', ''].join('\n')
}

/** .xdg-volume-info: nombre e icono de la unidad en GNOME y otros escritorios basados en GIO. */
export function xdgVolumeInfo() {
  return ['[Volume Info]', 'Name=Survivelia OS', 'Icon=.VolumeIcon.png', ''].join('\n')
}

/**
 * Lo que se oculta con el atributo «oculto» de FAT/exFAT/NTFS. Windows y macOS lo respetan (en FAT/exFAT es el
 * mismo bit), Linux no: por eso el lanzador de Linux puede ir aquí y seguir visible en Linux. Los lanzadores de
 * Windows y macOS NO se ocultan nunca así (desaparecerían también en el otro sistema).
 */
export function attrHiddenNames({ volumeRoot, hasExe }) {
  const names = ['app', 'runtime', '.update', '.previous', 'abrir-survival-os.sh', MARKER_DIR, '.hidden']
  if (hasExe) names.push('Abrir Survivelia OS.cmd', 'Abrir Survival OS.cmd')
  if (volumeRoot) names.push(...VOLUME_FILES.filter((f) => f !== '.hidden'))
  return names
}

/** Contenido de .hidden (Nautilus, Dolphin, Thunar…): en Linux se ocultan las cosas de Windows y macOS. */
export function hiddenFile({ volumeRoot }) {
  const names = ['app', 'runtime', 'Survivelia OS.exe', 'Abrir Survivelia OS.cmd', 'Survivelia OS.app', ...LEGACY_ROOT_FILES, 'desktop.ini']
  if (volumeRoot) names.push('autorun.inf', 'autorun.sh', 'System Volume Information')
  return `${names.join('\n')}\n`
}

/** desktop.ini: icono de la carpeta «Survivelia OS» en Windows cuando no está en la raíz de la unidad. */
export function desktopIni() {
  return ['[.ShellClassInfo]', 'IconResource=app\\portable\\icon.ico,0', 'IconFile=app\\portable\\icon.ico', 'IconIndex=0', ''].join('\r\n')
}

/**
 * com.apple.FinderInfo con la marca «icono personalizado» (kHasCustomIcon, byte 8 = 0x04) conservando el resto.
 * Entrada/salida en hexadecimal (32 bytes) como `xattr -px` / `xattr -wx`.
 */
export function finderInfoWithCustomIcon(hexIn = '') {
  const clean = String(hexIn).replace(/[^0-9a-fA-F]/g, '')
  const buf = Buffer.alloc(32)
  if (clean.length === 64) Buffer.from(clean, 'hex').copy(buf)
  buf[8] |= 0x04
  return buf.toString('hex')
}

/**
 * Integra la carpeta en el sistema (idempotente; nunca falla el arranque). En la raíz de una memoria USB:
 * icono y nombre de la unidad, «Ejecutar» en GNOME, carpetas internas ocultas. En una subcarpeta: icono de la
 * carpeta (Windows) y carpetas internas ocultas. Devuelve la lista de cambios hechos.
 *   opts: { platform, volumeRoot, version, iconIcns, iconPng }
 */
export function decorate(root, { platform = process.platform, volumeRoot = false, version = '' } = {}) {
  const done = []
  const hasExe = existsSync(join(root, 'Survivelia OS.exe')) || existsSync(join(root, 'Survival OS.exe'))
  const stamp = `${version}|${platform}|${volumeRoot ? 'vol' : 'dir'}|${hasExe ? 'exe' : 'cmd'}\n`
  const stampFile = join(root, MARKER_DIR, 'decor')
  const iconDir = join(root, 'app', 'portable')
  // Copiada a la raíz de un disco interno: no se toca nada de la unidad (no es una memoria de Survivelia OS).
  if (!volumeRoot && resolve(root) === parse(resolve(root)).root) return done
  try {
    if (volumeRoot) {
      if (writeText(join(root, 'autorun.inf'), autorunInf())) done.push('autorun.inf')
      if (writeText(join(root, 'autorun.sh'), autorunSh())) done.push('autorun.sh')
      if (writeText(join(root, '.xdg-volume-info'), xdgVolumeInfo())) done.push('.xdg-volume-info')
      if (existsSync(join(iconDir, 'icon.icns')) && writeBin(join(root, '.VolumeIcon.icns'), readFileSync(join(iconDir, 'icon.icns')))) done.push('.VolumeIcon.icns')
      if (existsSync(join(iconDir, 'icon.png')) && writeBin(join(root, '.VolumeIcon.png'), readFileSync(join(iconDir, 'icon.png')))) done.push('.VolumeIcon.png')
    } else if (platform === 'win32' && writeText(join(root, 'desktop.ini'), desktopIni())) {
      done.push('desktop.ini')
    }
    if (writeText(join(root, '.hidden'), hiddenFile({ volumeRoot }))) done.push('.hidden')
  } catch {
    return done // memoria de solo lectura: no se integra, pero se puede usar
  }
  // Atributos: solo si algo ha cambiado o tras una actualización (las carpetas nuevas pierden el atributo).
  if (!done.length && readFileSafe(stampFile) === stamp) return done
  try {
    mkdirSync(join(root, MARKER_DIR), { recursive: true }) // antes de ocultar: también se oculta
  } catch {
    // solo lectura
  }
  const names = attrHiddenNames({ volumeRoot, hasExe }).filter((n) => existsSync(join(root, n)))
  if (platform === 'win32') {
    for (const n of names) spawnSync('attrib', ['+h', join(root, n)], { windowsHide: true, timeout: 10_000 })
    if (!volumeRoot && existsSync(join(root, 'desktop.ini'))) {
      spawnSync('attrib', ['+h', '+s', join(root, 'desktop.ini')], { windowsHide: true, timeout: 10_000 })
      // El atributo de solo lectura en la carpeta solo activa su desktop.ini (no impide escribir dentro).
      spawnSync('attrib', ['+r', root], { windowsHide: true, timeout: 10_000 })
    }
  } else if (platform === 'darwin') {
    for (const n of names) spawnSync('chflags', ['hidden', join(root, n)], { timeout: 10_000 })
    if (volumeRoot) {
      const cur = spawnSync('xattr', ['-px', 'com.apple.FinderInfo', root], { encoding: 'utf8', timeout: 10_000 })
      spawnSync('xattr', ['-wx', 'com.apple.FinderInfo', finderInfoWithCustomIcon(cur.status === 0 ? cur.stdout : ''), root], { timeout: 10_000 })
    }
  }
  done.push('attributes')
  try {
    mkdirSync(join(root, MARKER_DIR), { recursive: true })
    writeText(stampFile, stamp)
  } catch {
    // sin marca: se repetirá en el próximo arranque
  }
  return done
}

// ------------------------------------------------------------------ expulsar

/**
 * Orden para expulsar la memoria cuando el lanzador haya terminado (no puede expulsarse mientras Node se ejecuta
 * desde ella). Se ejecuta desde fuera de la memoria: PowerShell o sh con el código en línea y los textos por
 * variables de entorno (nunca interpolados en el código).
 *   messages: { title, ok, fail }
 */
export function ejectSpec(platform, mount, pid, messages = {}) {
  const env = {
    SURVIVAL_EJECT_MOUNT: mount,
    SURVIVAL_EJECT_PID: String(pid),
    SURVIVAL_EJECT_TITLE: messages.title || 'Survivelia OS',
    SURVIVAL_EJECT_OK: messages.ok || 'Ya puedes retirar la memoria USB.',
    SURVIVAL_EJECT_FAIL: messages.fail || 'No se pudo expulsar la memoria USB. Cierra las ventanas que la estén usando y expúlsala desde el sistema.',
  }
  if (platform === 'win32') {
    if (!/^[A-Za-z]:\\?$/.test(mount)) throw new Error('unidad no válida')
    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      'Wait-Process -Id ([int]$env:SURVIVAL_EJECT_PID) -Timeout 60',
      'Start-Sleep -Seconds 2',
      '$drive = $env:SURVIVAL_EJECT_MOUNT.Substring(0, 2)',
      '$ok = $false',
      'for ($i = 0; $i -lt 4 -and -not $ok; $i++) {',
      '  $item = (New-Object -ComObject Shell.Application).Namespace(17).ParseName($drive)',
      '  if ($item) { $item.InvokeVerb("Eject") }',
      '  Start-Sleep -Seconds 3',
      '  $ok = -not (Test-Path ($drive + "\\"))',
      '}',
      'Add-Type -AssemblyName PresentationFramework',
      'if ($ok) { [System.Windows.MessageBox]::Show($env:SURVIVAL_EJECT_OK, $env:SURVIVAL_EJECT_TITLE, "OK", "Information") | Out-Null }',
      'else { [System.Windows.MessageBox]::Show($env:SURVIVAL_EJECT_FAIL, $env:SURVIVAL_EJECT_TITLE, "OK", "Warning") | Out-Null }',
    ].join('\n')
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], env }
  }
  const notify = platform === 'darwin'
    ? 'osascript -e "on run argv" -e "display alert (item 1 of argv) message (item 2 of argv)" -e "end run" "$SURVIVAL_EJECT_TITLE" "$1" >/dev/null 2>&1'
    : '( zenity --info --title="$SURVIVAL_EJECT_TITLE" --text="$1" || kdialog --title "$SURVIVAL_EJECT_TITLE" --msgbox "$1" || notify-send "$SURVIVAL_EJECT_TITLE" "$1" ) >/dev/null 2>&1'
  const doEject = platform === 'darwin'
    ? 'diskutil eject "$SURVIVAL_EJECT_MOUNT" >/dev/null 2>&1'
    : 'gio mount -e "$SURVIVAL_EJECT_MOUNT" >/dev/null 2>&1 || { dev=$(awk -v m="$SURVIVAL_EJECT_MOUNT" \'$2==m {print $1; exit}\' /proc/mounts); [ -n "$dev" ] && udisksctl unmount -b "$dev" >/dev/null 2>&1 && udisksctl power-off -b "$dev" >/dev/null 2>&1; }'
  const mounted = platform === 'darwin'
    ? 'mounted() { mount | grep -qF " on $SURVIVAL_EJECT_MOUNT ("; }'
    : "mounted() { awk -v m=\"$SURVIVAL_EJECT_MOUNT\" '{ gsub(/\\\\040/, \" \", $2) } $2 == m { f = 1 } END { exit !f }' /proc/mounts; }"
  const sh = [
    mounted,
    'i=0; while kill -0 "$SURVIVAL_EJECT_PID" 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i+1)); done',
    'sleep 2',
    'n=0; while [ $n -lt 3 ] && mounted; do sync; ' + doEject + '; sleep 2; n=$((n+1)); done',
    'if mounted; then set -- "$SURVIVAL_EJECT_FAIL"; else set -- "$SURVIVAL_EJECT_OK"; fi',
    notify,
  ].join('\n')
  return { cmd: '/bin/sh', args: ['-c', sh, 'survival-os-eject'], env }
}

/** Lanza el ayudante de expulsión desacoplado (fuera de la memoria) y devuelve enseguida. */
export function spawnEject(platform, mount, pid, messages) {
  const spec = ejectSpec(platform, mount, pid, messages)
  const child = spawn(spec.cmd, spec.args, { cwd: tmpdir(), env: { ...process.env, ...spec.env }, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

// ------------------------------------------------------------------ preparar una memoria USB

/** Tamaño de un árbol (sin seguir enlaces). `skip`: nombres a omitir en el primer nivel. */
export function treeSize(dir, skip = new Set()) {
  let total = 0
  let files = 0
  const big = []
  const walk = (d, top) => {
    for (const e of safeDirents(d)) {
      if (top && skip.has(e.name)) continue
      if (e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p, false)
      else if (e.isFile()) {
        const s = statSafe(p)
        total += s
        files++
        if (s > FAT32_MAX) big.push({ path: p, bytes: s })
      }
    }
  }
  if (existsSync(dir)) walk(dir, true)
  return { bytes: total, files, big }
}

function safeDirents(d) {
  try {
    return readdirSync(d, { withFileTypes: true })
  } catch {
    return []
  }
}

function statSafe(p) {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

/** Sistemas incluidos en esta carpeta (runtime/<clave>/ con Node). */
export function runtimesIn(root) {
  return TARGETS.filter((k) => existsSync(join(root, 'runtime', k, k.startsWith('win') ? 'node.exe' : 'node')))
}

/** Plan de «Preparar memoria USB»: qué ocupa la aplicación y los datos, y qué no cabe en FAT32. */
export function preparePlan(root, data) {
  const app = treeSize(join(root, 'app'))
  const rt = treeSize(join(root, 'runtime'))
  let rootBytes = 0
  for (const f of ROOT_FILES) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    rootBytes += statSync(p).isDirectory() ? treeSize(p).bytes : statSafe(p)
  }
  const d = treeSize(data, DATA_EXCLUDE)
  const runtimes = runtimesIn(root)
  return {
    appBytes: app.bytes + rt.bytes + rootBytes,
    dataBytes: d.bytes,
    bigData: d.big.map((b) => ({ file: relative(data, b.path).split(sep).join('/'), bytes: b.bytes })),
    runtimes,
    allPlatforms: TARGETS.every((k) => runtimes.includes(k)),
  }
}

/** Tamaño de un árbol sin bloquear (servidor web). */
export async function treeSizeAsync(dir, skip = new Set()) {
  const { readdir, stat } = await import('node:fs/promises')
  let bytes = 0
  const big = []
  const walk = async (d, top) => {
    let entries = []
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if ((top && skip.has(e.name)) || e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, false)
      else if (e.isFile()) {
        const s = await stat(p).then((x) => x.size, () => 0)
        bytes += s
        if (s > FAT32_MAX) big.push({ path: p, bytes: s })
      }
    }
  }
  await walk(dir, true)
  return { bytes, big }
}

/** preparePlan sin bloquear (servidor web). */
export async function preparePlanAsync(root, data) {
  let appBytes = 0
  for (const name of ['app', 'runtime', ...ROOT_FILES]) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    appBytes += statSync(p).isDirectory() ? (await treeSizeAsync(p)).bytes : statSafe(p)
  }
  const d = await treeSizeAsync(data, DATA_EXCLUDE)
  const runtimes = runtimesIn(root)
  return {
    appBytes,
    dataBytes: d.bytes,
    bigData: d.big.map((b) => ({ file: relative(data, b.path).split(sep).join('/'), bytes: b.bytes })),
    runtimes,
    allPlatforms: TARGETS.every((k) => runtimes.includes(k)),
  }
}

/** Copia un fichero con progreso (los grandes en streaming para poder informar). */
async function copyFileProgress(src, dst, onBytes) {
  const size = statSafe(src)
  mkdirSync(dirname(dst), { recursive: true })
  if (size < 16 * 1024 * 1024) {
    copyFileSync(src, dst)
    onBytes(size)
    return
  }
  const rs = createReadStream(src, { highWaterMark: 4 * 1024 * 1024 })
  rs.on('data', (c) => onBytes(c.length))
  await pipeline(rs, createWriteStream(dst))
}

/** Ficheros auxiliares de SQLite: nunca se copian sueltos (la base se copia con VACUUM INTO). */
const SQLITE_SIDE = /-(wal|shm|journal)$/
const SQLITE_DB = /\.(db|sqlite|sqlite3)$/

/**
 * Copia consistente de una base SQLite que puede estar abierta por un servicio (modo WAL): VACUUM INTO crea una
 * instantánea completa. Si node:sqlite no está disponible, copia normal.
 */
async function copySqlite(src, dst) {
  mkdirSync(dirname(dst), { recursive: true })
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(src, { readOnly: true })
    try {
      db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
  } catch {
    rmSync(dst, { force: true })
    copyFileSync(src, dst)
  }
}

/** Copia un árbol. `onlyMissing`: nunca reescribe un fichero que ya exista en el destino (datos del usuario). */
async function copyTree(src, dst, { skipTop = new Set(), onlyMissing = false, skipFile = () => false, sqlite = false, onBytes }) {
  const st = lstatSync(src)
  if (st.isFile()) {
    if (onlyMissing && existsSync(dst)) return onBytes(st.size)
    if (skipFile(src, st.size)) return
    if (sqlite && SQLITE_SIDE.test(src)) return
    if (sqlite && SQLITE_DB.test(src)) {
      await copySqlite(src, dst)
      return onBytes(st.size)
    }
    return copyFileProgress(src, dst, onBytes)
  }
  if (!st.isDirectory()) return // sockets, FIFO, enlaces
  mkdirSync(dst, { recursive: true })
  for (const e of safeDirents(src)) {
    if (skipTop.has(e.name)) continue
    await copyTree(join(src, e.name), join(dst, e.name), { onlyMissing, skipFile, sqlite, onBytes })
  }
}

/**
 * «Preparar una memoria USB»: copia Survivelia OS (todos los sistemas incluidos en esta carpeta) a la raíz de la
 * memoria y, opcionalmente, los datos; después la integra (icono, nombre, ocultos) y le da un identificador.
 * Si la memoria ya tenía Survivelia OS se actualiza la aplicación y se CONSERVAN sus datos (solo se añaden los que faltan).
 *   { root, data, target, withData, rename, platform, version, log }
 */
export async function prepareUsb({ root, data, target, fs = null, withData = false, rename = true, platform = process.platform, version = '', log = () => undefined }) {
  if (isInside(target, root, platform) || isInside(root, target, platform)) throw new Error('no se puede preparar la misma memoria desde la que se ejecuta Survivelia OS')
  const plan = preparePlan(root, data)
  const fat = fs === 'fat32'
  const existing = existsSync(join(target, 'app', 'portable', 'launcher.mjs'))
  const need = plan.appBytes + (withData ? plan.dataBytes : 0)
  const sf = statfsSync(target)
  const free = sf.bavail * sf.bsize
  // Al actualizar se libera lo anterior, pero la copia se hace al lado (.part): hace falta el espacio completo.
  if (need > free - 64 * 1024 * 1024) throw new Error(`espacio insuficiente en la memoria (hacen falta ${(need / 1024 ** 3).toFixed(1)} GB)`)
  if (fat) log('AVISO: la memoria está en FAT32: no admite ficheros de más de 4 GB. Para Wikipedia completa o modelos grandes, formatéala en exFAT.')
  if (!plan.allPlatforms) log(`AVISO: esta copia solo incluye ${plan.runtimes.join(', ')}: la memoria funcionará solo en esos sistemas.`)
  log(existing ? 'La memoria ya tiene Survivelia OS: se actualiza la aplicación y se conservan sus datos.' : 'Copiando Survivelia OS a la memoria…')

  let done = 0
  let lastPct = -1
  let lastAt = 0
  const onBytes = (n) => {
    done += n
    const pct = Math.floor((done / Math.max(1, need)) * 100)
    if (pct !== lastPct && (pct % 5 === 0 || Date.now() - lastAt > 10_000)) {
      lastPct = pct
      lastAt = Date.now()
      log(`  ${Math.min(pct, 100)} %`)
    }
  }
  // Aplicación: cada elemento se copia al lado (.part) y luego se cambia, para no dejar una mitad vieja y otra nueva.
  for (const name of ['app', 'runtime', ...ROOT_FILES]) {
    const src = join(root, name)
    if (!existsSync(src)) continue
    const part = join(target, `${name}.part`)
    rmSync(part, { recursive: true, force: true })
    await copyTree(src, part, { onBytes })
    const dst = join(target, name)
    if (existsSync(dst)) {
      if (platform === 'win32') spawnSync('attrib', ['-h', '-s', '-r', dst], { windowsHide: true })
      rmSync(dst, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
    renameSync(part, dst)
  }
  for (const name of LEGACY_ROOT_FILES) {
    const old = join(target, name)
    if (!existsSync(old)) continue
    if (platform === 'win32') spawnSync('attrib', ['-h', '-s', '-r', old], { windowsHide: true })
    rmSync(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
  // Datos: los de esta carpeta que falten en la memoria (nunca se sobrescriben los suyos).
  const skipped = []
  mkdirSync(join(target, 'data'), { recursive: true })
  if (withData) {
    log('Copiando tus datos (mapas, documentos, Wikipedia, asistente…)')
    await copyTree(data, join(target, 'data'), {
      skipTop: new Set([...DATA_EXCLUDE, 'share.json']),
      onlyMissing: true,
      sqlite: true,
      skipFile: (p, size) => {
        // Índice de la biblioteca: se reconstruye solo al arrancar desde la memoria.
        if (/[\\/]library[\\/]index\.sqlite/.test(p)) return true
        if (fat && size > FAT32_MAX) {
          skipped.push(relative(data, p).split(sep).join('/'))
          log(`  Omitido (más de 4 GB, no cabe en FAT32): ${basename(p)}`)
          return true
        }
        return false
      },
      onBytes,
    })
  }
  if (existsSync(join(root, 'app', 'portable', 'data-LEEME.txt')) && !existsSync(join(target, 'data', 'LEEME.txt'))) {
    copyFileSync(join(root, 'app', 'portable', 'data-LEEME.txt'), join(target, 'data', 'LEEME.txt'))
  }
  const id = ensureVolumeId(target)
  decorate(target, { platform, volumeRoot: true, version })
  if (platform === 'darwin') spawnSync('xattr', ['-dr', 'com.apple.quarantine', target], { timeout: 120_000 })
  log('Memoria integrada: icono, nombre y carpetas internas ocultas.')
  let renamed = false
  if (rename) renamed = renameVolume(platform, target)
  log(renamed ? `Unidad renombrada a «${VOLUME_LABEL}».` : 'El nombre de la unidad no se ha cambiado (se muestra «Survivelia OS» en el explorador).')
  return { id, existing, copiedBytes: done, skipped, renamed }
}

/** Renombra la unidad (sin administrador cuando el sistema lo permite). Siempre lo último: en macOS cambia la ruta. */
export function renameVolume(platform, mount) {
  try {
    if (platform === 'win32') {
      const letter = parse(resolve(mount)).root.slice(0, 2)
      if (!/^[A-Za-z]:$/.test(letter) || resolve(mount) !== resolve(`${letter}\\`)) return false
      return spawnSync('label.exe', [letter, VOLUME_LABEL], { windowsHide: true, timeout: 15_000, stdio: 'ignore' }).status === 0
    }
    if (platform === 'darwin') {
      if (dirname(resolve(mount)) !== '/Volumes') return false
      return spawnSync('diskutil', ['rename', mount, VOLUME_LABEL], { timeout: 30_000, stdio: 'ignore' }).status === 0
    }
  } catch {
    // sin permiso: se queda el nombre anterior
  }
  return false // Linux: cambiar la etiqueta exige root; .xdg-volume-info da el nombre visible.
}
