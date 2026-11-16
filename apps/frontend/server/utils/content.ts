import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ContentCatalogItem, ContentItemStatus, ContentOverview } from '@survival-os/shared-types'
import { isPortable, portablePaths } from './portable'

/**
 * Catálogo de descargas (ADR 0015) visto desde la web: content/catalog.json + lo que hay en disco
 * + el progreso que escribe scripts/content-engine.mjs en content-state.json.
 */
interface Catalog {
  updated: string
  groups: { id: string; title: string }[]
  items: (ContentCatalogItem & { zim?: { name: string; flavour: string }; maps?: { region: string }; routing?: { tiles: string[] }; llm?: { model: string }; doc?: { file?: string; parts?: { file: string }[] } })[]
  models: Record<string, { file: string }>
}

function dirs(): { data: string; zim: string; maps: string; llm: string; routing: string; docs: string; state: string; setup: string; catalog: string } {
  if (isPortable()) {
    const { root, data } = portablePaths()
    return {
      data,
      zim: join(data, 'library', 'zim'),
      maps: join(data, 'maps'),
      llm: join(data, 'llm'),
      routing: join(data, 'routing'),
      docs: join(data, 'library', 'docs'),
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

/** Estado de cada elemento: lo que hay en disco manda; el registro del motor aporta progreso y errores. */
export async function contentOverview(): Promise<ContentOverview> {
  const d = dirs()
  const catalog = await loadCatalog()
  const engine = await readJson<{ items: Record<string, Partial<ContentItemStatus> & { state?: string; done?: number; total?: number; error?: string; file?: string; version?: string; bytes?: number }> }>(d.state, { items: {} })
  const zims = (await ls(d.zim)).filter((f) => f.endsWith('.zim'))
  const maps = (await ls(d.maps)).filter((f) => f.endsWith('.pmtiles'))
  const segs = (await ls(join(d.routing, 'segments4'))).filter((f) => f.endsWith('.rd5'))
  const models = await ls(join(d.llm, 'models'))
  const active = (await fs.readFile(join(d.llm, 'active'), 'utf8').catch(() => '')).trim()
  const statFile = async (p: string): Promise<number | null> => (await fs.stat(p).catch(() => null))?.size ?? null

  const items: ContentItemStatus[] = []
  for (const it of catalog.items) {
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
  const s = await fs.statfs(d.data).catch(() => null)
  const setup = await readJson<{ completedAt?: string; skippedAt?: string } | null>(d.setup, null)
  return {
    platform: `${process.platform}-${process.arch}`,
    portable: isPortable(),
    catalogUpdated: catalog.updated,
    groups: catalog.groups,
    catalog: catalog.items.map(({ id, kind, group, lang, priority, default: def, approxBytes, license, title, description, equivalentOf, variants }) => ({
      id, kind, group, lang, priority, default: def, approxBytes, license, title, description, equivalentOf: equivalentOf ?? null, variants: variants ?? null,
    })),
    items,
    freeBytes: s ? s.bavail * s.bsize : null,
    setup: setup?.completedAt ? { state: 'completed', at: setup.completedAt } : setup?.skippedAt ? { state: 'skipped', at: setup.skippedAt } : { state: 'pending', at: null },
  }
}

export async function writeSetup(state: 'completed' | 'skipped', selection: string[]): Promise<void> {
  const d = dirs()
  const body = state === 'completed' ? { completedAt: new Date().toISOString(), selection } : { skippedAt: new Date().toISOString() }
  await fs.mkdir(d.data, { recursive: true })
  await fs.writeFile(d.setup, JSON.stringify(body, null, 2))
}
