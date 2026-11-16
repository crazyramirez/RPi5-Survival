import type { ContentOverview } from '@survival-os/shared-types'
import { contentOverview } from '../../utils/content'
import { requestLang } from '../../utils/lang'

/** Catálogo de descargas + estado real en disco + espacio libre + estado del asistente inicial. */
export default defineEventHandler(async (event): Promise<ContentOverview> => await contentOverview(requestLang(event)))
