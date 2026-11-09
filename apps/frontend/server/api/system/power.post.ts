import { assertLinux, assertTrustedAction, systemctlPower } from '../../utils/system'

/**
 * Apagado/reinicio seguro. Solo loopback (middleware), cabecera de acción y
 * confirmación explícita en el cuerpo. Se responde antes de ejecutar para que
 * la UI pueda mostrar "Apagando…".
 */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  const body = await readBody<{ action?: string; confirm?: boolean }>(event)
  const action = body?.action
  if ((action !== 'poweroff' && action !== 'reboot') || body?.confirm !== true) {
    throw createError({ statusCode: 400, statusMessage: 'Acción no válida' })
  }
  assertLinux()
  setTimeout(() => {
    systemctlPower(action).catch((err: unknown) => {
      console.error(`[system] ${action} falló: ${err instanceof Error ? err.message : String(err)}`)
    })
  }, 1500)
  return { accepted: true, action }
})
