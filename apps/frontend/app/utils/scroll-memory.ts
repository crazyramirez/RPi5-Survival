/**
 * Memoria de desplazamiento. La app no desplaza la ventana sino sus propios paneles (.page, lectores, listas), así
 * que el navegador no restaura nada al volver. Al salir de una pantalla se anota la posición de cada panel desplazado
 * (por su camino en el árbol: hijo n del hijo m…) y al volver se recupera, reintentando mientras el contenido carga.
 */
export interface ScrollEntry {
  /** Índices de hijo desde la raíz hasta el panel. */
  path: number[]
  /** Etiqueta y clases del panel: si no coinciden al volver, no es el mismo panel y no se toca. */
  sig: string
  top: number
  left: number
}

const MAX_ENTRIES = 12
const MAX_DEPTH = 40

const signature = (el: Element): string => `${el.tagName}.${typeof el.className === 'string' ? el.className : ''}`

/** Paneles desplazados bajo `root` (incluida la propia raíz). */
export function snapshotScroll(root: Element): ScrollEntry[] {
  const out: ScrollEntry[] = []
  const walk = (el: Element, path: number[]): void => {
    if (out.length >= MAX_ENTRIES || path.length > MAX_DEPTH) return
    if (el.scrollTop > 0 || el.scrollLeft > 0) out.push({ path, sig: signature(el), top: el.scrollTop, left: el.scrollLeft })
    // Gráficos y documentos incrustados: ni se desplazan como paneles de la app ni merece la pena recorrerlos.
    if (el.tagName === 'svg' || el.tagName === 'IFRAME' || el.tagName === 'CANVAS') return
    const kids = el.children
    for (let i = 0; i < kids.length; i++) walk(kids[i]!, [...path, i])
  }
  walk(root, [])
  return out
}

function resolve(root: Element, entry: ScrollEntry): Element | null {
  let el: Element | undefined = root
  for (const i of entry.path) {
    el = el.children[i]
    if (!el) return null
  }
  return signature(el) === entry.sig ? el : null
}

/**
 * Recupera las posiciones anotadas. El contenido puede llegar más tarde (peticiones, PDF que se pintan): se
 * reintenta hasta `timeoutMs`, y se mantiene la posición un momento por si la propia pantalla vuelve arriba al
 * terminar de cargar. Cualquier gesto del usuario (tocar, rueda, tecla) lo detiene. → función para cancelar.
 */
export function restoreScroll(root: Element, entries: ScrollEntry[], timeoutMs = 8000, holdMs = 600): () => void {
  if (!entries.length) return () => {}
  const start = Date.now()
  let reachedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null
  const EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    for (const e of EVENTS) root.removeEventListener(e, stop, true)
  }
  const tick = (): void => {
    let all = true
    for (const entry of entries) {
      const el = resolve(root, entry)
      if (!el) {
        all = false
        continue
      }
      const fits = el.scrollHeight - el.clientHeight >= entry.top - 1 && el.scrollWidth - el.clientWidth >= entry.left - 1
      if (Math.abs(el.scrollTop - entry.top) > 2 || Math.abs(el.scrollLeft - entry.left) > 2) {
        if (fits) {
          el.scrollTop = entry.top
          el.scrollLeft = entry.left
        } else all = false
      }
    }
    const now = Date.now()
    if (all && !reachedAt) reachedAt = now
    if ((reachedAt && now - reachedAt >= holdMs) || now - start >= timeoutMs) stop()
  }
  for (const e of EVENTS) root.addEventListener(e, stop, { capture: true, passive: true })
  tick()
  timer = setInterval(tick, 100)
  return stop
}

/** Lector de la biblioteca: posición vertical de cada artículo leído en la sesión (ruta del lector → px). */
const readerPositions = new Map<string, number>()

export function rememberReaderPosition(path: string, y: number): void {
  readerPositions.delete(path)
  readerPositions.set(path, y)
  while (readerPositions.size > 100) readerPositions.delete(readerPositions.keys().next().value!)
}

export function readerPosition(path: string): number {
  return readerPositions.get(path) ?? 0
}

/** Lleva el documento del artículo a `y` mientras carga (imágenes que empujan el texto); un gesto lo detiene. */
export function restoreWindowScroll(win: Window, y: number, timeoutMs = 5000, holdMs = 600): void {
  if (y <= 0) return
  const start = Date.now()
  let reachedAt = 0
  const EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
  const stop = (): void => {
    clearInterval(timer)
    for (const e of EVENTS) win.removeEventListener(e, stop, true)
  }
  const timer = setInterval(() => {
    try {
      if (Math.abs(win.scrollY - y) > 2) win.scrollTo(0, y)
      if (Math.abs(win.scrollY - y) <= 2) reachedAt ||= Date.now()
      if ((reachedAt && Date.now() - reachedAt >= holdMs) || Date.now() - start >= timeoutMs) stop()
    } catch {
      stop() // documento descargado (se navegó a otro)
    }
  }, 100)
  for (const e of EVENTS) win.addEventListener(e, stop, { capture: true, passive: true })
}
