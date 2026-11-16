/**
 * Actualizaciones al abrir (ADR 0021): al arrancar la app, al volver a primer plano y al recuperar la conexión,
 * pide al equipo que compruebe si hay versión nueva. El equipo decide según el modo (desactivada: nada) y sale a
 * Internet como mucho cada 10 min; sin red no se anota ningún error. Después se relee el aviso de la barra.
 */
export default defineNuxtPlugin(() => {
  if (isPublicView()) return
  const updates = useUpdates()
  const timers: ReturnType<typeof setTimeout>[] = []

  async function wake(): Promise<void> {
    if (document.hidden || navigator.onLine === false) return
    const r = await postAction<{ started?: boolean }>('/api/update/wake').catch(() => null)
    if (!r?.started) return
    // La comprobación tarda unos segundos (más si en «Automática» descarga): se relee el estado un par de veces.
    timers.splice(0).forEach(clearTimeout)
    for (const ms of [8_000, 30_000, 120_000]) timers.push(setTimeout(() => void updates.refresh(), ms))
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void wake()
  })
  window.addEventListener('online', () => void wake())
  // Android: la actividad vuelve a primer plano (MainActivity.onResume).
  window.addEventListener('app-resume', () => void wake())
  // Al abrir: un instante después, para no competir con la primera carga de la pantalla.
  setTimeout(() => void wake(), 5_000)
})
