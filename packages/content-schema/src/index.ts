/**
 * Metadatos obligatorios para cualquier contenido instalado (ZIM, mapas, PDF,
 * protocolos de emergencia). Se usará a partir de la Fase 3.
 */
export type ContentKind = 'zim' | 'map' | 'document' | 'protocol'

export interface ContentManifestEntry {
  id: string
  kind: ContentKind
  title: string
  /** Idioma BCP 47, p. ej. "es". */
  language: string
  /** Versión o fecha de edición declarada por el origen. */
  version: string
  /** URL o descripción del origen. */
  source: string
  /** Fecha (ISO 8601) en que se obtuvo/consultó el contenido. */
  retrievedAt: string
  /** Identificador SPDX o texto de licencia. */
  license: string
  sizeBytes: number
  sha256: string
  /** Ruta relativa al directorio de datos públicos. */
  path: string
}

export interface ContentManifest {
  schemaVersion: 1
  entries: ContentManifestEntry[]
}

const SHA256_RE = /^[a-f0-9]{64}$/

/** Valida un registro de manifiesto y devuelve la lista de problemas (vacía si es válido). */
export function validateManifestEntry(entry: Partial<ContentManifestEntry>): string[] {
  const problems: string[] = []
  const required: (keyof ContentManifestEntry)[] = [
    'id', 'kind', 'title', 'language', 'version', 'source', 'retrievedAt', 'license', 'sizeBytes', 'sha256', 'path',
  ]
  for (const key of required) {
    if (entry[key] === undefined || entry[key] === '') problems.push(`falta ${key}`)
  }
  if (entry.sha256 !== undefined && !SHA256_RE.test(entry.sha256)) problems.push('sha256 inválido')
  if (entry.path !== undefined && (entry.path.startsWith('/') || entry.path.includes('..'))) {
    problems.push('path debe ser relativo y sin ".."')
  }
  if (entry.sizeBytes !== undefined && (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0)) {
    problems.push('sizeBytes inválido')
  }
  return problems
}
