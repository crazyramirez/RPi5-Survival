import type { ContentOverview } from '@survival-os/shared-types'
import { contentOverview } from '../../utils/content'

/** Catálogo de descargas + estado real en disco + espacio libre + estado del asistente inicial. */
export default defineEventHandler(async (): Promise<ContentOverview> => await contentOverview())
