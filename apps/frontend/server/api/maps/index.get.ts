import { listMaps } from '../../utils/maps'

/** Paquetes cartográficos instalados (sin datos inventados: lista vacía si no hay ninguno). */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return await listMaps()
})
