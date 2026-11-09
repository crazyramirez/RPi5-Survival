import type { NavStatus } from '@survival-os/shared-types'

/** Estado de navegación (gpsd vía servicio navigation), compartido por toda la UI. */
export function useNav() {
  const nav = useState<NavStatus | null>('nav:status', () => null)
  const navDown = useState<boolean>('nav:down', () => false)

  async function refreshNav(): Promise<void> {
    try {
      nav.value = await $fetch<NavStatus>('/api/nav/status', { timeout: 4000, retry: 0 })
      navDown.value = false
    } catch {
      navDown.value = true
      nav.value = null
    }
  }

  return { nav, navDown, refreshNav }
}
