/**
 * Enlaces que NUNCA deben sacar al usuario de la app (kiosco sin barra del navegador): ventanas nuevas,
 * navegación de la ventana principal y documentos no HTML (PDF) se abren en el visor integrado /visor.
 */

/** Rutas de contenido local que el visor integrado sabe mostrar. */
export function isViewerPath(path: string): boolean {
  return /^\/(kiwix\/|api\/library\/docs\/\d+\/raw)/.test(path) && !path.startsWith('//') && !path.includes('\\')
}

/** ¿El enlace apunta a un documento que no es una página (PDF, imagen grande, descarga)? */
export function isDocumentLink(path: string): boolean {
  return /\.(pdf|epub|docx?|xlsx?|pptx?|odt|zip)(\?|#|$)/i.test(path)
}

/** URL del visor integrado para una ruta local. null si la ruta no es local o no es mostrable. */
export function viewerUrl(href: string, title: string | null, origin: string): string | null {
  let u: URL
  try {
    u = new URL(href, origin)
  } catch {
    return null
  }
  if (u.origin !== origin) return null
  const path = `${u.pathname}${u.search}${u.hash}`
  if (!isViewerPath(path)) return null
  const q = new URLSearchParams({ u: path })
  if (title) q.set('t', title.slice(0, 200))
  return `/visor?${q.toString()}`
}

/** Título legible de un enlace: su texto o el nombre del fichero. */
export function linkTitle(a: HTMLAnchorElement): string {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 200)
  try {
    return decodeURIComponent(new URL(a.href).pathname.split('/').pop() ?? '').slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Barra de desplazamiento de la app dentro de los documentos mostrados en iframe (artículos ZIM, páginas del
 * visor): píldora sin flechas sobre pista transparente, como en main.css (allí con variables del tema; aquí el
 * documento es ajeno y no las tiene). Sobre páginas claras, verde grisáceo oscuro; sobre oscuras y en modo
 * noche, claro. Al usarla, el acento. El modo noche filtra body, no la barra del viewport: no se invierte.
 */
export const DOC_SCROLLBAR_CSS =
  'html,body{scrollbar-width:auto!important;scrollbar-color:auto!important}' +
  '::-webkit-scrollbar{width:12px;height:12px;background:transparent}' +
  '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}' +
  '::-webkit-scrollbar-button{display:none}' +
  '::-webkit-scrollbar-thumb{min-height:40px;min-width:40px;border:3px solid transparent;border-radius:999px;' +
  'background:rgba(169,176,162,.45) padding-box}' +
  '::-webkit-scrollbar-thumb:hover{background-color:rgba(140,191,150,.75)}' +
  '::-webkit-scrollbar-thumb:active{background-color:#8cbf96}' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light])::-webkit-scrollbar-thumb,' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light]) ::-webkit-scrollbar-thumb' +
  '{background-color:rgba(47,61,54,.42)}' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light])::-webkit-scrollbar-thumb:hover,' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light]) ::-webkit-scrollbar-thumb:hover' +
  '{background-color:rgba(74,128,86,.8)}' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light])::-webkit-scrollbar-thumb:active,' +
  ':is(html[data-survival-light]:not(.survival-night),html[data-survival-page-light]) ::-webkit-scrollbar-thumb:active' +
  '{background-color:#4a8056}'

/** Aplica la barra de la app a un documento del mismo origen mostrado en un iframe. */
export function styleDocScrollbar(doc: Document | null | undefined, light: boolean): void {
  if (!doc?.head || doc.getElementById('survival-scrollbar')) return
  if (light) doc.documentElement.setAttribute('data-survival-page-light', '')
  const st = doc.createElement('style')
  st.id = 'survival-scrollbar'
  st.textContent = DOC_SCROLLBAR_CSS
  doc.head.appendChild(st)
}
