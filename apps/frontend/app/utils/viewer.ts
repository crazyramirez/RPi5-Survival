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
  // La pista lleva el color real de la página junto a la barra (--survival-track, lo calcula
  // syncDocScrollbar): transparente dejaría ver el fondo del iframe, una franja de otro tono.
  '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:var(--survival-track,transparent)}' +
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
  syncDocScrollbar(doc)
}

function opaque(bg: string): boolean {
  if (!bg || bg === 'transparent') return false
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1]
  return alpha === undefined || Number(alpha) > 0.5
}

/**
 * Color de fondo que se ve junto al borde derecho de la página (donde va la barra). Muchas páginas (Wikipedia)
 * dejan html y body transparentes y pintan el fondo en capas internas: se sube desde el elemento de esa zona
 * hasta el primero opaco.
 */
export function pageEdgeBackground(doc: Document): string | null {
  const win = doc.defaultView
  if (!win || !doc.body) return null
  const probes = [0.25, 0.5, 0.75].map((f) => doc.elementFromPoint(Math.max(0, win.innerWidth - 24), win.innerHeight * f))
  for (const start of probes) {
    for (let el: Element | null = start; el; el = el.parentElement) {
      const bg = win.getComputedStyle(el).backgroundColor
      if (opaque(bg)) return bg
    }
  }
  for (const el of [doc.body, doc.documentElement]) {
    const bg = win.getComputedStyle(el).backgroundColor
    if (opaque(bg)) return bg
  }
  return null
}

/**
 * Ajusta la pista de la barra al fondo de la página. `inverted`: la página se muestra con el filtro del modo
 * noche (sus colores calculados no son los que se ven): su fondo visible es el del html en noche (#1a1a1a).
 */
export function syncDocScrollbar(doc: Document | null | undefined, inverted = false): void {
  const root = doc?.documentElement
  if (!doc || !root) return
  const color = inverted ? '#1a1a1a' : pageEdgeBackground(doc)
  if (color) root.style.setProperty('--survival-track', color)
  else root.style.removeProperty('--survival-track')
}

