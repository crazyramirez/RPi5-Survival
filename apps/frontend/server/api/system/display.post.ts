import { assertLinux, assertTrustedAction, sendKioskCommand } from '../../utils/system'

/** Apaga la salida HDMI; el siguiente toque la reactiva (agente del kiosco + swayidle). */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertLinux()
  const ok = await sendKioskCommand('display-off')
  if (!ok) throw createError({ statusCode: 503, statusMessage: 'Agente del kiosco no disponible' })
  return { accepted: true }
})
