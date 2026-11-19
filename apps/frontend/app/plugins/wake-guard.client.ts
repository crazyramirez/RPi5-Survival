import { wakeGuard, type WakeInput } from '~/utils/wake-guard'

/**
 * Quiosco de la Pi: el toque que enciende la pantalla apagada no pulsa nada (ver utils/wake-guard.ts).
 * El tiempo de apagado (SCREEN_OFF_SECONDS de /etc/survival-os/kiosk.env) lo da /api/system/screen; en la portable,
 * Android o sin quiosco vale 0 y esto no hace nada (allí el propio sistema se come el toque que despierta).
 */
export default defineNuxtPlugin(() => {
  async function load(): Promise<void> {
    try {
      const r = await $fetch<{ offAfterSeconds: number }>('/api/system/screen', { timeout: 8000, retry: 0 })
      wakeGuard.setOffAfter(r.offAfterSeconds)
    } catch {
      // se reintenta en la siguiente vuelta
    }
  }
  void load()
  setInterval(() => void load(), 5 * 60_000)

  // Actividad que la página no ve como toques: un juego en un iframe con el foco (sus toques van al iframe) o un
  // vídeo reproduciéndose (Chromium impide que se apague). Cuentan como pantalla encendida.
  setInterval(() => {
    const busy = document.activeElement?.tagName === 'IFRAME' || [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended)
    if (busy) wakeGuard.input('move', Date.now())
  }, 5000)

  const on = (type: string, kind: WakeInput, passive = false) =>
    window.addEventListener(
      type,
      (e) => {
        if (!wakeGuard.input(kind, Date.now())) return
        if (e.cancelable) e.preventDefault()
        e.stopImmediatePropagation()
      },
      { capture: true, passive },
    )

  // Orden de un toque: pointerdown → touchstart → pointerup → touchend → mousedown → mouseup → click.
  on('pointerdown', 'start')
  on('touchstart', 'click')
  on('pointermove', 'move')
  on('touchmove', 'click') // sin desplazar la página mientras se descarta el gesto
  on('wheel', 'move')
  on('pointerup', 'end')
  on('pointercancel', 'end')
  for (const type of ['touchend', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) on(type, 'click')
  on('keydown', 'key')
})
