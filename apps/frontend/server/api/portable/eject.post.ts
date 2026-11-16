import { assertPortable, cleanMessages, currentVolume } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/**
 * «Expulsar la memoria USB» (ADR 0019): el lanzador cierra Survival OS y un ayudante fuera de la memoria la
 * expulsa cuando Node ya no se ejecuta desde ella, y avisa de que se puede retirar.
 */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertPortable()
  const body = (await readBody<{ messages?: unknown }>(event).catch(() => null)) ?? {}
  if (typeof process.send !== 'function') throw createError({ statusCode: 503, statusMessage: 'Lanzador no disponible' })
  const v = await currentVolume(true)
  if (!v.removable) throw createError({ statusCode: 409, statusMessage: 'Survival OS no se ejecuta desde una memoria USB' })
  // En Windows se expulsa una unidad (E:\); una carpeta tratada como medio (pruebas, red) no se puede expulsar.
  if (process.platform === 'win32' && !/^[A-Za-z]:\\?$/.test(v.mount ?? '')) throw createError({ statusCode: 409, statusMessage: 'Esta unidad no se puede expulsar desde Survival OS' })
  const messages = cleanMessages(body.messages, ['title', 'ok', 'fail'])
  // Se responde antes de cerrar para que la interfaz pueda mostrar «Expulsando…».
  setTimeout(() => process.send?.({ type: 'eject', messages }), 300)
  return { accepted: true, mount: v.mount }
})
