import { writeSetup } from '../../utils/content'
import { assertTrustedAction } from '../../utils/system'

/** Asistente de primera puesta en marcha: se completó (con la selección) o se omitió. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  const b = (await readBody<{ state?: string; selection?: unknown }>(event).catch(() => null)) ?? {}
  if (b.state !== 'completed' && b.state !== 'skipped') throw createError({ statusCode: 400, statusMessage: 'Estado no válido' })
  const selection = Array.isArray(b.selection) ? b.selection.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,40}(:[a-z]{0,10})?$/.test(s)).slice(0, 100) : []
  await writeSetup(b.state, selection)
  return { ok: true }
})
