import { existsSync, promises as fs } from 'node:fs'
import { totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ContentCatalogItem, ContentDetails, ContentDetailsResponse, ContentItemStatus, ContentKiwixMeta, ContentOverview } from '@survival-os/shared-types'
import { jobStatus } from './admin'
import { isPortable, portablePaths } from './portable'
// Lógica común con el motor de descargas (mismos zooms y tamaños).
import { countryLand, countryMaxZoom, countryName, countryZones, estimateMapBytes, ROUTING_TILE_BYTES, routingTiles, type Country } from '../../../../scripts/country-maps.mjs'

/**
 * Catálogo de descargas (ADR 0015) visto desde la web: content/catalog.json + lo que hay en disco
 * + el progreso que escribe scripts/content-engine.mjs en content-state.json.
 */
interface Catalog {
  updated: string
  groups: { id: string; title: string }[]
  items: (ContentCatalogItem & { template?: string; zim?: { name: string; flavour: string }; maps?: { region: string; maxzoom?: number }; routing?: { tiles: string[] }; llm?: { model: string }; doc?: { file?: string; parts?: { file: string; title?: string }[] }; publisher?: string })[]
  models: Record<string, { file: string }>
}

function dirs(): { data: string; zim: string; maps: string; llm: string; routing: string; docs: string; games: string; state: string; setup: string; catalog: string } {
  if (isPortable()) {
    const { root, data } = portablePaths()
    return {
      data,
      zim: join(data, 'library', 'zim'),
      maps: join(data, 'maps'),
      llm: join(data, 'llm'),
      routing: join(data, 'routing'),
      docs: join(data, 'library', 'docs'),
      games: join(data, 'games'),
      state: join(data, 'content-state.json'),
      setup: join(data, 'setup.json'),
      catalog: join(root, 'app', 'content', 'catalog.json'),
    }
  }
  const v = process.platform === 'linux' && existsSync('/var/lib/survival-os') ? '/var/lib/survival-os' : resolve('.data')
  const catalog = [process.env.SURVIVAL_CATALOG, '/opt/survival-os/current/content/catalog.json', resolve('content/catalog.json'), resolve('../../content/catalog.json')].find(
    (p): p is string => !!p && existsSync(p),
  )
  return {
    data: v,
    zim: process.env.SURVIVAL_ZIM_DIR ?? join(v, 'library', 'zim'),
    maps: process.env.SURVIVAL_MAPS_DIR ?? join(v, 'maps'),
    llm: join(v, 'llm'),
    routing: process.env.SURVIVAL_ROUTING_DIR ?? join(v, 'routing'),
    docs: join(v, 'library', 'docs'),
    games: join(v, 'games'),
    state: join(v, 'content-state.json'),
    setup: join(v, 'setup.json'),
    catalog: catalog ?? '',
  }
}

const readJson = async <T>(p: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}
const ls = (d: string): Promise<string[]> => fs.readdir(d).catch(() => [] as string[])

export async function loadCatalog(): Promise<Catalog> {
  const d = dirs()
  if (!d.catalog) throw createError({ statusCode: 503, statusMessage: 'Catálogo de contenidos no encontrado' })
  return JSON.parse(await fs.readFile(d.catalog, 'utf8')) as Catalog
}

interface CatalogI18n {
  groups?: Record<string, string>
  items?: Record<string, { title?: string; description?: string }>
  /** Etiquetas de variantes («Sin imágenes» → traducción). */
  variants?: Record<string, string>
}

/**
 * Textos del catálogo en otro idioma (content/catalog-i18n/<idioma>.json, junto a catalog.json). El
 * catálogo base está en español; lo que no esté traducido se queda en español.
 */
async function catalogI18n(catalogPath: string, lang: string): Promise<CatalogI18n> {
  if (!/^(en|fr|it)$/.test(lang)) return {}
  return readJson<CatalogI18n>(join(dirname(catalogPath), 'catalog-i18n', `${lang}.json`), {})
}

/**
 * Fichas «Más información» (ADR 0018): explicación escrita (content/catalog-details/<idioma>.json, en español si
 * falta), datos oficiales de Kiwix (content/catalog-kiwix.json), editor, capítulos y zoom, todo sin Internet.
 * Claves especiales: «@country-map» y «@country-routing» para el mapa y las rutas de cualquier país.
 */
export async function contentDetails(lang = 'es'): Promise<ContentDetailsResponse> {
  const d = dirs()
  const catalog = await loadCatalog()
  const base = dirname(d.catalog)
  type About = { items?: Record<string, string> }
  const es = await readJson<About>(join(base, 'catalog-details', 'es.json'), {})
  const tr = /^(en|fr|it)$/.test(lang) ? await readJson<About>(join(base, 'catalog-details', `${lang}.json`), {}) : {}
  const kiwix = await readJson<{ fetched?: string; items?: Record<string, ContentKiwixMeta> }>(join(base, 'catalog-kiwix.json'), {})
  const about = (id: string): string | null => tr.items?.[id] ?? es.items?.[id] ?? null
  const items: Record<string, ContentDetails> = {}
  for (const it of catalog.items) {
    const key = it.id === 'mapa-pais' ? '@country-map' : it.id === 'rutas-pais' ? '@country-routing' : it.id
    const parts = it.doc?.parts?.map((p) => p.title?.trim()).filter((t): t is string => !!t)
    items[key] = {
      about: about(key),
      publisher: it.publisher ?? null,
      kiwix: kiwix.items?.[it.id] ?? null,
      chapters: parts && parts.length > 1 ? parts : null,
      maxZoom: it.maps?.maxzoom ?? null,
    }
  }
  return { items, kiwixFetched: kiwix.fetched ?? null }
}

/** Estado de cada elemento: lo que hay en disco manda; el registro del motor aporta progreso y errores. */
export async function contentOverview(lang = 'es'): Promise<ContentOverview> {
  const d = dirs()
  const catalog = await loadCatalog()
  const tr = await catalogI18n(d.catalog, lang)
  const engine = await readJson<{ items: Record<string, Partial<ContentItemStatus> & { state?: string; done?: number; total?: number; error?: string; file?: string; version?: string; bytes?: number }> }>(d.state, { items: {} })
  const zims = (await ls(d.zim)).filter((f) => f.endsWith('.zim'))
  const maps = (await ls(d.maps)).filter((f) => f.endsWith('.pmtiles'))
  const segs = (await ls(join(d.routing, 'segments4'))).filter((f) => f.endsWith('.rd5'))
  const models = await ls(join(d.llm, 'models'))
  const active = (await fs.readFile(join(d.llm, 'active'), 'utf8').catch(() => '')).trim()
  const statFile = async (p: string): Promise<number | null> => (await fs.stat(p).catch(() => null))?.size ?? null
  // «Descargando» solo si alguna tarea del motor sigue en marcha. Si se cortó (app cerrada, reinicio, reinstalación),
  // el registro se queda en «downloading» para siempre: se muestra como interrumpida y se puede relanzar.
  const engineRunning = (await Promise.all((['content', 'llm', 'routing'] as const).map((j) => jobStatus(j).then((st) => st.state === 'active', () => false)))).some(Boolean)
  const stale = (st: string | undefined): boolean => !engineRunning && (st === 'downloading' || st === 'verifying')
  for (const e of Object.values(engine.items)) {
    if (stale(e.state)) {
      e.state = 'failed'
      e.error = 'Descarga interrumpida: vuelve a lanzarla'
    }
  }

  const items: ContentItemStatus[] = []
  for (const it of catalog.items) {
    if (it.template) continue // plantillas de país: sus elementos («mapa-pais:esp») van después
    const e = engine.items[it.id] ?? {}
    let installed: { file: string | null; bytes: number | null } | null = null
    if (it.kind === 'zim' && it.zim) {
      const f = zims.find((z) => z.replace(/(_(maxi|nopic|mini))?_\d{4}-\d{2}\.zim$/, '') === it.zim!.name)
      if (f) installed = { file: f, bytes: await statFile(join(d.zim, f)) }
    } else if (it.kind === 'maps' && it.maps) {
      const f = maps.find((m) => m.startsWith(`${it.maps!.region}-`) || (it.maps!.region === 'espana' && m.startsWith('espana')))
      if (f) installed = { file: f, bytes: await statFile(join(d.maps, f)) }
    } else if (it.kind === 'routing' && it.routing) {
      const have = it.routing.tiles.filter((t) => segs.includes(`${t}.rd5`))
      if (have.length === it.routing.tiles.length) installed = { file: null, bytes: null }
    } else if (it.kind === 'doc' && it.doc) {
      if (it.doc.parts) {
        // Libro por capítulos: instalado si están todos.
        const dir = join(d.docs, 'manuales', it.id)
        const have = await ls(dir)
        if (it.doc.parts.every((p) => have.includes(p.file))) installed = { file: it.id, bytes: null }
      } else if (it.doc.file) {
        const size = await statFile(join(d.docs, 'manuales', it.doc.file))
        if (size !== null) installed = { file: it.doc.file, bytes: size }
      }
    } else if (it.kind === 'games') {
      // Copia offline montada (games-sync): `current/index.html`, igual que /api/games/status.
      if (await statFile(join(d.games, 'current', 'index.html')) !== null) installed = { file: null, bytes: null }
    } else if (it.kind === 'llm' && it.llm) {
      const file = catalog.models[it.llm.model]?.file
      if (file && models.includes(file)) installed = { file, bytes: await statFile(join(d.llm, 'models', file)) }
    }
    const busy = e.state === 'downloading' || e.state === 'verifying'
    items.push({
      id: it.id,
      state: installed && !busy ? 'installed' : busy ? (e.state as 'downloading' | 'verifying') : e.state === 'failed' ? 'failed' : 'missing',
      file: installed?.file ?? e.file ?? null,
      bytes: installed?.bytes ?? null,
      version: e.version ?? null,
      done: busy ? (e.done ?? null) : null,
      total: busy ? (e.total ?? null) : null,
      error: e.state === 'failed' ? (e.error ?? null) : null,
      active: it.kind === 'llm' ? !!installed && active === installed.file : undefined,
    })
  }
  // Mapas y rutas de países (ADR 0018): el registro del motor dice qué se pidió; el disco, qué hay.
  for (const [id, e] of Object.entries(engine.items)) {
    const m = /^(mapa|rutas)-pais:([a-z]{3})$/.exec(id)
    if (!m) continue
    const iso = m[2]!
    const busy = e.state === 'downloading' || e.state === 'verifying'
    const present = m[1] === 'mapa'
      ? maps.some((f) => f.startsWith(`pais-${iso}-`))
      : e.state === 'installed' && ((e as { tiles?: { name: string }[] }).tiles ?? []).every((t) => segs.includes(`${t.name}.rd5`))
    items.push({
      id,
      state: present && !busy ? 'installed' : busy ? (e.state as 'downloading' | 'verifying') : e.state === 'failed' ? 'failed' : 'missing',
      file: e.file ?? null,
      bytes: e.bytes ?? null,
      version: e.version ?? null,
      done: busy ? (e.done ?? null) : null,
      total: busy ? (e.total ?? null) : null,
      error: e.state === 'failed' ? (e.error ?? null) : null,
    })
  }
  const s = await fs.statfs(d.data).catch(() => null)
  const setup = await readJson<{ completedAt?: string; skippedAt?: string } | null>(d.setup, null)
  return {
    platform: `${process.platform}-${process.arch}`,
    portable: isPortable(),
    catalogUpdated: catalog.updated,
    groups: catalog.groups.map((g) => ({ ...g, title: tr.groups?.[g.id] ?? g.title })),
    catalog: catalog.items.filter((i) => !i.template).map(({ id, kind, group, lang, priority, default: def, approxBytes, license, title, description, equivalentOf, variants }) => ({
      id, kind, group, lang, priority, default: def, approxBytes, license,
      title: tr.items?.[id]?.title ?? title,
      description: tr.items?.[id]?.description ?? description,
      equivalentOf: equivalentOf ?? null,
      variants: variants?.map((v) => ({ ...v, label: tr.variants?.[v.label] ?? v.label })) ?? null,
    })),
    items,
    freeBytes: s ? s.bavail * s.bsize : null,
    ramBytes: totalmem(),
    setup: setup?.completedAt ? { state: 'completed', at: setup.completedAt } : setup?.skippedAt ? { state: 'skipped', at: setup.skippedAt } : { state: 'pending', at: null },
  }
}

export async function writeSetup(state: 'completed' | 'skipped', selection: string[]): Promise<void> {
  const d = dirs()
  const body = state === 'completed' ? { completedAt: new Date().toISOString(), selection } : { skippedAt: new Date().toISOString() }
  await fs.mkdir(d.data, { recursive: true })
  await fs.writeFile(d.setup, JSON.stringify(body, null, 2))
}

// ------------------------------------------------------------------ Países (ADR 0018)

export interface CountryOption {
  id: string
  iso2: string | null
  name: string
  /** Nombres en los cuatro idiomas: se busca por cualquiera. */
  names: string[]
  maxzoom: number
  mapBytes: number
  routingBytes: number
  zones: number
}

let countriesCache: { countries: Country[]; timezones: Record<string, string> } | null = null

/** content/countries.json (junto a catalog.json), leído una vez. */
export async function loadCountries(): Promise<{ countries: Country[]; timezones: Record<string, string> }> {
  if (!countriesCache) {
    const d = dirs()
    countriesCache = await readJson<{ countries: Country[]; timezones: Record<string, string> }>(join(dirname(d.catalog), 'countries.json'), { countries: [], timezones: {} })
  }
  return countriesCache
}

/** Nombre de un país por su id (iso3) en un idioma; null si no existe. */
export async function countryTitle(id: string, lang = 'es'): Promise<string | null> {
  const c = (await loadCountries()).countries.find((x) => x.id === id)
  return c ? countryName(c, lang) : null
}

/** Países para el buscador de mapas, con el nombre en el idioma de la interfaz y tamaños estimados. */
export async function countryOptions(lang = 'es'): Promise<{ countries: CountryOption[]; timezones: Record<string, string> }> {
  const data = await loadCountries()
  const countries = data.countries
    .map((c) => {
      const zones = countryZones(c)
      const maxzoom = countryMaxZoom(countryLand(c))
      return {
        id: c.id,
        iso2: c.iso2,
        name: countryName(c, lang),
        names: [...new Set(Object.values(c.names))],
        maxzoom,
        mapBytes: zones.reduce((n, z) => n + estimateMapBytes(z.areaKm2, maxzoom), 0),
        routingBytes: routingTiles(c).length * ROUTING_TILE_BYTES,
        zones: zones.length,
        bboxes: zones.map((z) => z.bbox),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang))
  return { countries, timezones: data.timezones }
}
