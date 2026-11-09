import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { MapPackage } from '@survival-os/shared-types'

export const MAP_FILE_RE = /^[\w-]{1,80}\.pmtiles$/

export function mapsDir(): string {
  return process.env.SURVIVAL_MAPS_DIR ?? (process.platform === 'linux' ? '/var/lib/survival-os/maps' : '.data/maps')
}

/** Nombres de región con su ortografía correcta (los ficheros usan ASCII). */
const REGION_NAMES: Record<string, string> = { espana: 'España', canarias: 'Canarias', baleares: 'Baleares', portugal: 'Portugal', andorra: 'Andorra' }

export function describeMap(file: string, sizeBytes: number): MapPackage {
  const m = /^(.+?)-(\d{8})-z(\d{1,2})\.pmtiles$/.exec(file)
  const slug = m?.[1] ?? file.replace(/\.pmtiles$/, '')
  const name = REGION_NAMES[slug.toLowerCase()] ?? slug.replace(/[-_]+/g, ' ')
  return {
    file,
    title: name.charAt(0).toUpperCase() + name.slice(1),
    sizeBytes,
    dataDate: m?.[2] ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}` : null,
    maxZoom: m?.[3] ? Number(m[3]) : null,
  }
}

export async function listMaps(): Promise<MapPackage[]> {
  const dir = mapsDir()
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => MAP_FILE_RE.test(f))
  const out: MapPackage[] = []
  for (const f of files) {
    const st = await fs.stat(join(dir, f)).catch(() => null)
    if (st?.isFile()) out.push(describeMap(f, st.size))
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/** "bytes=a-b" → rango válido o null. Solo un rango (lo que usa pmtiles). */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    const suffix = Number(m[2])
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end }
}
