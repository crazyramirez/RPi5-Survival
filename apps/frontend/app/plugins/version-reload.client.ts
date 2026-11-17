import { VERSION_CHECK_EVENT } from '~/utils/version-check'

/**
 * Tras actualizar (ADR 0021) los servicios se reinician con la versión nueva, pero una pantalla ya abierta (el
 * quiosco de la Pi, una ventana de la portable) seguiría con la interfaz antigua en memoria. Cada minuto se
 * compara la versión que responde el equipo con la de esta interfaz; si es otra, se recarga sola.
 * Sin red local que consultar o en desarrollo, no hace nada. useUpdates pide una comprobación inmediata
 * (evento VERSION_CHECK_EVENT) en cuanto ve otra versión instalada, para no esperar hasta un minuto tras instalar.
 */
export default defineNuxtPlugin(() => {
  const mine = String(useRuntimeConfig().public.version ?? '')
  if (!/^\d+\.\d+\.\d+$/.test(mine) || import.meta.dev) return
  let reloading = false

  async function check(): Promise<void> {
    if (reloading || document.hidden) return
    const h = await $fetch<{ version?: string }>('/api/health', { timeout: 5000, retry: 0, ignoreResponseError: true }).catch(() => null)
    const v = h?.version
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) && v !== mine) {
      reloading = true
      window.location.reload()
    }
  }

  setInterval(() => void check(), 60_000)
  window.addEventListener(VERSION_CHECK_EVENT, () => void check())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check()
  })
})
