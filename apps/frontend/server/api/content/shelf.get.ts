import type { LibraryShelfMap } from '@survival-os/shared-types'
import { libraryShelf } from '../../utils/content'
import { requestLang } from '../../utils/lang'

/** Organización de la biblioteca por categorías (solo lee el catálogo: sin disco ni red). */
export default defineEventHandler(async (event): Promise<LibraryShelfMap> => await libraryShelf(requestLang(event)))
