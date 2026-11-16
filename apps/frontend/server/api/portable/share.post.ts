import { assertPortable } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/** «Compartir en la red local» (ADR 0016): el lanzador arranca/para la pasarela pública de solo lectura. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertPortable()
  const body = (await readBody<{ on?: unknown }>(event).catch(() => null)) ?? {}
  if (typeof process.send !== 'function') throw createError({ statusCode: 503, statusMessage: 'Lanzador no disponible' })
  process.send({ type: 'share', on: body.on === true })
  return { accepted: true }
})
