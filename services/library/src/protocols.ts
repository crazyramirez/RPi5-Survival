import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProtocolDetail, ProtocolSummary } from '@survival-os/shared-types'
import { markdownToText, parseFrontMatter, renderMarkdown } from './markdown.ts'

export interface LoadedProtocol extends ProtocolDetail {
  text: string
}

const REQUIRED = ['id', 'title', 'category', 'reviewed', 'sources'] as const

/** Carga y valida los protocolos. Un protocolo sin fuente o fecha de revisión se rechaza. */
export async function loadProtocols(dir: string): Promise<{ protocols: LoadedProtocol[]; errors: string[] }> {
  const protocols: LoadedProtocol[] = []
  const errors: string[] = []
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return { protocols, errors: [`Directorio de protocolos no encontrado: ${dir}`] }
  }
  for (const file of files) {
    const source = await readFile(join(dir, file), 'utf8')
    const { meta, body } = parseFrontMatter(source)
    const missing = REQUIRED.filter((k) => !meta[k])
    if (missing.length) {
      errors.push(`${file}: faltan ${missing.join(', ')}`)
      continue
    }
    if (!/^[a-z0-9-]+$/.test(meta.id ?? '')) {
      errors.push(`${file}: id inválido`)
      continue
    }
    protocols.push({
      id: meta.id ?? '',
      title: meta.title ?? '',
      category: meta.category ?? '',
      reviewed: meta.reviewed ?? '',
      sources: meta.sources ?? '',
      html: renderMarkdown(body),
      text: markdownToText(body),
    })
  }
  return { protocols, errors }
}

export function summarize(p: LoadedProtocol): ProtocolSummary {
  return { id: p.id, title: p.title, category: p.category, reviewed: p.reviewed, sources: p.sources }
}
