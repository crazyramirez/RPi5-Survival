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
  return { keep, dropped }
}

/** Orden de descarga: primero lo imprescindible y, dentro, lo pequeño (algo útil cuanto antes). */
export function orderForInstall(items: ContentCatalogItem[]): ContentCatalogItem[] {
  return [...items].sort((a, b) => a.priority - b.priority || a.approxBytes - b.approxBytes)
}
