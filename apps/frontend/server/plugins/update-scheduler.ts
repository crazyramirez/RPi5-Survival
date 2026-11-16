import { startJob } from '../utils/admin'
import { isPortable } from '../utils/portable'
import { readMode } from '../utils/update'

/**
 * Portable (y Android): planificador de actualizaciones (ADR 0021), el equivalente de survival-update.timer de la
 * Pi. A los 3 minutos de arrancar y luego cada hora lanza la tarea update-auto, que según el modo comprueba (como
 * mucho cada 20 h), descarga y deja la versión lista para aplicarse al cerrar. Desactivada: ni se lanza.
 */
export default defineNitroPlugin(() => {
  if (!isPortable()) return
  const tick = async (): Promise<void> => {
    try {
      if ((await readMode()) === 'off') return
      await startJob('update-auto', {})
    } catch {
      // otra actualización en curso o sin red: en la siguiente vuelta
    }
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), 3600_000).unref()
  }, 180_000).unref()
})
