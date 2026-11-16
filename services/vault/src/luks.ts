import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseKeyslots, parseUnlockedSlot } from './policy.ts'

/**
 * Envoltorio mínimo de cryptsetup/mount. Las contraseñas se pasan SIEMPRE por stdin
 * (--key-file=-), nunca por argumentos (visibles en /proc) ni en registros.
 */

export interface CmdResult {
  code: number
  stderr: string
}

export function runCmd(cmd: string, args: string[], stdin?: string, timeoutMs = 120_000): Promise<CmdResult> {
  return runCmdEx(cmd, args, { stdin, timeoutMs })
}

interface CmdOptions {
  stdin?: string
  /** Mezcla stdout con stderr en el resultado (salida -v de cryptsetup). */
  captureStdout?: boolean
  timeoutMs?: number
}

export function runCmdEx(cmd: string, args: string[], o: CmdOptions = {}): Promise<CmdResult> {
  const { stdin, captureStdout = false, timeoutMs = 120_000 } = o
  return new Promise((resolve) => {
    const stdio: ('pipe' | 'ignore')[] = ['pipe', captureStdout ? 'pipe' : 'ignore', 'pipe']
    const child = spawn(cmd, args, { stdio, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' } })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const collect = (d: Buffer): void => {
      if (stderr.length < 4000) stderr += d.toString()
    }
    child.stderr?.on('data', collect)
    child.stdout?.on('data', collect)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 127, stderr: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stderr: stderr.trim() })
    })
    if (stdin !== undefined) child.stdin?.end(stdin)
    else child.stdin?.end()
  })
}

/** Misma KDF que el keyslot principal (ADR 0004). */
const PBKDF = ['--pbkdf', 'argon2id', '--pbkdf-memory', '262144', '--iter-time', '2000']

/** Keyslots activos del contenedor (sin KDF: no necesita contraseña). */
export async function activeSlots(p: LuksPaths): Promise<number[]> {
  const r = await runCmdEx('cryptsetup', ['luksDump', p.container], { captureStdout: true })
  if (r.code !== 0) throw new Error(`luksDump: ${r.stderr}`)
  return parseKeyslots(r.stderr)
}

/** Keyslot que abre `key`, o null si no abre ninguno. No mapea el volumen (--test-passphrase). */
export async function slotForKey(p: LuksPaths, key: string): Promise<number | null> {
  const r = await runCmdEx('cryptsetup', ['open', '--test-passphrase', '--type', 'luks2', '-v', '--key-file=-', p.container], {
    stdin: key,
    captureStdout: true,
  })
  if (r.code === 0) {
    const slot = parseUnlockedSlot(r.stderr)
    if (slot === null) throw new Error('cryptsetup no informó del keyslot')
    return slot
  }
  if (r.code === 2 || /No key available/i.test(r.stderr)) return null
  throw new Error(`cryptsetup test: ${r.stderr}`)
}

/**
 * Añade `newKey` autenticando con `existing`. Devuelve el keyslot nuevo.
 * cryptsetup lee la clave existente por stdin y la nueva de un fichero. Ese fichero vive en
 * `p.keyTmpDir` (RuntimeDirectory del servicio: tmpfs en RAM, 0700 root, invisible para otros
 * procesos), se crea 0600 con nombre aleatorio y se sobrescribe con ceros y se borra al terminar.
 * Nota: /dev/fd/N no sirve, porque los descriptores extra de Node son sockets, no pipes.
 */
export async function addKey(p: LuksPaths, existing: string, newKey: string): Promise<number> {
  const before = new Set(await activeSlots(p))
  const keyFile = join(p.keyTmpDir, `.k-${randomBytes(12).toString('hex')}`)
  const bytes = Buffer.from(newKey, 'utf8')
  let r: CmdResult
  try {
    await writeFile(keyFile, bytes, { mode: 0o600, flag: 'wx' })
    r = await runCmdEx('cryptsetup', ['luksAddKey', '--batch-mode', ...PBKDF, '--key-file=-', p.container, keyFile], {
      stdin: existing,
      timeoutMs: 300_000,
    })
  } finally {
    await writeFile(keyFile, Buffer.alloc(bytes.length), { flag: 'r+' }).catch(() => undefined)
    await rm(keyFile, { force: true })
    bytes.fill(0)
  }
  if (r.code !== 0) throw new Error(`luksAddKey: ${r.stderr}`)
  const added = (await activeSlots(p)).filter((s) => !before.has(s))
  if (added.length !== 1) throw new Error('luksAddKey: keyslot nuevo no identificado')
  return added[0] as number
}

/** Borra todos los keyslots salvo `keep`. Nunca deja el contenedor sin ninguno. */
export async function killSlotsExcept(p: LuksPaths, keep: number[], auth: string): Promise<void> {
  const active = await activeSlots(p)
  if (!keep.some((k) => active.includes(k))) throw new Error('Ningún keyslot a conservar está activo')
  for (const s of active.filter((x) => !keep.includes(x))) {
    const r = await runCmdEx('cryptsetup', ['luksKillSlot', '--batch-mode', '--key-file=-', p.container, String(s)], {
      stdin: auth,
      timeoutMs: 300_000,
    })
    if (r.code !== 0) throw new Error(`luksKillSlot ${s}: ${r.stderr}`)
  }
}

export interface LuksPaths {
  container: string
  mapper: string
  mountPoint: string
  /** Directorio en RAM, solo root, para el fichero de clave efímero de luksAddKey. */
  keyTmpDir: string
}

export async function createContainer(p: LuksPaths, sizeBytes: number, passphrase: string): Promise<void> {
  // Reserva real de espacio (fallocate) para no descubrir "disco lleno" con datos dentro.
  let r = await runCmd('fallocate', ['-l', String(sizeBytes), p.container])
  if (r.code !== 0) throw new Error(`fallocate: ${r.stderr}`)
  r = await runCmd(
    'cryptsetup',
    ['luksFormat', '--batch-mode', '--type', 'luks2', '--pbkdf', 'argon2id', '--pbkdf-memory', '262144', '--iter-time', '2000', '--key-file=-', p.container],
    passphrase,
    300_000,
  )
  if (r.code !== 0) throw new Error(`luksFormat: ${r.stderr}`)
  await openContainer(p, passphrase)
  r = await runCmd('mkfs.ext4', ['-q', '-L', 'survival-vault', '-m', '0', `/dev/mapper/${p.mapper}`])
  if (r.code !== 0) throw new Error(`mkfs: ${r.stderr}`)
}

/** Abre el volumen LUKS. Devuelve false si la contraseña es incorrecta. */
export async function openContainer(p: LuksPaths, passphrase: string): Promise<boolean> {
  const r = await runCmd('cryptsetup', ['open', '--type', 'luks2', '--key-file=-', p.container, p.mapper], passphrase, 120_000)
  if (r.code === 0) return true
  if (r.code === 2 || /No key available/i.test(r.stderr)) return false
  throw new Error(`cryptsetup open: ${r.stderr}`)
}

export async function mountVolume(p: LuksPaths): Promise<void> {
  const r = await runCmd('mount', ['-o', 'nodev,nosuid,noexec,noatime', `/dev/mapper/${p.mapper}`, p.mountPoint])
  if (r.code !== 0) throw new Error(`mount: ${r.stderr}`)
}

export async function closeAll(p: LuksPaths): Promise<void> {
  await runCmd('sync', [])
  await runCmd('umount', [p.mountPoint])
  await runCmd('cryptsetup', ['close', p.mapper])
  // Vacía la caché de páginas para no dejar contenido descifrado en RAM.
  await runCmd('sh', ['-c', 'echo 1 > /proc/sys/vm/drop_caches'])
}

export async function isMapped(mapper: string): Promise<boolean> {
  const r = await runCmd('cryptsetup', ['status', mapper])
  return r.code === 0
}
