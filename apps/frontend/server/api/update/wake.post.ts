import { startJob } from '../../utils/admin'
import { assertTrustedAction } from '../../utils/system'
import { readMode } from '../../utils/update'

/** Como mucho una tarea por minuto aunque la pantalla vaya y venga (el motor, además, solo sale cada 10 min). */
const MIN_GAP_MS = 60_000
let lastAt = 0

/**
 * La app se acaba de abrir o volvió a primer plano (ADR 0021): si hay conexión, comprueba enseguida si hay versión
 * nueva (y en modo «Automática» la descarga). Desactivada: no se conecta. Sin red: no anota error. Es la propia
 * pantalla local quien lo pide; la web sigue sin salir a Internet: lo hace la tarea update-auto.
 */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  if ((await readMode()) === 'off') return { started: false, reason: 'off' }
  const now = Date.now()
  if (now - lastAt < MIN_GAP_MS) return { started: false, reason: 'recent' }
  lastAt = now
  try {
    await startJob('update-auto', { wake: true })
    return { started: true }
  } catch {
    // Otra tarea de actualización en curso, o fuera del equipo (desarrollo): no es un error para la pantalla.
    return { started: false, reason: 'busy' }
  }
})
