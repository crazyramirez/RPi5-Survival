/**
 * Brújula del propio dispositivo (tablets y móviles: Android, también navegadores móviles). Usa la orientación
 * absoluta que da el sistema al combinar magnetómetro, giroscopio y acelerómetro (`deviceorientationabsolute`);
 * en iOS, `webkitCompassHeading`. Devuelve el rumbo hacia donde apunta la parte superior de la pantalla, en
 * grados respecto al norte MAGNÉTICO, suavizado. Sin sensor (Pi, portátil) queda en null: nunca se inventa.
 */
export function useDeviceHeading() {
  const heading = ref<number | null>(null)
  let last = 0

  function screenAngle(): number {
    const a = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined
    return typeof a === 'number' ? a : 0
  }

  function push(deg: number): void {
    const now = performance.now()
    const h = ((deg % 360) + 360) % 360
    const cur = heading.value
    if (cur === null) heading.value = h
    else {
      // Suavizado por el camino corto del círculo (sin saltos 359° → 0°).
      const d = ((h - cur + 540) % 360) - 180
      heading.value = (cur + d * 0.25 + 360) % 360
    }
    last = now
  }

  function onAbsolute(e: DeviceOrientationEvent): void {
    if (e.alpha == null) return
    push(360 - e.alpha + screenAngle())
  }

  function onRelative(e: DeviceOrientationEvent & { webkitCompassHeading?: number }): void {
    if (typeof e.webkitCompassHeading === 'number') push(e.webkitCompassHeading + screenAngle())
    else if (e.absolute && e.alpha != null) push(360 - e.alpha + screenAngle())
  }

  let stale: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return
    window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener)
    window.addEventListener('deviceorientation', onRelative as EventListener)
    // Si el sensor deja de informar (pantalla apagada, sensor dormido), no se muestra un rumbo viejo.
    stale = setInterval(() => {
      if (heading.value !== null && performance.now() - last > 4000) heading.value = null
    }, 2000)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener)
    window.removeEventListener('deviceorientation', onRelative as EventListener)
    if (stale) clearInterval(stale)
  })

  return heading
}
