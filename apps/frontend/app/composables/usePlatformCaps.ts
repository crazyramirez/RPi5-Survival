import { platformCaps, type PlatformCaps } from '~/utils/platform'

/**
 * Capacidades de la plataforma actual (ver utils/platform.ts): qué se muestra en Pi, portable y Android.
 * Reactivo: en la portable el sistema anfitrión (Windows, macOS o Linux) llega con la primera lectura del estado.
 */
export function usePlatformCaps(): ComputedRef<PlatformCaps> {
  const android = useAndroid()
  const portable = usePortable()
  const { status } = useDeviceStatus()
  return computed(() => platformCaps({ android, portable, os: status.value?.platform.os ?? null }))
}
