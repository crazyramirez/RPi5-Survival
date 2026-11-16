/**
 * Lector del CHANGELOG.md para la ventana «Novedades» (ChangelogDialog): secciones «## X.Y.Z — fecha · título»
 * con Markdown mínimo («### Título», viñetas «- » con sangría, **negrita**, `código`). Todo se escapa antes de dar
 * formato: el resultado se pinta con v-html.
 */
export interface ChangelogSection {
  version: string
  date: string
  title: string
  html: string
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s: string): string =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

export function renderChangelogMd(md: string): string {
  const out: string[] = []
  // Niveles de lista abiertos y si cada uno tiene un <li> abierto (una sublista va DENTRO de su <li>).
  const levels: { depth: number; liOpen: boolean }[] = []
  let text: string[] | null = null
  const emitText = (): void => {
    if (text) out.push(inline(text.join(' ')))
    text = null
  }
  const closeTo = (depth: number): void => {
    while (levels.length && levels[levels.length - 1]!.depth > depth) {
      emitText()
      if (levels[levels.length - 1]!.liOpen) out.push('</li>')
      out.push('</ul>')
      levels.pop()
    }
  }
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    const h = /^###\s+(.*)$/.exec(line)
    const li = /^(\s*)-\s+(.*)$/.exec(line)
    if (h) {
      closeTo(0)
      out.push(`<h4>${inline(h[1]!)}</h4>`)
    } else if (li) {
      const depth = Math.floor(li[1]!.length / 2) + 1
      const top = levels[levels.length - 1]
      if (!top || depth > top.depth) {
        emitText()
        out.push('<ul>')
        levels.push({ depth, liOpen: false })
      } else {
        closeTo(depth)
        emitText()
        const cur = levels[levels.length - 1]!
        if (cur.liOpen) out.push('</li>')
        cur.liOpen = false
      }
      out.push('<li>')
      levels[levels.length - 1]!.liOpen = true
      text = [li[2]!]
    } else if (text) {
      text.push(line.trim())
    } else {
      closeTo(0)
      out.push(`<p>${inline(line.trim())}</p>`)
    }
  }
  closeTo(0)
  return out.join('')
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Secciones de las versiones posteriores a `from` hasta `version` (o solo `version` sin `from`), la más nueva primero. */
export function changelogSections(md: string, version: string, from: string | null = null, max = 8): ChangelogSection[] {
  const all: ChangelogSection[] = []
  for (const p of md.split(/^## /m).slice(1)) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim()
    const m = /^(\d+\.\d+\.\d+)\s*—\s*([^·]+?)\s*(?:·\s*(.*))?$/.exec(head)
    if (!m) continue
    all.push({ version: m[1]!, date: m[2]!.trim(), title: (m[3] ?? '').trim(), html: renderChangelogMd(nl < 0 ? '' : p.slice(nl + 1)) })
  }
  const f = from && /^\d+\.\d+\.\d+$/.test(from) ? from : null
  return all
    .filter((s) => compareVersions(s.version, version) <= 0 && (f ? compareVersions(s.version, f) > 0 : s.version === version))
    .slice(0, max)
}
