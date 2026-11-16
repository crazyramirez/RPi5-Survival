import type { ContentCatalogItem } from '@survival-os/shared-types'
import { contentLangs, inLanguage, topicOf, type ContentLang } from './content'

/**
 * Recomendaciones por interés (bienvenida): para cada tema, lo más destacado del catálogo elegido por su
 * contenido (lo que de verdad se consulta en una emergencia o resuelve el problema), no por su tamaño.
 * Las listas usan el tema (id del contenido en español): se resuelve al mejor idioma del usuario y lo que
 * no exista en un idioma que entienda se omite. `@maps` y `@assistant` son los del país y el modelo que
 * cabe en la memoria del equipo, tal como los calcula el plan recomendado.
 */
export const INTERESTS = {
  salud: [
    'hesperian-donde-no-hay-doctor', 'oms-atencion-basica-emergencia', 'wikipedia-medicina', 'medlineplus',
    'msf-medicamentos-esenciales', 'cicr-primeros-auxilios-conflictos', 'oms-primera-ayuda-psicologica',
    'msf-clinical-guidelines-en', 'military-medicine', 'hesperian-donde-no-hay-doctor-mujeres', 'hesperian-donde-no-hay-dentista',
  ],
  emergencias: [
    'ready-gov', 'zimgit-post-disaster', 'pc-guia-autoproteccion', 'guia-familias-autoproteccion-2025', 'pc-guia-inundaciones',
    'pc-guia-fenomenos-meteorologicos', 'ign-terremoto-tsunami', 'pc-guia-riesgo-quimico-nuclear', 'atp-3-50-21-survival', 'ifrc-kit-alojamiento',
  ],
  agua: [
    'zimgit-water', 'ops-wash-tratamiento-agua', 'ifrc-tratamiento-agua-hogar-emergencias', 'fao-captacion-agua-lluvia', 'zimgit-food',
    'fao-una-huerta-para-todos', 'fao-conservacion-frutas-hortalizas', 'fao-silos-metalicos-familiares', 'fao-avicultura-familiar',
  ],
  oficios: ['ifixit', 'lowtech', 'appropedia', 'energypedia', 'mechanics-qa', 'sustainability-qa'],
  orientacion: [
    '@maps', 'mapa-mundo', 'scouts-manual-orientacion', 'fm-3-25-26-land-navigation', 'scouts-manual-cabuyeria',
    'zimgit-knots', 'scoutwiki', 'outdoors-qa', 'wikivoyage',
  ],
  radio: ['iaru-guia-telecom-emergencia', 'ure-manual-control-red', 'ham-qa'],
  saber: ['wikipedia', 'wiktionary', 'wikivoyage'],
  aprender: ['gutenberg', 'wikibooks', 'wikiversity', 'phet'],
  asistente: ['@assistant'],
  juegos: ['juegos'],
} as const satisfies Record<string, readonly string[]>

export type Interest = keyof typeof INTERESTS
export const INTEREST_IDS = Object.keys(INTERESTS) as Interest[]

/**
 * Lo destacado de los intereses elegidos, sin repetir y sin lo que no se puede marcar (instalado o en curso).
 * `items`: catálogo visible (con el mapa del país); `plan`: el plan recomendado, para mapas y asistente.
 */
export function recommend(
  interests: Iterable<Interest>,
  items: ContentCatalogItem[],
  plan: ContentCatalogItem[],
  ui: ContentLang,
  blocked: Set<string> = new Set(),
): ContentCatalogItem[] {
  const langs = contentLangs(ui)
  const rank = (i: ContentCatalogItem): number => (langs.includes(i.lang) ? langs.indexOf(i.lang) : i.lang === 'mul' ? 0 : 99)
  const out = new Map<string, ContentCatalogItem>()
  const add = (i: ContentCatalogItem | undefined): void => {
    if (i && !blocked.has(i.id)) out.set(i.id, i)
  }
  for (const interest of interests) {
    for (const topic of INTERESTS[interest]) {
      if (topic === '@maps') plan.filter((i) => i.kind === 'maps' || i.kind === 'routing').forEach(add)
      else if (topic === '@assistant') plan.filter((i) => i.kind === 'llm').forEach(add)
      else add(items.filter((i) => topicOf(i) === topic && inLanguage(i, ui)).sort((a, b) => rank(a) - rank(b))[0])
    }
  }
  return [...out.values()]
}
