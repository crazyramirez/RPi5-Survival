import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { chmod, chown, lstat, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { RemovableFile, VaultRecoveryKeyResult, VaultStatus } from '@survival-os/shared-types'
import { MAX_FILE_BYTES, VaultFiles } from './files.ts'
import { activeSlots, addKey, closeAll, createContainer, isMapped, killSlotsExcept, mountVolume, openContainer, slotForKey, type LuksPaths } from './luks.ts'
import { formatRecoveryKey, normalizeRecoveryKey, passphraseProblem, retryAfter, safeRelative } from './policy.ts'

const env = process.env
const DIR = env.VAULT_DIR || '/var/lib/survival-os/vault'
const SOCKET = env.VAULT_SOCKET || '/run/survival-os/vault.sock'
const MEDIA_ROOT = env.VAULT_MEDIA_ROOT || '/media'
const AUTO_LOCK_S = Math.max(60, Number.parseInt(env.VAULT_AUTOLOCK_SECONDS ?? '', 10) || 300)
const paths: LuksPaths = {
  container: join(DIR, 'vault.luks'),
  mapper: env.VAULT_MAPPER || 'survival-vault',
  mountPoint: env.VAULT_MOUNT || '/run/survival-vault/mnt',
  // RuntimeDirectory=survival-vault: tmpfs, 0700 root, privado del servicio.
  keyTmpDir: env.VAULT_KEY_TMP || '/run/survival-vault',
}
const ATTEMPTS = join(DIR, 'attempts.json')
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

let unlocked = false
let lockAt: number | null = null
let lockTimer: NodeJS.Timeout | null = null
let busy = false
let attempts = { failures: 0, lastFailureAt: null as number | null }
/** Hay keyslot de recuperación (>= 2 keyslots). null = sin medir (sin contenedor o luksDump falló). */
let hasRecovery: boolean | null = null
const files = new VaultFiles(paths.mountPoint)


function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  // Nunca se registran contraseñas, nombres de documentos ni contenidos.
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'vault', msg, ...extra })}\n`)
}

async function loadAttempts(): Promise<void> {
  try {
    attempts = JSON.parse(await readFile(ATTEMPTS, 'utf8')) as typeof attempts
  } catch {
    attempts = { failures: 0, lastFailureAt: null }
  }
}
async function saveAttempts(): Promise<void> {
  await writeFile(ATTEMPTS, JSON.stringify(attempts), { mode: 0o600 })
}

function touch(): void {
  if (!unlocked) return
  lockAt = Date.now() + AUTO_LOCK_S * 1000
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = setTimeout(() => void lock('inactividad'), AUTO_LOCK_S * 1000)
}

async function lock(reason: string): Promise<void> {
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = null
  lockAt = null
  if (!unlocked && !(await isMapped(paths.mapper))) return
  unlocked = false
  await closeAll(paths)
  log('info', 'locked', { reason })
}

async function status(): Promise<VaultStatus> {
  const configured = existsSync(paths.container)
  let freeBytes: number | null = null
  if (unlocked) {
    const s = await statfs(paths.mountPoint).catch(() => null)
    freeBytes = s ? s.bavail * s.bsize : null
  }
  return {
    configured,
    unlocked,
    containerBytes: configured ? (await stat(paths.container)).size : null,
    freeBytes,
    autoLockSeconds: AUTO_LOCK_S,
    lockAt: lockAt ? new Date(lockAt).toISOString() : null,
    retryAfterSeconds: retryAfter(attempts.failures, attempts.lastFailureAt, Date.now()),
    failedAttempts: attempts.failures,
    cryptsetup: existsSync('/usr/sbin/cryptsetup') || existsSync('/sbin/cryptsetup'),
    recoveryKey: configured ? hasRecovery : null,
    discardedBytes: await discardedBytes(),
  }
}

async function refreshRecovery(): Promise<void> {
  hasRecovery = existsSync(paths.container) ? await activeSlots(paths).then((s) => s.length >= 2).catch(() => null) : null
}

const DISCARDED = /^vault\.luks\.descartada-[\w-]+$/
/** Bytes ocupados por bóvedas descartadas (se conservan cifradas hasta que se borran por SSH). */
async function discardedBytes(): Promise<number> {
  let total = 0
  for (const n of await readdir(DIR).catch(() => [] as string[])) {
    if (DISCARDED.test(n)) total += (await stat(join(DIR, n)).catch(() => null))?.size ?? 0
  }
  return total
}

async function registerFailure(): Promise<VaultStatus> {
  attempts = { failures: attempts.failures + 1, lastFailureAt: Date.now() }
  await saveAttempts()
  log('warn', 'unlock_failed', { failures: attempts.failures })
  return await status()
}

async function clearFailures(): Promise<void> {
  attempts = { failures: 0, lastFailureAt: null }
  await saveAttempts()
}

/** Genera una clave de recuperación nueva, la añade (autenticando con `auth`) y deja solo `keepSlot` + la nueva. */
async function rotateRecovery(auth: string, keepSlot: number): Promise<string> {
  const rk = formatRecoveryKey(randomBytes(20))
  const added = await addKey(paths, auth, rk)
  await killSlotsExcept(paths, [keepSlot, added], auth)
  await refreshRecovery()
  return rk
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readJson(req: IncomingMessage, max = 8192): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > max) throw Object.assign(new Error('payload_too_large'), { status: 413 })
    chunks.push(c as Buffer)
  }
  try {
    const v = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) : {}
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
}

/** Ficheros en medios extraíbles montados (/media/<usuario>/<etiqueta>/…). Sin seguir enlaces. */
async function listRemovable(): Promise<RemovableFile[]> {
  const out: RemovableFile[] = []
  const walk = async (base: string, rel: string, media: string, depth: number): Promise<void> => {
    if (depth > 4 || out.length >= 500) return
    for (const e of await readdir(join(base, rel), { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(base, r, media, depth + 1)
      else if (e.isFile()) {
        const st = await stat(join(base, r)).catch(() => null)
        if (st && st.size <= MAX_FILE_BYTES) out.push({ media, path: r, sizeBytes: st.size })
      }
      if (out.length >= 500) return
    }
  }
  for (const user of await readdir(MEDIA_ROOT).catch(() => [] as string[])) {
    for (const label of await readdir(join(MEDIA_ROOT, user)).catch(() => [] as string[])) {
      await walk(join(MEDIA_ROOT, user, label), '', `${user}/${label}`, 0)
    }
  }
  return out
}

function requireUnlocked(): void {
  if (!unlocked) throw Object.assign(new Error('Bóveda bloqueada'), { status: 423 })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://vault')
  const p = url.pathname
  const m = req.method ?? 'GET'

  if (m === 'GET' && p === '/health') return send(res, 200, { status: 'ok', service: 'vault', version: VERSION })
  if (m === 'GET' && p === '/status') return send(res, 200, await status())

  if (m === 'POST' && (p === '/setup' || p === '/unlock')) {
    if (busy) return send(res, 409, { error: 'Operación en curso' })
    busy = true // antes de cualquier await (evita dos cryptsetup/Argon2id simultáneos)
    try {
      const b = await readJson(req)
      const pass = typeof b.passphrase === 'string' ? b.passphrase : ''
      if (p === '/setup') {
        if (existsSync(paths.container)) return send(res, 409, { error: 'La bóveda ya existe' })
        const problem = passphraseProblem(pass)
        if (problem) return send(res, 400, { error: problem })
        const sizeMiB = Math.min(65536, Math.max(64, Number(b.sizeMiB) || 1024))
        const s = await statfs(DIR)
        if (s.bavail * s.bsize < sizeMiB * 1024 * 1024 + 2 * 1024 ** 3) return send(res, 507, { error: 'Espacio insuficiente' })
        log('info', 'setup_started', { sizeMiB })
        let recoveryKey: string
        try {
          await createContainer(paths, sizeMiB * 1024 * 1024, pass)
          await mountVolume(paths)
          await files.init()
          recoveryKey = formatRecoveryKey(randomBytes(20))
          await addKey(paths, pass, recoveryKey)
        } catch (err) {
          await closeAll(paths)
          await rm(paths.container, { force: true })
          throw err
        }
        await closeAll(paths)
        await refreshRecovery()
        await clearFailures()
        log('info', 'setup_done')
        const out: VaultRecoveryKeyResult = { ...(await status()), newRecoveryKey: recoveryKey }
        return send(res, 200, out)
      }
      // /unlock
      if (unlocked) {
        touch()
        return send(res, 200, await status())
      }
      if (!existsSync(paths.container)) return send(res, 404, { error: 'Bóveda no configurada' })
      const wait = retryAfter(attempts.failures, attempts.lastFailureAt, Date.now())
      if (wait > 0) return send(res, 429, { error: `Demasiados intentos. Espera ${wait} s`, retryAfterSeconds: wait })
      if (!(await openContainer(paths, pass))) return send(res, 401, { error: 'Contraseña incorrecta', ...(await registerFailure()) })
      await mountVolume(paths)
      await files.init()
      unlocked = true
      await clearFailures()
      touch()
      log('info', 'unlocked')
      return send(res, 200, await status())
    } finally {
      busy = false
    }
  }

  // Clave de recuperación y descarte (ADR 0013): un solo cryptsetup a la vez y mismo límite de intentos.
  if (m === 'POST' && (p === '/recover' || p === '/recovery-key' || p === '/discard')) {
    if (busy) return send(res, 409, { error: 'Operación en curso' })
    busy = true
    try {
      const b = await readJson(req)
      if (!existsSync(paths.container)) return send(res, 404, { error: 'Bóveda no configurada' })

      if (p === '/discard') {
        // Sin contraseña ni clave: se aparta el contenedor (sigue cifrado) para poder crear otro.
        if (b.confirm !== 'DESCARTAR') return send(res, 400, { error: 'Falta la confirmación' })
        if (unlocked) return send(res, 409, { error: 'Bloquea la bóveda antes de descartarla' })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await rename(paths.container, join(DIR, `vault.luks.descartada-${stamp}`))
        await clearFailures()
        await refreshRecovery()
        log('warn', 'vault_discarded')
        return send(res, 200, await status())
      }

      const wait = retryAfter(attempts.failures, attempts.lastFailureAt, Date.now())
      if (wait > 0) return send(res, 429, { error: `Demasiados intentos. Espera ${wait} s`, retryAfterSeconds: wait })

      if (p === '/recover') {
        // Contraseña olvidada: la clave de recuperación sustituye la contraseña por una nueva.
        const rk = normalizeRecoveryKey(b.recoveryKey)
        const next = typeof b.newPassphrase === 'string' ? b.newPassphrase : ''
        const problem = passphraseProblem(next)
        if (problem) return send(res, 400, { error: problem })
        const rkSlot = rk ? await slotForKey(paths, rk) : null
        if (!rk || rkSlot === null) return send(res, 401, { error: 'Clave de recuperación incorrecta', ...(await registerFailure()) })
        const passSlot = await addKey(paths, rk, next)
        await killSlotsExcept(paths, [rkSlot, passSlot], rk) // elimina la contraseña olvidada
        await clearFailures()
        await refreshRecovery()
        log('info', 'passphrase_recovered')
        return send(res, 200, await status())
      }

      // /recovery-key: crea o regenera la clave de recuperación con la contraseña actual.
      const pass = typeof b.passphrase === 'string' ? b.passphrase : ''
      if (normalizeRecoveryKey(pass)) return send(res, 400, { error: 'Escribe la contraseña, no la clave de recuperación' })
      const passSlot = pass ? await slotForKey(paths, pass) : null
      if (passSlot === null) return send(res, 401, { error: 'Contraseña incorrecta', ...(await registerFailure()) })
      const recoveryKey = await rotateRecovery(pass, passSlot)
      await clearFailures()
      log('info', 'recovery_key_rotated')
      const out: VaultRecoveryKeyResult = { ...(await status()), newRecoveryKey: recoveryKey }
      return send(res, 200, out)
    } finally {
      busy = false
    }
  }

  if (m === 'POST' && p === '/lock') {
    await lock('usuario')
    return send(res, 200, await status())
  }
  if (m === 'POST' && p === '/touch') {
    touch()
    return send(res, 200, await status())
  }

  if (p === '/files' && m === 'GET') {
    requireUnlocked()
    touch()
    return send(res, 200, await files.list())
  }
  if (p === '/files' && m === 'POST') {
    requireUnlocked()
    touch()
    const name = url.searchParams.get('name') ?? 'documento'
    const tags = (url.searchParams.get('tags') ?? '').split(',').filter(Boolean)
    const file = await files.add(req, { name, tags, reviewDate: url.searchParams.get('review') })
    log('info', 'file_added', { bytes: file.sizeBytes })
    return send(res, 201, file)
  }
  const f = /^\/files\/([0-9a-f-]{36})(\/raw)?$/.exec(p)
  if (f) {
    requireUnlocked()
    touch()
    const id = f[1] ?? ''
    if (m === 'DELETE') return send(res, (await files.remove(id)) ? 200 : 404, { ok: true })
    if (m === 'PATCH') {
      const updated = await files.update(id, await readJson(req))
      return updated ? send(res, 200, updated) : send(res, 404, { error: 'not_found' })
    }
    if (m === 'GET' && f[2]) {
      const opened = await files.open(id)
      if (!opened) return send(res, 404, { error: 'not_found' })
      res.writeHead(200, {
        'content-type': opened.file.mime,
        'content-length': opened.file.sizeBytes,
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
      })
      opened.stream.pipe(res)
      return
    }
  }

  if (p === '/removable' && m === 'GET') {
    requireUnlocked()
    touch()
    return send(res, 200, await listRemovable())
  }
  if (p === '/import' && m === 'POST') {
    requireUnlocked()
    touch()
    const b = await readJson(req)
    const media = typeof b.media === 'string' ? b.media : ''
    const rel = typeof b.path === 'string' ? b.path : ''
    if (!/^[\w.-]+\/[^/]+$/.test(media) || media.includes('..') || !safeRelative(rel)) return send(res, 400, { error: 'Ruta no válida' })
    const full = join(MEDIA_ROOT, media, rel)
    const st = await lstat(full).catch(() => null)
    if (!st?.isFile()) return send(res, 404, { error: 'Fichero no encontrado' })
    const file = await files.add(createReadStream(full), { name: rel.split('/').pop() ?? 'documento' })
    log('info', 'file_imported', { bytes: file.sizeBytes })
    return send(res, 201, file)
  }
  send(res, 404, { error: 'not_found' })
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const code = (err as { status?: number }).status ?? 500
    if (code === 500) log('error', 'request_failed', { error: err instanceof Error ? err.message.slice(0, 200) : 'error' })
    if (!res.headersSent) send(res, code, { error: code === 500 ? 'Error interno de la bóveda' : (err as Error).message })
    else res.end()
  })
})
server.requestTimeout = 600_000

async function main(): Promise<void> {
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  await mkdir(paths.mountPoint, { recursive: true, mode: 0o700 })
  await loadAttempts()
  await refreshRecovery()
  // Arranque tras un corte: nunca dejar un volumen abierto de una sesión anterior.
  if (await isMapped(paths.mapper)) await closeAll(paths)
  await rm(SOCKET, { force: true })
  server.listen(SOCKET, async () => {
    let gid = 0
    try {
      gid = Number(execFileSync('getent', ['group', 'survival']).toString().split(':')[2])
    } catch {
      log('warn', 'group_survival_missing')
    }
    await chown(SOCKET, 0, gid)
    await chmod(SOCKET, 0o660)
    log('info', 'listening', { socket: SOCKET, version: VERSION, autoLockSeconds: AUTO_LOCK_S })
  })
}

async function shutdown(): Promise<void> {
  await lock('parada del servicio').catch(() => undefined)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

void main()
