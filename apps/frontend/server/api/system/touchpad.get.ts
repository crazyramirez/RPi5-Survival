import { promises as fs } from 'node:fs'
import type { TouchpadSettings } from '@survival-os/shared-types'
import { isPortable } from '../../utils/portable'

const STATE = process.env.SURVIVAL_KIOSK_STATE ?? '/run/survival-os/kiosk'

/**
 * Dirección del desplazamiento del trackpad tal como está en labwc: la publica el agente del quiosco
 * (scripts/kiosk-input.py) leyendo su rc.xml, porque la web no puede leer la carpeta del usuario de escritorio.
 */
export default defineEventHandler(async (): Promise<TouchpadSettings> => {
  if (isPortable() || process.platform !== 'linux') return { touchpadScroll: null, updatedAt: null }
  try {
    const raw = JSON.parse(await fs.readFile(`${STATE}/input.json`, 'utf8')) as Partial<TouchpadSettings>
    const scroll = raw.touchpadScroll === 'natural' || raw.touchpadScroll === 'traditional' ? raw.touchpadScroll : null
    return { touchpadScroll: scroll, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null }
  } catch {
    return { touchpadScroll: null, updatedAt: null }
  }
})
