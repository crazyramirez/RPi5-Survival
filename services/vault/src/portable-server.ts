import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, dirname, join } from 'node:path'
import type { RemovableFile, VaultRecoveryKeyResult, VaultStatus } from '@survival-os/shared-types'
import { EncryptedFiles, KDF, findSlot, makeSlot, type Header } from './crypto-store.ts'
import { MAX_FILE_BYTES } from './files.ts'
import { formatRecoveryKey, normalizeRecoveryKey, passphraseProblem, retryAfter, safeRelative } from './policy.ts'

/**
 * Bóveda de la versión portable (ADR 0016): MISMA API que server.ts (Pi, LUKS) sobre un named pipe
 * (Windows) o un socket Unix, para que la web no cambie. Cifrado: crypto-store.ts.
 */
const env = process.env
const DIR = env.VAULT_DIR || join(process.cwd(), 'vault')
const SOCKET = env.VAULT_SOCKET || join(DIR, 'vault.sock')
const AUTO_LOCK_S = Math.max(60, Number.parseInt(env.VAULT_AUTOLOCK_SECONDS ?? '', 10) || 300)
const HEADER = join(DIR, 'vault.json')
const ATTEMPTS = join(DIR, '..', 'vault-attempts.json')
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

let master: Buffer | null = null
let files: EncryptedFiles | null = null
let lockAt: number | null = null
let lockTimer: NodeJS.Timeout | null = null
let busy = false
let attempts = { failures: 0, lastFailureAt: null as number | null }

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'vault-portable', msg, ...extra })}\n`)
}

async function readHeader(): Promise<Header | null> {
  try {
    return JSON.parse(await readFile(HEADER, 'utf8')) as Header
  } catch {
    return null
  }
}
async function writeHeader(h: Header): Promise<void> {
  await writeFile(`${HEADER}.tmp`, JSON.stringify(h, null, 1), { mode: 0o600 })
  await rename(`${HEADER}.tmp`, HEADER)
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

function touch(): void {
  if (!master) return
  lockAt = Date.now() + AUTO_LOCK_S * 1000
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = setTimeout(() => lock('inactividad'), AUTO_LOCK_S * 1000)
}

function lock(reason: string): void {
  if (lockTimer) clearTimeout(lockTimer)
  lockTimer = null
  lockAt = null
  if (!master) return
  master.fill(0) // la clave maestra no se queda en memoria
  master = null
  files = null
  log('info', 'locked', { reason })
}

async function dirSize(d: string): Promise<number> {
  let n = 0
  for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
    const p = join(d, e.name)
    n += e.isDirectory() ? await dirSize(p) : ((await stat(p).catch(() => null))?.size ?? 0)
  }
  return n
}

async function discardedBytes(): Promise<number> {
  let total = 0
  for (const n of await readdir(dirname(DIR)).catch(() => [] as string[])) {
    if (n.startsWith(`${basename(DIR)}.descartada-`)) total += await dirSize(join(dirname(DIR), n))
  }
  return total
}

async function status(): Promise<VaultStatus> {
  const h = await readHeader()
  let freeBytes: number | null = null
  if (master) {
    const s = await statfs(DIR).catch(() => null)
    freeBytes = s ? s.bavail * s.bsize : null
  }
  return {
    configured: !!h,
    unlocked: !!master,
    containerBytes: h ? await dirSize(DIR) : null,
    freeBytes,
    autoLockSeconds: AUTO_LOCK_S,
    lockAt: lockAt ? new Date(lockAt).toISOString() : null,
    retryAfterSeconds: retryAfter(attempts.failures, attempts.lastFailureAt, Date.now()),
    failedAttempts: attempts.failures,
    cryptsetup: true, // motor de cifrado disponible (aquí, node:crypto)
    recoveryKey: h ? h.slots.some((s) => s.kind === 'recovery') : null,
    discardedBytes: await discardedBytes(),
  }
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

// ------------------------------------------------------------------ medios extraíbles del anfitrión

const run = (cmd: string, args: string[]): Promise<string> => new Promise((ok) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (e, out) => ok(e ? '' : String(out))))

/** Volúmenes extraíbles → { media: "vol/<nombre>", root }. */
async function removableRoots(): Promise<{ media: string; root: string }[]> {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ForEach-Object { $_.DeviceID }'])
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[A-Z]:$/.test(l))
      .map((d) => ({ media: `vol/${d[0]}`, root: `${d}\\` }))
  }
  const bases = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${process.env.USER ?? ''}`, `/run/media/${process.env.USER ?? ''}`]
  const out: { media: string; root: string }[] = []
  for (const b of bases) {
    for (const n of await readdir(b).catch(() => [] as string[])) {
      if (process.platform === 'darwin' && n === 'Macintosh HD') continue
      if (/^[\w .-]{1,64}$/.test(n)) out.push({ media: `vol/${n.replace(/ /g, '_')}`, root: join(b, n) })
    }
  }
  return out
}

async function listRemovable(): Promise<RemovableFile[]> {
  const out: RemovableFile[] = []
  const walk = async (base: string, rel: string, media: string, depth: number): Promise<void> => {
    if (depth > 4 || out.length >= 500) return
    for (const e of await readdir(join(base, rel), { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.name.startsWith('$') || e.isSymbolicLink()) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(base, r, media, depth + 1)
      else if (e.isFile()) {
        const st = await stat(join(base, r)).catch(() => null)
        if (st && st.size <= MAX_FILE_BYTES) out.push({ media, path: r, sizeBytes: st.size })
      }
      if (out.length >= 500) return
    }
  }
  for (const v of await removableRoots()) await walk(v.root, '', v.media, 0)
  return out
}

// ------------------------------------------------------------------ HTTP

function requireUnlocked(): EncryptedFiles {
  if (!master || !files) throw Object.assign(new Error('Bóveda bloqueada'), { status: 423 })
  return files
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://vault')
  const p = url.pathname
  const m = req.method ?? 'GET'

  if (m === 'GET' && p === '/health') return send(res, 200, { status: 'ok', service: 'vault-portable', version: VERSION })
  if (m === 'GET' && p === '/status') return send(res, 200, await status())

  const keyed = ['/setup', '/unlock', '/recover', '/recovery-key', '/discard']
  if (m === 'POST' && keyed.includes(p)) {
    if (busy) return send(res, 409, { error: 'Operación en curso' })
    busy = true
    try {
      const b = await readJson(req)
      const h = await readHeader()
      if (p === '/setup') {
        if (h) return send(res, 409, { error: 'La bóveda ya existe' })
        const pass = typeof b.passphrase === 'string' ? b.passphrase : ''
        const problem = passphraseProblem(pass)
        if (problem) return send(res, 400, { error: problem })
        await mkdir(DIR, { recursive: true, mode: 0o700 })
        const key = randomBytes(32)
        const recoveryKey = formatRecoveryKey(randomBytes(20))
        const header: Header = {
          format: 'survival-vault-portable',
          version: 1,
          createdAt: new Date().toISOString(),
          kdf: { alg: 'argon2id', ...KDF },
          slots: [await makeSlot(key, pass, 'passphrase'), await makeSlot(key, recoveryKey, 'recovery')],
        }
        await new EncryptedFiles(DIR, key).init()
        await writeHeader(header)
        key.fill(0)
        await clearFailures()
        log('info', 'setup_done')
        const out: VaultRecoveryKeyResult = { ...(await status()), newRecoveryKey: recoveryKey }
        return send(res, 200, out)
      }
      if (!h) return send(res, 404, { error: 'Bóveda no configurada' })
      if (p === '/discard') {
        if (b.confirm !== 'DESCARTAR') return send(res, 400, { error: 'Falta la confirmación' })
        if (master) return send(res, 409, { error: 'Bloquea la bóveda antes de descartarla' })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await rename(DIR, `${DIR}.descartada-${stamp}`)
        await clearFailures()
        log('warn', 'vault_discarded')
        return send(res, 200, await status())
      }
      const wait = retryAfter(attempts.failures, attempts.lastFailureAt, Date.now())
      if (wait > 0) return send(res, 429, { error: `Demasiados intentos. Espera ${wait} s`, retryAfterSeconds: wait })

      if (p === '/unlock') {
        if (master) {
          touch()
          return send(res, 200, await status())
        }
        const found = await findSlot(h, typeof b.passphrase === 'string' ? b.passphrase : '')
        if (!found) return send(res, 401, { error: 'Contraseña incorrecta', ...(await registerFailure()) })
        master = found.master
        files = new EncryptedFiles(DIR, master)
        await files.init()
        await clearFailures()
        touch()
        log('info', 'unlocked')
        return send(res, 200, await status())
      }
      if (p === '/recover') {
        const rk = normalizeRecoveryKey(b.recoveryKey)
        const next = typeof b.newPassphrase === 'string' ? b.newPassphrase : ''
        const problem = passphraseProblem(next)
        if (problem) return send(res, 400, { error: problem })
        const recSlots = h.slots.filter((s) => s.kind === 'recovery')
        const found = rk ? await findSlot({ ...h, slots: recSlots }, rk) : null
        if (!found) return send(res, 401, { error: 'Clave de recuperación incorrecta', ...(await registerFailure()) })
        const pass = await makeSlot(found.master, next, 'passphrase')
        found.master.fill(0)
        // La contraseña olvidada deja de valer; la clave de recuperación se conserva.
        await writeHeader({ ...h, slots: [pass, ...recSlots] })
        await clearFailures()
        log('info', 'passphrase_recovered')
        return send(res, 200, await status())
      }
      // /recovery-key: crear o regenerar con la contraseña actual.
      const pass = typeof b.passphrase === 'string' ? b.passphrase : ''
      if (normalizeRecoveryKey(pass)) return send(res, 400, { error: 'Escribe la contraseña, no la clave de recuperación' })
      const passSlots = h.slots.filter((s) => s.kind === 'passphrase')
      const found = pass ? await findSlot({ ...h, slots: passSlots }, pass) : null
      if (!found) return send(res, 401, { error: 'Contraseña incorrecta', ...(await registerFailure()) })
      const recoveryKey = formatRecoveryKey(randomBytes(20))
      const rec = await makeSlot(found.master, recoveryKey, 'recovery')
      found.master.fill(0)
      await writeHeader({ ...h, slots: [...passSlots, rec] })
      await clearFailures()
      log('info', 'recovery_key_rotated')
      const out: VaultRecoveryKeyResult = { ...(await status()), newRecoveryKey: recoveryKey }
      return send(res, 200, out)
    } finally {
      busy = false
    }
  }

  if (m === 'POST' && p === '/lock') {
    lock('usuario')
    return send(res, 200, await status())
  }
  if (m === 'POST' && p === '/touch') {
    touch()
    return send(res, 200, await status())
  }
  if (p === '/files' && m === 'GET') {
    const f = requireUnlocked()
    touch()
    return send(res, 200, await f.list())
  }
  if (p === '/files' && m === 'POST') {
    const f = requireUnlocked()
    touch()
    const file = await f.add(req, {
      name: url.searchParams.get('name') ?? 'documento',
      tags: (url.searchParams.get('tags') ?? '').split(',').filter(Boolean),
      reviewDate: url.searchParams.get('review'),
    })
    log('info', 'file_added', { bytes: file.sizeBytes })
    return send(res, 201, file)
  }
  const fm = /^\/files\/([0-9a-f-]{36})(\/raw)?$/.exec(p)
  if (fm) {
    const f = requireUnlocked()
    touch()
    const id = fm[1] ?? ''
    if (m === 'DELETE') return send(res, (await f.remove(id)) ? 200 : 404, { ok: true })
    if (m === 'PATCH') {
      const updated = await f.update(id, await readJson(req))
      return updated ? send(res, 200, updated) : send(res, 404, { error: 'not_found' })
    }
    if (m === 'GET' && fm[2]) {
      const opened = await f.open(id)
      if (!opened) return send(res, 404, { error: 'not_found' })
      res.writeHead(200, {
        'content-type': opened.file.mime,
        'content-length': opened.file.sizeBytes,
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
      })
      opened.stream.on('error', () => res.destroy()) // bloque manipulado: se corta, nunca se sirve a medias
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
    const f = requireUnlocked()
    touch()
    const b = await readJson(req)
    const media = typeof b.media === 'string' ? b.media : ''
    const rel = typeof b.path === 'string' ? b.path : ''
    const vol = (await removableRoots()).find((v) => v.media === media)
    if (!vol || !safeRelative(rel)) return send(res, 400, { error: 'Ruta no válida' })
    const full = join(vol.root, rel)
    const st = await lstat(full).catch(() => null)
    if (!st?.isFile()) return send(res, 404, { error: 'Fichero no encontrado' })
    const file = await f.add(createReadStream(full), { name: rel.split('/').pop() ?? 'documento' })
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
  await mkdir(dirname(DIR), { recursive: true })
  await loadAttempts()
  if (process.platform !== 'win32' && existsSync(SOCKET)) await rm(SOCKET, { force: true })
  server.listen(SOCKET, () => log('info', 'listening', { socket: SOCKET, version: VERSION, autoLockSeconds: AUTO_LOCK_S }))
}

const shutdown = (): void => {
  lock('parada del servicio')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
void main()
