import type { Favorite } from '@survival-os/shared-types'

/** Estado compartido de la biblioteca (favoritos) y acciones. */
export function useLibrary() {
  const favorites = useState<Favorite[]>('library:favorites', () => [])
  const loaded = useState<boolean>('library:favLoaded', () => false)

  async function loadFavorites(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      favorites.value = await $fetch<Favorite[]>('/api/library/favorites', { timeout: 5000, retry: 0 })
      loaded.value = true
    } catch {
      // Servicio no disponible: la UI muestra el estado del servicio en la página.
    }
  }

  async function toggleFavorite(id: string, title: string, href: string): Promise<void> {
    const exists = favorites.value.some((f) => f.id === id)
    const url = `/api/library/favorites/${encodeURIComponent(id)}`
    await ($fetch as (u: string, o: Record<string, unknown>) => Promise<unknown>)(url, {
      method: exists ? 'DELETE' : 'PUT',
      body: exists ? undefined : { title, href },
      headers: { 'x-survival-action': '1' },
      timeout: 5000,
      retry: 0,
    })
    await loadFavorites(true)
  }

  return { favorites, loadFavorites, toggleFavorite }
}
