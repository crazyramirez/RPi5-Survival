import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { portablePaths } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'
import { updateKind } from '../../utils/update'

/**
 * Portable de escritorio: «Reiniciar y aplicar ahora» la versión que la actualización automática dejó preparada
 * (sin esto se aplica al cerrar). El lanzador cierra, aplica con autoprueba y vuelve a abrir (ADR 0021).
 */
export default defineEventHandler((event) => {
  assertTrustedAction(event)
  if (updateKind() !== 'portable') throw createError({ statusCode: 409, statusMessage: 'Solo en la versión portable' })
  if (!existsSync(join(portablePaths().root, '.update', 'ready.json'))) throw createError({ statusCode: 409, statusMessage: 'No hay ninguna actualización preparada' })
  if (!process.send) throw createError({ statusCode: 409, statusMessage: 'Sin lanzador: no se puede aplicar' })
  // Un instante para que llegue la respuesta antes de que se cierre todo.
  setTimeout(() => process.send?.({ type: 'update' }), 1500)
  return { ok: true }
})
