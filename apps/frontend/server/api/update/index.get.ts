import type { UpdateStatus } from '@survival-os/shared-types'
import { updateStatus } from '../../utils/update'

/** Estado de las actualizaciones desde GitHub (ADR 0021). `?lang=` elige el idioma de las notas. */
export default defineEventHandler(async (event): Promise<UpdateStatus> => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const lang = String(getQuery(event).lang ?? 'es')
  return await updateStatus(useRuntimeConfig(event).public.version as string, lang)
})
