import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { UpdateKind, UpdateMode, UpdateStatus } from '@survival-os/shared-types'
import { isAndroid } from './android'
import { isPortable, portablePaths } from './portable'

/**
 * Actualizaciones desde GitHub Releases (ADR 0021): la web solo LEE el estado que escribe el motor
 * (scripts/update-engine.mjs, como root en la Pi) y guarda el modo elegido. Nunca se conecta a Internet: en la
 * Pi survival-web tiene IPAddressDeny=any; las comprobaciones las hacen las tareas update-online/update-auto.
 */
const MODES: readonly UpdateMode[] = ['auto', 'notify', 'off']
const LANGS = ['es', 'en', 'fr', 'it'] as const

export function updateKind(): UpdateKind {
  if (isPortable()) return isAndroid() ? 'android' : 'portable'
  if (process.platform === 'linux' && existsSync('/opt/survival-os/current/VERSION')) return 'system'
  return 'dev'
}

interface UpdateFiles {
  state: string
  settings: string
  /** Portable: resultado de apply-update.mjs y versión preparada en .update/. */
  lastApply: string | null
  ready: string | null
}

function updateFiles(kind: UpdateKind): UpdateFiles | null {
  if (kind === 'portable' || kind === 'android') {
    const { root, data } = portablePaths()
    const dir = join(data, 'update')
    return { state: join(dir, 'state.json'), settings: join(dir, 'settings.json'), lastApply: join(dir, 'last-apply.json'), ready: kind === 'portable' ? join(root, '.update', 'ready.json') : null }
  }
  if (kind === 'system') {
    return {
      state: join(process.env.SURVIVAL_UPDATE_DIR ?? '/var/lib/survival-os-update', 'state.json'),
      settings: process.env.SURVIVAL_UPDATE_SETTINGS ?? '/var/lib/survival-os/update-settings.json',
      lastApply: null,
      ready: null,
    }
  }
  return null
}

/** Mismo criterio que update-lib.mjs: la portable de escritorio se aplica al cerrar; Pi y Android avisan. */
export function defaultMode(kind: UpdateKind): UpdateMode {
  return kind === 'portable' ? 'auto' : 'notify'
}

async function readJson(file: string | null): Promise<Record<string, unknown> | null> {
  if (!file) return null
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function readMode(kind = updateKind()): Promise<UpdateMode> {
  const raw = await readJson(updateFiles(kind)?.settings ?? null)
  return MODES.includes(raw?.mode as UpdateMode) ? (raw!.mode as UpdateMode) : defaultMode(kind)
}

export async function writeMode(mode: UpdateMode): Promise<void> {
  const files = updateFiles(updateKind())
  if (!files) throw createError({ statusCode: 409, statusMessage: 'Sin instalación: no hay actualizaciones' })
  if (!MODES.includes(mode)) throw createError({ statusCode: 400, statusMessage: 'Modo no válido' })
  await fs.mkdir(join(files.settings, '..'), { recursive: true })
  const tmp = `${files.settings}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify({ mode })}\n`, { mode: 0o644 })
  await fs.rename(tmp, files.settings)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length <= 2000 ? v : null)
const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/
const ver = (v: unknown): string | null => (typeof v === 'string' && VERSION_RE.test(v) ? v : null)

function cmpVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  return 0
}

function pickNotes(notes: unknown, lang: string): string | null {
  if (!notes || typeof notes !== 'object') return null
  const n = notes as Record<string, unknown>
  return str(n[lang]) ?? str(n.es) ?? str(n.en) ?? str(Object.values(n)[0])
}

type LastInstall = UpdateStatus['lastInstall']
function lastInstallOf(v: unknown): LastInstall {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.ok !== 'boolean' || typeof o.at !== 'string') return null
  return { version: ver(o.version), ok: o.ok, message: str(o.message), at: o.at }
}

/** Estado para la tarjeta «Actualizaciones» y la barra (todo validado: el fichero lo escribe otro proceso). */
export async function updateStatus(installed: string, lang: string): Promise<UpdateStatus> {
  const kind = updateKind()
  const mode = await readMode(kind)
  const base: UpdateStatus = {
    kind, supported: kind !== 'dev', reason: kind === 'dev' ? 'dev' : null, installed, mode,
    checkedAt: null, okAt: null, error: null, status: null, latest: null, asset: null, downloaded: null, prepared: null, deferred: null, lastInstall: null,
  }
  const files = updateFiles(kind)
  if (!files) return base
  const [st, lastApply, ready] = await Promise.all([readJson(files.state), readJson(files.lastApply), readJson(files.ready)])
  const l = (LANGS as readonly string[]).includes(lang) ? lang : 'es'
  const latestRaw = st?.latest as Record<string, unknown> | undefined
  const latest = latestRaw && ver(latestRaw.version)
    ? { version: ver(latestRaw.version)!, date: str(latestRaw.date) ?? '', minFrom: ver(latestRaw.minFrom) ?? '0.0.0', notes: pickNotes(latestRaw.notes, l) }
    : null
  const STATUSES = ['up-to-date', 'available', 'newer-installed', 'no-asset', 'needs-step'] as const
  let status = STATUSES.includes(st?.status as (typeof STATUSES)[number]) ? (st!.status as UpdateStatus['status']) : null
  // Recién actualizada (el estado aún no se ha vuelto a comprobar): ya no hay nada «disponible».
  if (status === 'available' && latest && VERSION_RE.test(installed) && cmpVersions(latest.version, installed) <= 0) status = 'up-to-date'
  const assetRaw = st?.asset as Record<string, unknown> | undefined
  const errRaw = st?.error as Record<string, unknown> | null | undefined
  const dl = st?.download as Record<string, unknown> | undefined
  const def = st?.deferred as Record<string, unknown> | undefined
  const li = [lastInstallOf(st?.lastInstall), lastInstallOf(lastApply)].filter((x): x is NonNullable<LastInstall> => !!x)
  li.sort((a, b) => b.at.localeCompare(a.at))
  const isLatest = (v: unknown): boolean => !!latest && ver(v) === latest.version && status === 'available'
  return {
    ...base,
    checkedAt: str(st?.checkedAt),
    okAt: str(st?.okAt),
    error: errRaw && typeof errRaw.code === 'string' ? { code: errRaw.code.slice(0, 40), message: str(errRaw.message) ?? '' } : null,
    status,
    latest,
    asset: status === 'available' && assetRaw && typeof assetRaw.name === 'string' && typeof assetRaw.size === 'number' ? { name: assetRaw.name, size: assetRaw.size } : null,
    downloaded: dl && isLatest(dl.version) ? ver(dl.version) : null,
    prepared: ver(ready?.version),
    deferred: def && isLatest(def.version) && ['window', 'vault', 'busy'].includes(String(def.reason)) ? { version: ver(def.version)!, reason: def.reason as 'window' | 'vault' | 'busy' } : null,
    lastInstall: li[0] ?? null,
  }
}
