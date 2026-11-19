import type { AndroidAction } from '@survival-os/shared-types'
import { androidBridge, isAndroid } from '../../utils/android'
import { assertTrustedAction } from '../../utils/system'

const ACTIONS = new Set<AndroidAction>([
  'permission-location', 'permission-notifications', 'permission-files', 'permission-battery', 'permission-install', 'app-settings', 'storage', 'kiosk', 'install-update', 'bluetooth-settings',
])

/** Acciones que solo la app Android puede hacer (pedir un permiso, fijar la pantalla, cambiar la carpeta de datos). */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  if (!isAndroid()) throw createError({ statusCode: 404 })
  const body = (await readBody<{ action?: unknown; on?: unknown }>(event).catch(() => null)) ?? {}
  const action = body.action as AndroidAction
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw createError({ statusCode: 400, statusMessage: 'Acción no válida' })
  return await androidBridge('/app/action', { action, on: body.on === true })
})
