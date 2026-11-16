import { countryOptions } from '../../utils/content'
import { requestLang } from '../../utils/lang'

/** Países para el buscador de mapas offline (ADR 0018), en el idioma de la interfaz. Sin red: datos locales. */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  return await countryOptions(requestLang(event))
})
