import type { UpdateMode, UpdateStatus } from '@survival-os/shared-types'
import { assertTrustedAction } from '../../utils/system'
import { updateStatus, writeMode } from '../../utils/update'

/** Modo de actualización (auto | notify | off). Elegir «auto» en la Pi es la autorización del usuario (ADR 0021). */
export default defineEventHandler(async (event): Promise<UpdateStatus> => {
  assertTrustedAction(event)
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as { mode?: unknown }
  await writeMode(String(body.mode) as UpdateMode)
  return await updateStatus(useRuntimeConfig(event).public.version as string, String(getQuery(event).lang ?? 'es'))
})
