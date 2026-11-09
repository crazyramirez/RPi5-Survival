import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { AdminJob, AdminJobStatus } from '@survival-os/shared-types'

export const ADMIN_DIR = process.env.SURVIVAL_ADMIN_DIR ?? '/run/survival-os/admin'

const MEDIA_RE = /^[\w.-]{1,64}\/[^/\0]{1,128}$/

function bad(msg: string): never {
  throw createError({ statusCode: 400, statusMessage: msg })
}

const media = (m: unknown): string => {
  if (typeof m !== 'string' || !MEDIA_RE.test(m) || m.split('/').includes('..')) bad('Medio no válido')
  return m
}

const rel = (p: unknown): string => {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || p.startsWith('/') || p.split('/').includes('..') || p.includes('\0')) {
    bad('Ruta no válida')
  }
  return p
}

/**
 * Validación previa (la definitiva la hace admin-job.py como root). Devuelve solo los campos
 * conocidos: nada del cuerpo original pasa sin filtrar.
 */
export const ADMIN_JOBS: Record<AdminJob, (b: Record<string, unknown>) => Record<string, unknown>> = {
  'usb-scan': () => ({}),
  'maps-import': (b) => ({ media: media(b.media), path: rel(b.path) }),
  'maps-delete': (b) => {
    if (typeof b.file !== 'string' || !/^[A-Za-z0-9_-]{1,80}\.pmtiles$/.test(b.file)) bad('Mapa no válido')
    return { file: b.file }
  },
  'docs-import': (b) => {
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 200) bad('Selección no válida')
    return { items: (b.items as { media?: unknown; path?: unknown }[]).map((i) => ({ media: media(i?.media), path: rel(i?.path) })) }
  },
  'content-fetch': (b) => {
    if (!['basico', 'recomendado', 'completo'].includes(String(b.preset))) bad('Paquete no válido')
    return { preset: b.preset }
  },
  'content-delete': (b) => {
    if (typeof b.file !== 'string' || !/^[a-z0-9_]+_\d{4}-\d{2}\.zim$/.test(b.file)) bad('ZIM no válido')
    return { file: b.file }
  },
  backup: (b) => ({ media: media(b.media), withMaps: b.withMaps === true, withZim: b.withZim === true }),
  update: (b) => ({ media: media(b.media), path: rel(b.path) }),
  'gps-uart': (b) => {
    if (b.action === 'disable') return { action: 'disable' }
    if (b.action !== 'enable') bad('Acción no válida')
    const baud = Number(b.baud ?? 9600)
    if (![4800, 9600, 19200, 38400, 57600, 115200].includes(baud)) bad('Baudios no válidos')
    const pps = b.pps === null || b.pps === undefined ? null : Number(b.pps)
    if (pps !== null && (!Number.isInteger(pps) || pps < 2 || pps > 27)) bad('GPIO PPS no válido')
    return { action: 'enable', baud, pps }
  },
  'set-time': (b) => {
    if (typeof b.iso !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(b.iso)) bad('Fecha no válida')
    return { iso: b.iso }
  },
  'restart-app': () => ({}),
  /** Comprobar la hora sin red ya (survival-timesync, ADR 0011). */
  'time-sync': () => ({}),
  llm: (b) => {
    if (b.action === 'disable') return { action: 'disable' }
    if (b.action !== 'install' && b.action !== 'remove') bad('Acción no válida')
    if (!['qwen3-4b', 'gemma3-4b', 'llama3.2-3b'].includes(String(b.model))) bad('Modelo no válido')
    return { action: b.action, model: b.model }
  },
  wifi: (b) => {
    if (b.state !== 'on' && b.state !== 'off') bad('Estado no válido')
    return { state: b.state }
  },
  /** Rutas sin conexión (ADR 0010): instalar regiones o quitar los datos. */
  routing: (b) => {
    if (b.action === 'remove') return { action: 'remove' }
    if (b.action !== 'install') bad('Acción no válida')
    const regions = Array.isArray(b.regions) ? [...new Set(b.regions.map(String))] : []
    if (!regions.length || regions.some((r) => !['espana', 'canarias'].includes(r))) bad('Regiones no válidas')
    return { action: 'install', regions }
  },
  /** Punto de acceso Wi-Fi local (ADR 0009). La contraseña nueva la genera el equipo, nunca la web. */
  ap: (b) => {
    if (!['on', 'off', 'status', 'password'].includes(String(b.action))) bad('Acción no válida')
    return { action: b.action }
  },
  /** Pasarela Meshtastic (nodo LoRa por USB). */
  mesh: (b) => {
    if (b.action === 'scan' || b.action === 'remove') return { action: b.action }
    if (b.action !== 'install' && b.action !== 'port') bad('Acción no válida')
    if (typeof b.port !== 'string' || !/^\/dev\/serial\/by-id\/[A-Za-z0-9_.:+-]{1,200}$/.test(b.port)) bad('Puerto no válido')
    return { action: b.action, port: b.port }
  },
}

export function isAdminJob(job: string): job is AdminJob {
  return Object.hasOwn(ADMIN_JOBS, job)
}

function systemctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('systemctl', args, { timeout: 10_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message))) : resolve(String(stdout)),
    ),
  )
}

const unitOf = (job: AdminJob): string => `survival-admin@${job}.service`

export async function startJob(job: AdminJob, params: Record<string, unknown>): Promise<void> {
  if (process.platform !== 'linux') throw createError({ statusCode: 501, statusMessage: 'Solo disponible en el equipo' })
  const st = await jobStatus(job)
  if (st.state === 'active' || st.state === 'activating') throw createError({ statusCode: 409, statusMessage: 'La tarea ya está en curso' })
  // Temporal + rename: sustituye el fichero aunque el anterior sea de otro usuario (p. ej. root tras una
  // prueba manual), porque el directorio es del grupo survival. Un writeFile directo daría EACCES → 500.
  const target = `${ADMIN_DIR}/${job}.json`
  const tmp = `${target}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(params), { mode: 0o640 })
  await fs.rename(tmp, target)
  try {
    await systemctl(['start', '--no-block', unitOf(job)])
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: `No se pudo lanzar la tarea: ${err instanceof Error ? err.message.slice(0, 120) : ''}` })
  }
}

export async function stopJob(job: AdminJob): Promise<void> {
  await systemctl(['stop', '--no-block', unitOf(job)])
}

/** "Sun 2026-11-08 20:54:39 CET" → ISO. */
function parseSystemdTime(v: string | undefined): string | null {
  if (!v) return null
  const m = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(v)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function jobStatus(job: AdminJob): Promise<AdminJobStatus> {
  let kv: Record<string, string> = {}
  try {
    const out = await systemctl(['show', '-p', 'ActiveState,Result,ExecMainStartTimestamp,ExecMainExitTimestamp', unitOf(job)])
    kv = Object.fromEntries(
      out
        .trim()
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
  } catch {
    // systemd no disponible (desarrollo)
  }
  const raw = await fs.readFile(`${ADMIN_DIR}/${job}.log`, 'utf8').catch(() => '')
  // curl reescribe la línea de progreso con \r: se conserva solo el último estado de cada línea.
  const log = raw
    .split('\n')
    .map((l) => l.split('\r').filter(Boolean).pop() ?? '')
    .filter(Boolean)
    .slice(-40)
  let data: unknown = null
  // Tareas que devuelven datos (`ap` incluye la contraseña del AP: /api/admin es solo loopback).
  if (job === 'usb-scan' || job === 'ap' || job === 'mesh' || job === 'time-sync') {
    try {
      data = JSON.parse(await fs.readFile(`${ADMIN_DIR}/${job}.result.json`, 'utf8')) as unknown
    } catch {
      data = null
    }
  }
  const known = ['inactive', 'activating', 'active', 'deactivating', 'failed']
  return {
    job,
    state: (known.includes(kv.ActiveState ?? '') ? kv.ActiveState : 'unknown') as AdminJobStatus['state'],
    result: kv.Result || null,
    startedAt: parseSystemdTime(kv.ExecMainStartTimestamp),
    finishedAt: parseSystemdTime(kv.ExecMainExitTimestamp),
    log,
    data,
  }
}
