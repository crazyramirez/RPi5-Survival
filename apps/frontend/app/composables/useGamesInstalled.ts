import type { GamesStatus } from '@survival-os/shared-types'

/**
 * ¿Está descargada la copia offline de los juegos (ADR 0012)? Estado compartido entre la barra
 * inferior (el botón «Juegos» solo aparece si es true) y la tarjeta de Mantenimiento, que lo
 * actualiza al descargar o quitar. Sin medida (error, aún cargando) = false: no se ofrece.
 */
export function useGamesInstalled() {
  const installed = useState<boolean>('games-installed', () => false)
  function set(status: GamesStatus | null): void {
    installed.value = !!status?.installed
  }
  async function refresh(): Promise<GamesStatus | null> {
    const st = await $fetch<GamesStatus>('/api/games/status', { timeout: 6000, retry: 0 }).catch(() => null)
    set(st)
    return st
  }
  return { installed, set, refresh }
}
