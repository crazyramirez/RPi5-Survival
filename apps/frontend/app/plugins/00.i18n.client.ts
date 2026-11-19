import { isLocale, locale, setLocale, syncLocaleCookie } from '~/utils/i18n'

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
    useHead({ htmlAttrs: { lang: locale.value === 'zh' ? 'zh-Hans' : locale.value } })
    // Idioma por defecto del EQUIPO (npm run express -- defaults, o un agente LLM): solo si nadie ha elegido
    // uno en este navegador. Se guarda y se recarga una vez, sin bucles.
    let saved: string | null = null
    try {
      saved = localStorage.getItem('survival-os:locale')
    } catch {
      return
    }
    if (saved) return
    void $fetch<{ locale: string | null }>('/api/settings/defaults', { timeout: 5000, retry: 0 })
      .then((d) => {
        if (isLocale(d.locale) && d.locale !== locale.value) setLocale(d.locale)
      })
      .catch(() => undefined)
  },
})
