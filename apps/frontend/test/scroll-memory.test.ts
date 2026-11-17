import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readerPosition, rememberReaderPosition, restoreScroll, snapshotScroll } from '../app/utils/scroll-memory'

/** Elemento mínimo: lo que usan snapshotScroll/restoreScroll (sin DOM en los tests). */
interface Fake {
  tagName: string
  className: string
  children: Fake[]
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  listeners: Map<string, () => void>
  addEventListener: (e: string, f: () => void) => void
  removeEventListener: (e: string) => void
}

function el(className: string, children: Fake[] = [], scroll: Partial<Fake> = {}): Fake {
  const listeners = new Map<string, () => void>()
  return {
    tagName: 'DIV', className, children, scrollTop: 0, scrollLeft: 0, scrollHeight: 100, clientHeight: 100,
    scrollWidth: 100, clientWidth: 100, listeners,
    addEventListener: (e, f) => listeners.set(e, f),
    removeEventListener: (e) => listeners.delete(e),
    ...scroll,
  }
}
const asEl = (f: Fake): Element => f as unknown as Element

describe('memoria de desplazamiento', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('anota solo los paneles desplazados, con su camino y su firma', () => {
    const list = el('page lib', [el('head'), el('cats', [], { scrollTop: 40 })], { scrollTop: 900 })
    const snap = snapshotScroll(asEl(el('content', [list])))
    expect(snap).toEqual([
      { path: [0], sig: 'DIV.page lib', top: 900, left: 0 },
      { path: [0, 1], sig: 'DIV.cats', top: 40, left: 0 },
    ])
  })

  it('no entra en iframes ni gráficos', () => {
    const frame = el('x', [el('inner', [], { scrollTop: 50 })])
    frame.tagName = 'IFRAME'
    expect(snapshotScroll(asEl(el('content', [frame])))).toEqual([])
  })

  it('espera a que el contenido sea lo bastante alto y mantiene la posición un momento', () => {
    const page = el('page', [], { scrollHeight: 100, clientHeight: 100 })
    const root = el('content', [page])
    restoreScroll(asEl(root), [{ path: [0], sig: 'DIV.page', top: 900, left: 0 }], 8000, 600)
    expect(page.scrollTop).toBe(0) // todavía cargando: no cabe
    page.scrollHeight = 2000 // llegan los datos
    vi.advanceTimersByTime(100)
    expect(page.scrollTop).toBe(900)
    page.scrollTop = 0 // la pantalla vuelve arriba al terminar de pintar
    vi.advanceTimersByTime(100)
    expect(page.scrollTop).toBe(900)
    vi.advanceTimersByTime(1000)
    expect(root.listeners.size).toBe(0) // terminado
    page.scrollTop = 0
    vi.advanceTimersByTime(500)
    expect(page.scrollTop).toBe(0) // ya no interviene
  })

  it('un gesto del usuario lo detiene', () => {
    const page = el('page', [], { scrollHeight: 100 })
    const root = el('content', [page])
    restoreScroll(asEl(root), [{ path: [0], sig: 'DIV.page', top: 500, left: 0 }])
    root.listeners.get('pointerdown')?.()
    page.scrollHeight = 2000
    vi.advanceTimersByTime(300)
    expect(page.scrollTop).toBe(0)
  })

  it('no toca un panel distinto en el mismo sitio', () => {
    const other = el('otra-pantalla', [], { scrollHeight: 3000 })
    restoreScroll(asEl(el('content', [other])), [{ path: [0], sig: 'DIV.page', top: 500, left: 0 }])
    vi.advanceTimersByTime(300)
    expect(other.scrollTop).toBe(0)
  })

  it('el lector recuerda la posición de cada artículo', () => {
    rememberReaderPosition('/kiwix/viewer#wiki/A/Agua', 1234)
    expect(readerPosition('/kiwix/viewer#wiki/A/Agua')).toBe(1234)
    expect(readerPosition('/kiwix/viewer#wiki/A/Fuego')).toBe(0)
  })
})
