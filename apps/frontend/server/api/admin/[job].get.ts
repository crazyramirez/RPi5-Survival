import { isAdminJob, jobStatus } from '../../utils/admin'

export default defineEventHandler(async (event) => {
  const job = getRouterParam(event, 'job') ?? ''
  if (!isAdminJob(job)) throw createError({ statusCode: 404 })
  setResponseHeader(event, 'cache-control', 'no-store')
  return await jobStatus(job)
})
