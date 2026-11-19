import type { ContentCatalogItem } from '@survival-os/shared-types'

/** Margen libre que se respeta siempre (registros, índices, actualizaciones). */
export const FREE_MARGIN = 2 * 1024 ** 3

/**
 * Ajusta la selección al espacio libre: si no cabe todo, desmarca primero lo de menor prioridad
 * (3 → 2) y, dentro de la misma prioridad, lo más grande. Nunca desmarca lo imprescindible (1):
 * si ni eso cabe, la interfaz lo avisa con «Faltan X».
 */
export function autoFit(items: ContentCatalogItem[], freeBytes: number | null): { keep: ContentCatalogItem[]; dropped: ContentCatalogItem[] } {
  if (freeBytes == null) return { keep: items, dropped: [] }
  const keep = [...items]
  const dropped: ContentCatalogItem[] = []
  const total = (): number => keep.reduce((n, i) => n + i.approxBytes, 0)
  const candidates = keep.filter((i) => i.priority > 1).sort((a, b) => b.priority - a.priority || b.approxBytes - a.approxBytes)
  for (const c of candidates) {
    if (total() + FREE_MARGIN <= freeBytes) break
    keep.splice(keep.indexOf(c), 1)
    dropped.push(c)
  }
  // Segunda pasada: lo descartado que aún cabe (de pequeño a grande) vuelve. Así quitar un contenido enorme
  // no se lleva por delante otros diminutos de menor prioridad que sí caben.
  for (const c of [...dropped].sort((a, b) => a.approxBytes - b.approxBytes)) {
    if (total() + c.approxBytes + FREE_MARGIN <= freeBytes) {
      keep.push(c)
      dropped.splice(dropped.indexOf(c), 1)
    }
  }
  return { keep, dropped }
}

/** Orden de descarga: primero lo imprescindible y, dentro, lo pequeño (algo útil cuanto antes). */
export function orderForInstall(items: ContentCatalogItem[]): ContentCatalogItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || a.approxBytes - b.approxBytes)
}

// ------------------------------------------------------------------ Idioma y región (ADR 0018)

export type ContentLang = 'es' | 'en' | 'fr' | 'it' | 'de' | 'zh' | 'ja'
/** Idiomas de la interfaz y de los contenidos propios del catálogo (ADR 0017). */
export const CONTENT_LANGS: readonly ContentLang[] = ['es', 'en', 'fr', 'it', 'de', 'zh', 'ja']

/** Idiomas de contenido aceptables, por preferencia: el de la interfaz y, si no hay, inglés. */
export function contentLangs(ui: ContentLang): string[] {
  return ui === 'es' ? ['es', 'en'] : [ui, 'en']
}

/** Mapas, rutas, asistente y juegos no dependen del idioma. */
const NEUTRAL = new Set(['maps', 'routing', 'llm', 'games'])

/** ¿Este contenido está en un idioma que el usuario entiende? (los demás se pueden mostrar aparte) */
export function inLanguage(i: ContentCatalogItem, ui: ContentLang): boolean {
  return NEUTRAL.has(i.kind) || i.lang === 'mul' || contentLangs(ui).includes(i.lang)
}

/** Tema: un contenido y sus equivalentes en otros idiomas (Wikipedia es/en/fr/it…). */
export const topicOf = (i: ContentCatalogItem): string => i.equivalentOf ?? i.id

/** Mapas de España ya preparados (península, Baleares y Canarias, con sus rutas). */
const SPAIN_ITEMS = new Set(['mapa-espana', 'mapa-canarias', 'rutas-espana', 'rutas-canarias'])

export interface CountryChoice {
  id: string
  name: string
  mapBytes: number
  routingBytes: number
}

/** Elementos de un país para el ajuste al espacio y el orden (el motor los expande). */
export function countryItems(c: CountryChoice): ContentCatalogItem[] {
  const base = { group: 'mapas', lang: 'mul', default: true, license: 'ODbL-1.0', description: '', equivalentOf: null, variants: null }
  return [
    { ...base, id: `mapa-pais:${c.id}`, kind: 'maps', priority: 1, approxBytes: c.mapBytes, title: c.name },
    { ...base, id: `rutas-pais:${c.id}`, kind: 'routing', priority: 2, approxBytes: c.routingBytes, title: c.name },
  ]
}

/**
 * Plan de descarga para el idioma y el país:
 *   - «recommended» (asistente inicial): lo recomendado de cada tema, en el mejor idioma;
 *   - «all» («Descargarlo todo»): todo el catálogo en los idiomas del usuario, también lo no marcado, y
 *     todos los modelos del asistente.
 * Mapas: los del país (España con sus mapas propios) y el del mundo. Lo ya instalado no se repite.
 */
/** Modelo ligero del asistente (equipos con poca memoria, p. ej. tablets Android de 3–4 GB; ADR 0020). */
export const LIGHT_ASSISTANT = 'asistente-ligero'

/**
 * ¿Cabe el modelo en la memoria del equipo? El fichero se carga entero (mmap) más el contexto y el resto de
 * servicios: hace falta ~1,3 × su tamaño + 1,5 GiB. Sin dato de memoria se supone que cabe (Pi, PC).
 */
export function llmFits(modelBytes: number, ramBytes: number | null | undefined): boolean {
  if (!ramBytes) return true
  return modelBytes * 1.3 + 1.5 * 1024 ** 3 <= ramBytes
}

export function downloadPlan(
  catalog: ContentCatalogItem[],
  installed: Set<string>,
  ui: ContentLang,
  country: CountryChoice | null,
  mode: 'recommended' | 'all',
  ramBytes: number | null = null,
): ContentCatalogItem[] {
  const langs = contentLangs(ui)
  const rank = (x: ContentCatalogItem): number => (langs.includes(x.lang) ? langs.indexOf(x.lang) : x.lang === 'mul' ? 0 : 99)
  const best = new Map<string, ContentCatalogItem>()
  // Con poca memoria, los modelos grandes no se descargan y el recomendado pasa a ser el ligero.
  const main = catalog.find((i) => i.id === 'asistente')
  const lowRam = !!main && !llmFits(main.approxBytes, ramBytes)
  const recommendedLlm = lowRam ? LIGHT_ASSISTANT : 'asistente'
  for (const i of catalog) {
    if (i.kind === 'maps' || i.kind === 'routing' || !inLanguage(i, ui)) continue
    if (i.kind === 'llm' && !llmFits(i.approxBytes, ramBytes)) continue
    if (mode === 'recommended' && ((!i.default && i.id !== recommendedLlm) || (i.kind === 'llm' && i.id !== recommendedLlm))) continue
    const key = i.kind === 'llm' ? i.id : topicOf(i)
    const cur = best.get(key)
    if (!cur || rank(i) < rank(cur)) best.set(key, i)
  }
  const out = [...best.values()]
  const spain = country?.id === 'esp'
  for (const i of catalog) {
    if (i.kind !== 'maps' && i.kind !== 'routing') continue
    if (SPAIN_ITEMS.has(i.id) ? spain : i.default) out.push(i)
  }
  if (country && !spain) out.push(...countryItems(country))
  return out.filter((i) => !installed.has(i.id))
}

/**
 * Orden final: el asistente recomendado el último (instalar un modelo lo deja activo). Si el principal no está
 * (no cabe en la memoria), el ligero.
 */
export function orderPlan(items: ContentCatalogItem[]): ContentCatalogItem[] {
  const ordered = orderForInstall(items)
  let main = ordered.findIndex((i) => i.id === 'asistente')
  if (main < 0) main = ordered.findIndex((i) => i.id === LIGHT_ASSISTANT)
  if (main >= 0) ordered.push(ordered.splice(main, 1)[0]!)
  return ordered
}
