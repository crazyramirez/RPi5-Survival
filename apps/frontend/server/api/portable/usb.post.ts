import type { PortableUsbStatus } from '@survival-os/shared-types'
import { assertPortable, cleanMessages, currentVolume, loadAutoOpen, loadUsb, portablePaths, usbStatus } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

const MESSAGE_KEYS = ['title', 'ask', 'yes', 'no', 'connect'] as const

/**
 * «Abrir al conectar esta memoria» en este equipo (ADR 0019):
 *   enable  instala el vigilante por usuario (sin administrador) y empareja esta memoria
 *   disable la desempareja (sin memorias, se quita el vigilante)
 *   dismiss «No, gracias»: no volver a ofrecerlo en este equipo
 *   update  cambia el modo (preguntar / abrir directamente) o los textos (idioma)
 */
export default defineEventHandler(async (event): Promise<PortableUsbStatus> => {
  assertTrustedAction(event)
  assertPortable()
  const body = (await readBody<Record<string, unknown>>(event).catch(() => null)) ?? {}
  const action = String(body.action)
  if (!['enable', 'disable', 'dismiss', 'update'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Acción no válida' })
  const mode = body.mode === 'open' ? 'open' : 'ask'
  const messages = cleanMessages(body.messages, MESSAGE_KEYS)
  const v = await currentVolume(true)
  if (!v.removable || !v.mount) throw createError({ statusCode: 409, statusMessage: 'Survival OS no se ejecuta desde una memoria USB' })
  const { root } = portablePaths()
  const autoopen = await loadAutoOpen()
  try {
    if (action === 'enable') {
      // El identificador se crea ahora (con el permiso del usuario), en la raíz de la memoria.
      const id = v.id ?? (await loadUsb()).ensureVolumeId(v.mount)
      autoopen.enable({ root, volumeId: id, rel: v.rel ?? '.', mode, messages })
    } else if (action === 'disable') autoopen.disable({ root, volumeId: v.id })
    else if (action === 'dismiss') {
      const id = v.id ?? (await loadUsb()).ensureVolumeId(v.mount)
      autoopen.dismiss({ root, volumeId: id })
    } else autoopen.update({ root, volumeId: v.id, mode: body.mode === undefined ? undefined : mode, messages })
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message.slice(0, 200) : 'Error' })
  }
  return await usbStatus(true)
})
