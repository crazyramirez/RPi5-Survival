import type { UpdateMode, UpdateStatus } from '@survival-os/shared-types'
import { locale } from '~/utils/i18n'

/**
 * Actualizaciones desde GitHub (ADR 0021): estado compartido entre la barra de estado (aviso «Actualización X») y
 * la tarjeta de Mantenimiento. La web nunca sale a Internet: solo lee lo que dejaron las tareas update-*.
 */
export function useUpdates() {
  const status = useState<UpdateStatus | null>('update-status', () => null)

  async function refresh(): Promise<UpdateStatus | null> {
    status.value = await $fetch<UpdateStatus>(`/api/update?lang=${locale.value}`, { timeout: 6000, retry: 0 }).catch(() => status.value)
    return status.value
  }

  async function setMode(mode: UpdateMode): Promise<void> {
    status.value = await postAction<UpdateStatus>(`/api/update/settings?lang=${locale.value}`, { mode })
  }

  /** Portable: aplicar ya la versión preparada (cierra, aplica con autoprueba y reabre). */
  async function applyNow(): Promise<void> {
    await postAction('/api/update/apply')
  }

  /** Hay algo que el usuario debería saber: versión nueva, descargada o lista para aplicarse. */
  const pending = computed(() => {
    const s = status.value
    if (!s?.supported) return null
    if (s.prepared && s.prepared !== s.installed) return s.prepared
    return s.status === 'available' ? (s.latest?.version ?? null) : null
  })

  return { status, refresh, setMode, applyNow, pending }
}
