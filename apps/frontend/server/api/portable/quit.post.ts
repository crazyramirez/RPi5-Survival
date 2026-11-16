import { assertPortable } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/** «Cerrar Survivelia OS»: pide al lanzador (canal IPC) que detenga todos los servicios. */
export default defineEventHandler((event) => {
  assertTrustedAction(event)
  assertPortable()
  if (typeof process.send !== 'function') throw createError({ statusCode: 503, statusMessage: 'Lanzador no disponible' })
  // Se responde antes de cerrar para que la interfaz pueda mostrar «Cerrando…».
  setTimeout(() => process.send?.({ type: 'quit' }), 300)
  return { accepted: true }
})
