/**
 * «Instalar en este equipo» (ADR 0014): copia la carpeta portable a la carpeta de aplicaciones del
 * usuario (sin administrador) y crea los accesos directos del sistema.
 *   Windows: %LOCALAPPDATA%\Programs\Survival OS  + menú Inicio y escritorio (.lnk)
 *   macOS:   ~/Applications/Survival OS            (contiene «Survival OS.app»; Spotlight lo encuentra)
 *   Linux:   ~/.local/share/survival-os            + lanzador .desktop
 * Si ya estaba instalado se actualizan app/ y runtime/ y se CONSERVAN sus datos (data/).
 * Solo se copia el runtime de este sistema.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DATA_EXCLUDE, defaultInstallDir, platformKey } from './lib.mjs'

/** Bytes de una carpeta (recursivo, sin seguir enlaces). */
export function dirSize(dir, skip = new Set()) {
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name) || e.isSymbolicLink()) continue
    const p = join(dir, e.name)
    total += e.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return total
}

/** Plan de instalación sin tocar nada (lo muestra la interfaz antes de confirmar). */
export function installPlan(root, platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch)
  // SURVIVAL_INSTALL_DIR / SURVIVAL_SHORTCUT_DIR: solo para pruebas (no tocar el equipo real).
  const dest = process.env.SURVIVAL_INSTALL_DIR || defaultInstallDir(platform, process.env, homedir())
  const same = resolve(root).toLowerCase() === resolve(dest).toLowerCase()
  const update = existsSync(join(dest, 'app'))
  const dataBytes = existsSync(join(root, 'data')) ? dirSize(join(root, 'data'), DATA_EXCLUDE) : 0
  const appBytes = dirSize(join(root, 'app')) + (key && existsSync(join(root, 'runtime', key)) ? dirSize(join(root, 'runtime', key)) : 0)
  // En una actualización los datos ya instalados se conservan: no se copian los de esta carpeta.
  return { key, dest, same, update, bytes: appBytes + (update ? 0 : dataBytes), dataBytes, copiesData: !update }
}

function launcherFiles(platform) {
  if (platform === 'win32') return ['Abrir Survival OS.cmd']
  if (platform === 'darwin') return ['Survival OS.app']
  return ['abrir-survival-os.sh']
}

export async function installHere({ root, onProgress = () => undefined, platform = process.platform, arch = process.arch }) {
  const plan = installPlan(root, platform, arch)
  if (!plan.key) throw new Error(`Sistema no soportado: ${platform}-${arch}`)
  if (plan.same) throw new Error('Survival OS ya se está ejecutando desde la carpeta instalada')
  if (!existsSync(join(root, 'runtime', plan.key))) throw new Error(`Esta carpeta no incluye el runtime ${plan.key}`)
  const { dest } = plan
  mkdirSync(dest, { recursive: true })

  onProgress('Copiando la aplicación…')
  rmSync(join(dest, 'app'), { recursive: true, force: true })
  cpSync(join(root, 'app'), join(dest, 'app'), { recursive: true })
  onProgress('Copiando el runtime…')
  rmSync(join(dest, 'runtime'), { recursive: true, force: true })
  cpSync(join(root, 'runtime', plan.key), join(dest, 'runtime', plan.key), { recursive: true })
  for (const f of [...launcherFiles(platform), 'LEEME.txt']) {
    if (existsSync(join(root, f))) cpSync(join(root, f), join(dest, f), { recursive: true })
  }

  if (plan.copiesData && existsSync(join(root, 'data'))) {
    onProgress('Copiando mapas, documentos y datos…')
    mkdirSync(join(dest, 'data'), { recursive: true })
    for (const e of readdirSync(join(root, 'data'))) {
      if (!DATA_EXCLUDE.has(e)) cpSync(join(root, 'data', e), join(dest, 'data', e), { recursive: true })
    }
  }

  // Permisos de ejecución (la copia desde exFAT/FAT puede perderlos).
  if (platform !== 'win32') {
    const exe = [join(dest, 'runtime', plan.key, 'node'), join(dest, 'abrir-survival-os.sh'), join(dest, 'Survival OS.app', 'Contents', 'MacOS', 'survival-os')]
    for (const f of exe) if (existsSync(f)) chmodSync(f, 0o755)
  }

  onProgress('Creando accesos directos…')
  const shortcuts = createShortcuts(dest, platform)
  return { dest, shortcuts }
}

function createShortcuts(dest, platform) {
  if (platform === 'win32') {
    const target = join(dest, 'runtime', 'win-x64', 'node.exe')
    const script = join(dest, 'app', 'portable', 'win', 'survival-os.vbs')
    const ico = join(dest, 'app', 'portable', 'icon.ico')
    const q = (v) => v.replace(/'/g, "''") // literal entre comillas simples de PowerShell
    // Acceso directo a wscript + .vbs: abre la app sin ventana de consola.
    const ps = `
$s = New-Object -ComObject WScript.Shell
$targets = ${process.env.SURVIVAL_SHORTCUT_DIR ? `@('${q(process.env.SURVIVAL_SHORTCUT_DIR)}')` : "@([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))"}
foreach ($dir in $targets) {
  $l = $s.CreateShortcut((Join-Path $dir 'Survival OS.lnk'))
  $l.TargetPath = "$env:WINDIR\\System32\\wscript.exe"
  $l.Arguments = '"${q(script)}"'
  $l.WorkingDirectory = '${q(dest)}'
  if (Test-Path '${q(ico)}') { $l.IconLocation = '${q(ico)}' } else { $l.IconLocation = '${q(target)},0' }
  $l.Description = 'Survival OS'
  $l.Save()
}`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`No se pudieron crear los accesos directos: ${(r.stderr || '').slice(0, 300)}`)
    return ['Menú Inicio → Survival OS', 'Escritorio → Survival OS']
  }
  if (platform === 'darwin') {
    // La .app ya está dentro de ~/Applications/Survival OS: Launchpad y Spotlight la encuentran.
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', dest], { stdio: 'ignore' })
    return ['Aplicaciones → Survival OS → Survival OS.app (también en Spotlight)']
  }
  const appsDir = process.env.SURVIVAL_SHORTCUT_DIR || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications')
  mkdirSync(appsDir, { recursive: true })
  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Survival OS',
    'Comment=Terminal de supervivencia offline',
    `Exec="${join(dest, 'abrir-survival-os.sh')}"`,
    `Icon=${join(dest, 'app', 'portable', 'icon.png')}`,
    'Terminal=false',
    'Categories=Utility;Education;',
    '',
  ].join('\n')
  writeFileSync(join(appsDir, 'survival-os.desktop'), desktop, { mode: 0o755 })
  return ['Menú de aplicaciones → Survival OS']
}
