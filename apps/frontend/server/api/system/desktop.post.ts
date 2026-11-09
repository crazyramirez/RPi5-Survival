import { assertLinux, assertTrustedAction, sendKioskCommand } from '../../utils/system'

/** Cierra el kiosco y deja el escritorio. Se vuelve con el icono «Survival OS» del escritorio. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertLinux()
  const ok = await sendKioskCommand('exit-desktop')
  if (!ok) throw createError({ statusCode: 503, statusMessage: 'Agente del kiosco no disponible' })
  return { accepted: true }
})
