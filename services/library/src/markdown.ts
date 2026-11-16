/**
 * Renderizador Markdown mínimo y SEGURO (sin dependencias).
 *
 * Todo el texto se escapa; solo se generan etiquetas conocidas: h2–h4, p, ul/ol/li,
 * blockquote, table (tablas GFM con barras), pre/code (bloques ```), strong, em, code,
 * a (solo rutas relativas o http(s), con rel="noopener").
 * Suficiente para los protocolos y documentos propios; no es CommonMark completo.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHref(href: string): string | null {
  const h = href.trim()
  if (/^(https?:\/\/|\/|#|\.\.?\/)/i.test(h) || /^[\w./-]+$/.test(h)) return h
  return null // javascript:, data:, vbscript:… descartados
}

/** Formato en línea sobre texto YA escapado. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
      // href ya está escapado (& → &amp;); se valida sobre su forma original.
      const raw = href.replace(/&amp;/g, '&')
      const ok = safeHref(raw)
      return ok ? `<a href="${escapeHtml(ok)}" rel="noopener noreferrer">${text}</a>` : text
    })
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  let quote: string[] = []

  const flushPara = (): void => {
    if (para.length) out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`)
    para = []
  }
  const flushList = (): void => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(escapeHtml(i))}</li>`).join('')}</${list.type}>`)
    list = null
  }
  const flushQuote = (): void => {
    if (quote.length) out.push(`<blockquote>${inline(escapeHtml(quote.join(' ')))}</blockquote>`)
    quote = []
  }
  const flushAll = (): void => {
    flushPara()
    flushList()
    flushQuote()
  }

  /** Celdas de una fila «| a | b |» (sin las barras de los extremos). */
  const cells = (row: string): string[] =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
  const isSeparator = (row: string | undefined): boolean => !!row && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(row)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Bloque de código cercado: se copia tal cual (escapado).
    if (/^```/.test(line.trim())) {
      flushAll()
      const code: string[] = []
      while (++i < lines.length && !/^```/.test((lines[i] ?? '').trim())) code.push(lines[i] ?? '')
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    // Tabla: cabecera «| … |» seguida de «|---|---|».
    if (line.includes('|') && isSeparator(lines[i + 1])) {
      flushAll()
      const head = cells(line)
      const align = cells(lines[i + 1] ?? '').map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null))
      const td = (tag: 'th' | 'td', text: string, k: number): string => {
        const a = align[k]
        return `<${tag}${a ? ` style="text-align:${a}"` : ''}>${inline(escapeHtml(text))}</${tag}>`
      }
      const body: string[] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        const row = cells(lines[i] ?? '')
        body.push(`<tr>${head.map((_, k) => td('td', row[k] ?? '', k)).join('')}</tr>`)
        i++
      }
      i--
      out.push(`<div class="table"><table><thead><tr>${head.map((h, k) => td('th', h, k)).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const q = /^>\s?(.*)$/.exec(line)

    if (!line.trim()) {
      flushAll()
    } else if (heading) {
      flushAll()
      // h1 del documento se rebaja a h2: la página ya tiene su propio título.
      const level = Math.min(4, Math.max(2, (heading[1] ?? '#').length + 1))
      out.push(`<h${level}>${inline(escapeHtml(heading[2] ?? ''))}</h${level}>`)
    } else if (bullet || ordered) {
      flushPara()
      flushQuote()
      const type = bullet ? 'ul' : 'ol'
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push((bullet ?? ordered)?.[1] ?? '')
    } else if (q) {
      flushPara()
      flushList()
      quote.push(q[1] ?? '')
    } else if (list && /^\s{2,}\S/.test(line)) {
      // Continuación de un elemento de lista.
      list.items[list.items.length - 1] += ` ${line.trim()}`
    } else {
      flushList()
      flushQuote()
      para.push(line.trim())
    }
  }
  flushAll()
  return out.join('\n')
}

/** Texto plano (para indexar): quita marcas de Markdown. */
export function markdownToText(source: string): string {
  return source
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*([-*]|\d+[.)])\s+/gm, '')
}

/** HTML → texto plano para indexar (sin scripts ni estilos). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Front matter simple `clave: valor` entre líneas `---`. */
export function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source.replace(/\r\n?/g, '\n'))
  if (!m) return { meta: {}, body: source }
  const meta: Record<string, string> = {}
  for (const line of (m[1] ?? '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: source.replace(/\r\n?/g, '\n').slice(m[0].length) }
}
