import { allowPrivateRequest, isPrivatePath } from '../utils/net'

/**
 * Deniega rutas privadas (bóveda) a cualquier cliente que no sea el propio equipo.
 * Defensa en profundidad: además, el servidor escucha por defecto solo en 127.0.0.1.
 */
export default defineEventHandler((event) => {
  if (!isPrivatePath(event.path)) return
  const remote = event.node.req.socket.remoteAddress
  if (!allowPrivateRequest(remote, event.node.req.headers)) {
    throw createError({ statusCode: 403, statusMessage: 'Solo accesible desde la pantalla local' })
  }
})
