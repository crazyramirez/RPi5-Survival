import type { AndroidStatus } from '@survival-os/shared-types'
import { androidBridge, isAndroid } from '../../utils/android'

/** Estado de la app Android (ADR 0020): modelo, carpeta de datos, permisos y pantalla fijada. */
export default defineEventHandler(async (): Promise<AndroidStatus> => {
  if (!isAndroid()) throw createError({ statusCode: 404 })
  return await androidBridge<AndroidStatus>('/app/status')
})
