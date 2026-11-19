import type { H3Event } from 'h3'

export type Lang = 'es' | 'en' | 'fr' | 'it' | 'de' | 'zh' | 'ja'
export const LANGS: readonly Lang[] = ['es', 'en', 'fr', 'it', 'de', 'zh', 'ja']
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)

/**
 * Idioma de la interfaz que hace la petición. La app lo guarda en la cookie `survival-lang` (la envía el
 * navegador en todas las peticiones, también desde iframes y fetch nativo); la cabecera `x-survival-lang`
 * tiene prioridad (clientes que no usan cookies). Español si no viene o no es válido.
 */
export function requestLang(event: H3Event): Lang {
  const v = getHeader(event, 'x-survival-lang') ?? getCookie(event, 'survival-lang')
  return isLang(v) ? v : 'es'
}
