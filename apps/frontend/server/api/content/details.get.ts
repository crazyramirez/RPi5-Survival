import type { ContentDetailsResponse } from '@survival-os/shared-types'
import { contentDetails } from '../../utils/content'
import { requestLang } from '../../utils/lang'

/** Fichas «Más información» de cada contenido del catálogo (sin Internet; se piden una vez, al abrir la primera). */
export default defineEventHandler(async (event): Promise<ContentDetailsResponse> => await contentDetails(requestLang(event)))
