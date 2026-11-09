/** Divide un fragmento con marcas [[resaltado]] en partes seguras para renderizar sin v-html. */
export function splitSnippet(snippet: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = []
  const re = /\[\[([\s\S]*?)\]\]/g
  let last = 0
  for (const m of snippet.matchAll(re)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), mark: false })
    parts.push({ text: m[1] ?? '', mark: true })
    last = m.index + m[0].length
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), mark: false })
  return parts
}

/** Solo rutas del lector Kiwix servidas por este equipo. */
export function isSafeReaderPath(u: string): boolean {
  return /^\/kiwix\/[\w\-/#%.?=&:~+]*$/.test(u) && !u.includes('..') && !u.startsWith('//')
}
