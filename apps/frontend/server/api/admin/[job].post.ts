import { ADMIN_JOBS, isAdminJob, jobStatus, startJob, stopJob } from '../../utils/admin'
import { assertTrustedAction } from '../../utils/system'

/** Lanza (o detiene con ?stop=1) una tarea de mantenimiento. Solo loopback + cabecera de acción. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  const job = getRouterParam(event, 'job') ?? ''
  if (!isAdminJob(job)) throw createError({ statusCode: 404 })
  if (getQuery(event).stop === '1') {
    await stopJob(job)
    return await jobStatus(job)
  }
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as Record<string, unknown>
  await startJob(job, ADMIN_JOBS[job](body))
  return await jobStatus(job)
})
