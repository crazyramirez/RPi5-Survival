/** En la vista pública, cualquier ruta fuera de la lista vuelve a Inicio (también la navegación interna). */
export default defineNuxtRouteMiddleware((to) => {
  if (isPublicView() && !isPublicRoute(to.path)) return navigateTo('/')
})
