import type { PortableUsbStatus } from '@survival-os/shared-types'
import { assertPortable, usbStatus } from '../../utils/portable'

/** Memoria USB (ADR 0019): desde dónde se ejecuta, «abrir al conectar» en este equipo y memorias para preparar. */
export default defineEventHandler(async (event): Promise<PortableUsbStatus> => {
  assertPortable()
  return await usbStatus(getQuery(event).refresh === '1')
})
