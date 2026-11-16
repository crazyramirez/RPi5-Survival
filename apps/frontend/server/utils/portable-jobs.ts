import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdminJob, AdminJobStatus } from '@survival-os/shared-types'
import { portablePaths } from './portable'

/**
 * Tareas de mantenimiento en la versión portable (ADR 0014/0015): sin systemd, el servidor web
 * lanza el mismo motor que la Pi como proceso hijo y expone el MISMO contrato (AdminJobStatus,
 * registro en <admin>/<tarea>.log), de modo que Mantenimiento y el asistente inicial no cambian.
 */
interface Running {
  child: ChildProcess | null
  startedAt: string
  finishedAt: string | null
  code: number | null
}
const jobs = new Map<AdminJob, Running>()

/** Tareas que la portable sabe ejecutar y cómo (argumentos del motor). */
function commandFor(job: AdminJob, params: Record<string, unknown>): { script: string; args: string[]; env?: Record<string, string> } | null {
  const { root } = portablePaths()
  const scripts = join(root, 'app', 'scripts')
  const engine = (args: string[]) => ({ script: join(scripts, 'content-engine.mjs'), args: [...args, '--profile', 'portable', '--root', root] })
  switch (job) {
    case 'content':
      return engine([String(params.action), ...(params.items as string[])])
    case 'llm':
      return params.action === 'disable' ? engine(['model', 'disable']) : engine(['model', String(params.action), String(params.model)])
    case 'routing':
      return params.action === 'remove'
        ? engine(['remove', 'rutas-espana', 'rutas-canarias'])
        : engine(['install', ...(params.regions as string[]).map((r) => `rutas-${r}`)])
    case 'content-delete':
      return engine(['zim-delete', String(params.file)])
    case 'maps-delete':
      return engine(['maps-delete', String(params.file)])
    case 'games':
      // Copia offline de los juegos (ADR 0012) con el mismo sincronizador en Node que la Pi.
      return { script: join(scripts, 'games-sync.mjs'), args: [params.action === 'remove' ? 'remove' : 'sync'], env: { GAMES_ROOT: join(portablePaths().data, 'games') } }
    // Memorias USB, importar, copias y actualizar: lo que en la Pi hace admin-job.py (portable-admin.mjs).
    case 'usb-scan':
    case 'maps-import':
    case 'docs-import':
    case 'backup':
    case 'update':
    case 'usb-prepare':
      return { script: join(scripts, 'portable-admin.mjs'), args: [job, JSON.stringify(params), '--root', root, '--admin', join(portablePaths().data, 'admin')] }
    default:
      return null
  }
}

const PORTABLE_JOBS = new Set<AdminJob>([
  'content', 'llm', 'routing', 'content-delete', 'maps-delete', 'mesh', 'games',
  'usb-scan', 'maps-import', 'docs-import', 'backup', 'update', 'restart-app', 'gps-uart', 'usb-prepare',
])

/**
 * Tareas internas (sin proceso): la malla la gestiona serial-hub (ADR 0016). Devuelven las líneas del
 * registro y el resultado que Mantenimiento/Malla esperan (mismo formato que admin-job.py en la Pi).
 */
async function inlineJob(job: AdminJob, params: Record<string, unknown>): Promise<{ log: string[]; data?: unknown } | null> {
  if (job === 'restart-app') {
    // El lanzador relanza cada servicio (como systemctl restart en la Pi).
    if (!process.send) throw new Error('Sin lanzador: no se puede reiniciar')
    process.send({ type: 'restart' })
    return { log: ['Reiniciando la aplicación…'] }
  }
  if (job === 'gps-uart') return gpsJob(params)
  if (job !== 'mesh') return null
  const base = process.env.NUXT_MESH_URL ?? 'http://127.0.0.1:8787'
  if (params.action === 'scan') {
    const r = (await (await fetch(`${base}/ports`, { signal: AbortSignal.timeout(15_000) })).json()) as {
      ports: { path: string; label: string }[]
      configured: { mesh: string | null }
    }
    const data = { ports: r.ports.map((p) => ({ path: p.path, device: p.label })), configured: r.configured.mesh, installed: true }
    return { log: [`${data.ports.length} puerto(s) serie encontrados`], data }
  }
  const mesh = params.action === 'remove' ? null : String(params.port)
  const res = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mesh }), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
  return { log: [mesh ? `Nodo configurado en ${mesh}; conectando…` : 'Malla desactivada'] }
}
export function portableSupports(job: AdminJob): boolean {
  return PORTABLE_JOBS.has(job)
}

export async function startPortableJob(job: AdminJob, params: Record<string, unknown>, adminDir: string): Promise<void> {
  const cur = jobs.get(job)
  if (cur?.code === null) throw createError({ statusCode: 409, statusMessage: 'La tarea ya está en curso' })
  mkdirSync(adminDir, { recursive: true })
  const startedAt = new Date().toISOString()
  try {
    const inline = await inlineJob(job, params)
    if (inline) {
      const stamp = new Date().toTimeString().slice(0, 8)
      writeFileSync(join(adminDir, `${job}.log`), inline.log.map((l) => `${stamp} ${l}\n`).join(''))
      if (inline.data !== undefined) writeFileSync(join(adminDir, `${job}.result.json`), JSON.stringify(inline.data))
      jobs.set(job, { child: null, startedAt, finishedAt: new Date().toISOString(), code: 0 })
      return
    }
  } catch (err) {
    writeFileSync(join(adminDir, `${job}.log`), `ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    jobs.set(job, { child: null, startedAt, finishedAt: new Date().toISOString(), code: 1 })
    return
  }
  const cmd = commandFor(job, params)
  if (!cmd || !existsSync(cmd.script)) throw createError({ statusCode: 409, statusMessage: 'No disponible en la versión portable' })
  const log = createWriteStream(join(adminDir, `${job}.log`), { flags: 'w' })
  log.write(`${new Date().toTimeString().slice(0, 8)} Inicio de «${job}»\n`)
  const child = spawn(process.execPath, [cmd.script, ...cmd.args], {
    env: { ...process.env, ...cmd.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const run: Running = { child, startedAt: new Date().toISOString(), finishedAt: null, code: null }
  jobs.set(job, run)
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  child.on('close', (code) => {
    run.code = code ?? 1
    run.finishedAt = new Date().toISOString()
    log.end(`${new Date().toTimeString().slice(0, 8)} ${run.code === 0 ? 'Terminado correctamente' : `ERROR: código ${run.code}`}\n`)
    // Actualización preparada y verificada: el lanzador la aplica y reabre Survival OS (como la Pi tras update).
    if (job === 'update' && run.code === 0) setTimeout(() => process.send?.({ type: 'update' }), 3000)
  })
  child.on('error', (err) => {
    run.code = 1
    run.finishedAt = new Date().toISOString()
    log.end(`ERROR: ${err.message}\n`)
  })
}

/**
 * GPS por USB (equivalente portable del GPS por GPIO de la Pi): serial-hub lo detecta solo; aquí se fija
 * a mano un puerto y velocidad, o se vuelve a la detección automática. Mismo resultado que la tarea mesh.
 */
async function gpsJob(params: Record<string, unknown>): Promise<{ log: string[]; data?: unknown }> {
  const base = process.env.NUXT_MESH_URL ?? 'http://127.0.0.1:8787'
  if (params.action === 'scan') {
    const r = (await (await fetch(`${base}/ports`, { signal: AbortSignal.timeout(15_000) })).json()) as {
      ports: { path: string; label: string }[]
      configured: { gps: string | null; gpsBaud?: number | null; mesh: string | null }
    }
    const data = { ports: r.ports.map((p) => ({ path: p.path, device: p.label })), configured: r.configured.gps, baud: r.configured.gpsBaud ?? null, mesh: r.configured.mesh }
    return { log: [`${data.ports.length} puerto(s) serie encontrados`], data }
  }
  const body = params.action === 'disable' ? { gps: null } : { gps: String(params.port ?? ''), gpsBaud: Number(params.baud) || 9600 }
  const res = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
  return { log: [body.gps ? `GPS configurado en ${body.gps} a ${body.gpsBaud} baudios` : 'GPS en detección automática'] }
}

export function stopPortableJob(job: AdminJob): void {
  const cur = jobs.get(job)
  if (cur?.child && cur.code === null) cur.child.kill()
}

/** Estado con los mismos valores que systemd (active/inactive/failed). */
export function portableJobState(job: AdminJob): Pick<AdminJobStatus, 'state' | 'result' | 'startedAt' | 'finishedAt'> {
  const cur = jobs.get(job)
  if (!cur) return { state: 'inactive', result: null, startedAt: null, finishedAt: null }
  if (cur.code === null) return { state: 'active', result: null, startedAt: cur.startedAt, finishedAt: null }
  return { state: cur.code === 0 ? 'inactive' : 'failed', result: cur.code === 0 ? 'success' : 'exit-code', startedAt: cur.startedAt, finishedAt: cur.finishedAt }
}
