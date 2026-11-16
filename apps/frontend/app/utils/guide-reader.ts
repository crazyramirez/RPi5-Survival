/** El HTML de entrada procede del renderizador seguro de library, no de HTML arbitrario. */
export interface GuideSection {
  id: string
  title: string
  headingHtml: string
  level: number
  html: string
}

export type GuideSectionStyle = 'prose' | 'steps' | 'condition' | 'method' | 'inventory' | 'phase' | 'recipe' | 'warning'

/** Huella de presentación (no de seguridad) para detectar cambios del índice editorial. */
export function guideOutlineKey(titles: readonly string[]): string {
  let hash = 2166136261
  for (const char of titles.join('\u001f').normalize('NFC')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return (hash >>> 0).toString(16)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
export function guideHeadingText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ENTITIES[entity] ?? '')
}

/**
 * Separa únicamente los encabezados que genera renderMarkdown (h2–h4).
 * Conserva íntegros los bloques, las listas, las tablas, las cantidades y su orden.
 * No deduce acciones de una lista numerada ni inventa apartados a partir de palabras clave.
 */
export function buildGuideDocument(html: string): { introHtml: string; sections: GuideSection[] } {
  const headings = [...html.matchAll(/<h([2-4])>([\s\S]*?)<\/h\1>/g)]
  if (!headings.length) return { introHtml: html, sections: [] }
  const topLevel = Math.min(...headings.map((heading) => Number(heading[1])))
  return {
    introHtml: html.slice(0, headings[0]!.index),
    sections: headings.map((heading, index) => ({
      id: `guide-section-${index + 1}`,
      title: guideHeadingText(heading[2] ?? ''),
      headingHtml: heading[2] ?? '',
      level: Number(heading[1]) - topLevel,
      html: html.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? html.length),
    })),
  }
}

export function guideTitleParts(title: string): { title: string; subtitle: string } {
  const match = /^(.+?)\s+\(([^()]{20,})\)$/.exec(title)
  return match ? { title: match[1]!, subtitle: `(${match[2]})` } : { title, subtitle: '' }
}
