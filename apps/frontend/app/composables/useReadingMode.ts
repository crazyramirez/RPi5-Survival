/**
 * Modo lectura a pantalla completa para los visores (PDF, documentos, lector de la biblioteca, guías): oculta las
 * barras de la app y de la página (`.reading-hide`, regla global en main.css) y deja solo el documento. Fuera del
 * quiosco pide además la pantalla completa del sistema (Fullscreen API); en el quiosco ya lo es.
 * Se sale con el botón flotante (ReadingExit), con Escape o al cambiar de pantalla (layouts/default.vue).
 */
export function useReadingMode() {
  const on = useState<boolean>('reading:on', () => false)
  /** La pantalla completa del sistema la pidió este modo (solo entonces se deshace al salir). */
  const ownFullscreen = useState<boolean>('reading:fs', () => false)

  async function enter(): Promise<void> {
    on.value = true
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        ownFullscreen.value = true
      }
    } catch {
      // Sin permiso o sin soporte (WebView de Android): basta con ocultar las barras de la app.
    }
  }

  async function exit(): Promise<void> {
    on.value = false
    if (!ownFullscreen.value) return
    ownFullscreen.value = false
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      // ya no estaba a pantalla completa
    }
  }

  return { on, enter, exit, toggle: () => (on.value ? exit() : enter()), ownFullscreen }
}
