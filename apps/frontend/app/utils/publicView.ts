/**
 * Vista pública (ADR 0009): la app abierta desde un móvil conectado al punto de acceso del equipo.
 * Se detecta por el nombre de host: la pantalla local siempre usa loopback. Es solo una capa de
 * presentación; la seguridad real la ponen la pasarela (lista blanca) y el guardián privado de Nitro.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isPublicView(): boolean {
  return import.meta.client && !LOCAL_HOSTS.has(window.location.hostname)
}

/** Rutas de la SPA disponibles en la vista pública (mismas que la lista blanca de la pasarela). */
const PUBLIC_ROUTES = [/^\/$/, /^\/mapas\/?$/, /^\/emergencias\/?$/, /^\/emergencias\/[a-z0-9-]{1,80}\/?$/, /^\/biblioteca\/?$/, /^\/biblioteca\/leer\/?$/]

export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((re) => re.test(path))
}

/** Módulos de inicio visibles en la vista pública. */
export const PUBLIC_MODULES = new Set(['maps', 'library', 'emergency'])
