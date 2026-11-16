import { readDefaults } from '../../utils/defaults'

/** Idioma y país por defecto del equipo (los usa la interfaz si el usuario no ha elegido otros). */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return await readDefaults()
})
