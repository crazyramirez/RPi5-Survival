import { ADMIN_JOBS, isAdminJob, jobStatus, startJob, stopJob } from '../../utils/admin'
import { isPortable } from '../../utils/portable'
import { portableSupports } from '../../utils/portable-jobs'
import { assertTrustedAction } from '../../utils/system'

/** Lanza (o detiene con ?stop=1) una tarea de mantenimiento. Solo loopback + cabecera de acción. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  const job = getRouterParam(event, 'job') ?? ''
  if (!isAdminJob(job)) throw createError({ statusCode: 404 })
  // Portable: solo las tareas que sabe ejecutar sin systemd (el resto se van añadiendo, ADR 0014/0015).
  if (isPortable() && !portableSupports(job)) throw createError({ statusCode: 409, statusMessage: 'No disponible en la versión portable' })
  // Preparar otra memoria USB con la versión portable (ADR 0019): solo tiene sentido desde la portable.
  if (!isPortable() && job === 'usb-prepare') throw createError({ statusCode: 409, statusMessage: 'Solo en la versión portable' })
  if (getQuery(event).stop === '1') {
    await stopJob(job)
    return await jobStatus(job)
  }
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as Record<string, unknown>
  await startJob(job, ADMIN_JOBS[job](body))
  return await jobStatus(job)
})
