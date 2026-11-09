import { POLL_INTERVAL_MS } from '~/composables/useDeviceStatus'

/**
 * Arranque en cliente: ajustes de pantalla, reloj por minuto y sondeo de estado.
 * Todo se pausa cuando la página no es visible (ahorro de CPU/energía).
 */
export default defineNuxtPlugin(() => {
  useDisplaySettings().init()

  const now = useNow()
  const { refresh } = useDeviceStatus()
  const { refreshNav } = useNav()

  let pollTimer: ReturnType<typeof setInterval> | undefined
  let clockTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleClock(): void {
    now.value = new Date()
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 50
    clockTimer = setTimeout(scheduleClock, msToNextMinute)
  }

  // Vista pública (móvil en el punto de acceso): sin sondeo de estado ni de posición (no están en la lista blanca).
  const publicView = isPublicView()

  function start(): void {
    stop()
    scheduleClock()
    if (publicView) return
    void refresh()
    void refreshNav()
    pollTimer = setInterval(() => {
      now.value = new Date()
      void refresh()
      void refreshNav()
    }, POLL_INTERVAL_MS)
  }

  function stop(): void {
    if (pollTimer) clearInterval(pollTimer)
    if (clockTimer) clearTimeout(clockTimer)
    pollTimer = undefined
    clockTimer = undefined
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()))
  // Bloquea el menú contextual de pulsación larga en el kiosco.
  document.addEventListener('contextmenu', (e) => e.preventDefault())

  start()
})
