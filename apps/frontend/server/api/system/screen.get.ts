import { promises as fs } from 'node:fs'
import { isPortable } from '../../utils/portable'

const KIOSK_ENV = process.env.SURVIVAL_KIOSK_ENV ?? '/etc/survival-os/kiosk.env'

/**
 * Segundos sin tocar tras los que el quiosco apaga la pantalla (SCREEN_OFF_SECONDS, 600 por defecto como en
 * kiosk.sh). La interfaz lo usa para que el toque que la enciende no pulse nada. 0: nunca se apaga o no hay quiosco.
 */
export default defineEventHandler(async () => {
  if (isPortable() || process.platform !== 'linux') return { offAfterSeconds: 0 }
  const env = await fs.readFile(KIOSK_ENV, 'utf8').catch(() => null)
  if (env === null) return { offAfterSeconds: 0 }
  const m = /^\s*SCREEN_OFF_SECONDS\s*=\s*["']?(\d{1,6})["']?\s*$/m.exec(env)
  return { offAfterSeconds: m ? Number(m[1]) : 600 }
})
