import { locale, syncLocaleCookie } from '~/utils/i18n'

/**
 * Idioma de la interfaz: atributo lang del documento (lectores de pantalla, guiones, ortografía) y cookie
 * `survival-lang`, que el navegador envía en todas las peticiones; el servidor web la pasa a los servicios
 * (protocolos, catálogo de contenidos, asistente). Cambiar de idioma recarga la app (setLocale).
 */
export default defineNuxtPlugin({
  name: 'survival-i18n',
  enforce: 'pre',
  setup() {
    syncLocaleCookie()
    useHead({ htmlAttrs: { lang: locale.value } })
  },
})
