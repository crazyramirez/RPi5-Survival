import { restoreScroll, snapshotScroll } from '~/utils/scroll-memory'
import type { ScrollEntry } from '~/utils/scroll-memory'

/**
 * Volver es volver a donde estabas: al salir de una pantalla se anota cuánto estaban desplazados sus paneles y,
 * al regresar con «Atrás» (o a una pantalla que se mantiene viva, keepalive: biblioteca y emergencias), se recupera.
 * Las pantallas con iframe (lector de la biblioteca) recuerdan además su propia posición (ver leer.vue).
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const saved = new Map<string, ScrollEntry[]>()
  let poppedAt = 0
  let cancel: (() => void) | null = null
  window.addEventListener('popstate', () => (poppedAt = Date.now()))

  const root = (): Element | null => document.querySelector('main.content')

  router.beforeEach((_to, from) => {
    cancel?.()
    cancel = null
    const el = root()
    if (!el || !from.matched.length) return
    const snap = snapshotScroll(el)
    saved.delete(from.fullPath)
    if (snap.length) saved.set(from.fullPath, snap)
    // Solo las últimas pantallas: es memoria de la sesión, no un historial.
    while (saved.size > 40) saved.delete(saved.keys().next().value!)
  })

  router.afterEach((to, from, failure) => {
    const popped = Date.now() - poppedAt < 1500
    poppedAt = 0
    if (failure || to.path === from.path) return
    const snap = saved.get(to.fullPath)
    if (!snap || !(popped || to.meta.keepalive)) return
    // Tras pintar la pantalla nueva (y reactivar la que estaba viva).
    void nextTick(() =>
      requestAnimationFrame(() => {
        const el = root()
        if (el) cancel = restoreScroll(el, snap)
      }),
    )
  })
})
