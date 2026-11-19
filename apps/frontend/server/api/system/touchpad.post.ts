import { assertLinux, assertTrustedAction, sendKioskCommand } from '../../utils/system'

/** Cambia la dirección del desplazamiento del trackpad (agente del quiosco → labwc). */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertLinux()
  const body = (await readBody<{ touchpadScroll?: unknown }>(event).catch(() => null)) ?? {}
  const mode = body.touchpadScroll
  if (mode !== 'natural' && mode !== 'traditional') throw createError({ statusCode: 400, statusMessage: 'Acción no válida' })
  const ok = await sendKioskCommand(`touchpad-scroll ${mode}`)
  if (!ok) throw createError({ statusCode: 503, statusMessage: 'Agente del kiosco no disponible' })
  return { accepted: true }
})
