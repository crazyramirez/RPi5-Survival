import type { VaultFile } from '@survival-os/shared-types'

/**
 * Explorador de la bóveda: lógica pura (filtrar, ordenar, etiquetas, fechas de revisión). Sin E/S; la pantalla
 * (components/VaultBrowser.vue) solo la presenta.
 */
export type VaultKind = 'image' | 'pdf' | 'text' | 'other'
export type VaultFilter = 'all' | VaultKind
export type VaultSort = 'recent' | 'name' | 'size' | 'type'
export type VaultView = 'list' | 'grid'
/** Revisión o caducidad: vencida, en los próximos 30 días o más adelante. */
export type ReviewState = 'overdue' | 'soon' | 'later'

export const VAULT_KINDS: readonly VaultKind[] = ['image', 'pdf', 'text', 'other']
export const VAULT_SORTS: readonly VaultSort[] = ['recent', 'name', 'size', 'type']
/** Límites del servicio (services/vault/src/policy.ts: sanitizeTags). */
export const MAX_TAGS = 10
export const MAX_TAG_LEN = 30
export const MAX_NAME_LEN = 110
const SOON_DAYS = 30

export function vaultKind(mime: string): VaultKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/')) return 'text'
  return 'other'
}

/** Nombre y extensión: la extensión se conserva al renombrar (de ella dependen el tipo y la vista previa). */
export function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 && i >= name.length - 6 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' }
}

/** Extensión en mayúsculas para la insignia de la tarjeta («PDF», «JPG»); vacía si no tiene. */
export function extBadge(name: string): string {
  return splitName(name).ext.slice(1).toUpperCase()
}

/** Para buscar sin distinguir mayúsculas ni tildes («Pasaporte» = «pasaporté»). */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function filterFiles(files: readonly VaultFile[], opts: { query?: string; kind?: VaultFilter; tag?: string | null }): VaultFile[] {
  const words = fold(opts.query ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return files.filter((f) => {
    if (opts.kind && opts.kind !== 'all' && vaultKind(f.mime) !== opts.kind) return false
    if (opts.tag && !f.tags.includes(opts.tag)) return false
    if (!words.length) return true
    const hay = fold([f.name, ...f.tags].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

const collator = (): Intl.Collator => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortFiles(files: readonly VaultFile[], sort: VaultSort): VaultFile[] {
  const c = collator()
  const byName = (a: VaultFile, b: VaultFile): number => c.compare(a.name, b.name)
  const list = [...files]
  switch (sort) {
    case 'name':
      return list.sort(byName)
    case 'size':
      return list.sort((a, b) => b.sizeBytes - a.sizeBytes || byName(a, b))
    case 'type':
      return list.sort((a, b) => VAULT_KINDS.indexOf(vaultKind(a.mime)) - VAULT_KINDS.indexOf(vaultKind(b.mime)) || c.compare(extBadge(a.name), extBadge(b.name)) || byName(a, b))
    default:
      return list.sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || byName(a, b))
  }
}

export function kindCounts(files: readonly VaultFile[]): Record<VaultFilter, number> {
  const out: Record<VaultFilter, number> = { all: files.length, image: 0, pdf: 0, text: 0, other: 0 }
  for (const f of files) out[vaultKind(f.mime)]++
  return out
}

/** Etiquetas en uso, de la más usada a la menos (sugerencias al editar y filtro rápido). */
export function tagsInUse(files: readonly VaultFile[]): string[] {
  const n = new Map<string, number>()
  for (const f of files) for (const t of f.tags) n.set(t, (n.get(t) ?? 0) + 1)
  const c = collator()
  return [...n.entries()].sort((a, b) => b[1] - a[1] || c.compare(a[0], b[0])).map(([t]) => t)
}

/** Añade etiquetas escritas («viaje, salud») a las que ya hay: sin repetir, recortadas y con el límite del servicio. */
export function addTags(current: readonly string[], input: string): string[] {
  const out = [...current]
  for (const raw of input.split(',')) {
    const t = raw.trim().slice(0, MAX_TAG_LEN)
    if (t && !out.some((x) => fold(x) === fold(t)) && out.length < MAX_TAGS) out.push(t)
  }
  return out
}

/** Fecha local AAAA-MM-DD (la de revisión es una fecha de calendario, sin hora). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function reviewState(date: string | null, today: Date = new Date()): ReviewState | null {
  if (!date) return null
  const t = isoDay(today)
  if (date < t) return 'overdue'
  const soon = new Date(today)
  soon.setDate(soon.getDate() + SOON_DAYS)
  return date <= isoDay(soon) ? 'soon' : 'later'
}
