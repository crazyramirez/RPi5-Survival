import { assertPortable, installState, loadInstaller, portablePaths } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/** «Instalar en este equipo»: copia la carpeta a la de aplicaciones del usuario y crea accesos directos. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertPortable()
  if (installState.state === 'running') throw createError({ statusCode: 409, statusMessage: 'Instalación en curso' })
  const { installHere } = await loadInstaller()
  Object.assign(installState, { state: 'running', message: 'Preparando…', dest: null, shortcuts: [] })
  installHere({ root: portablePaths().root, onProgress: (m) => (installState.message = m) })
    .then((r) => Object.assign(installState, { state: 'done', message: null, dest: r.dest, shortcuts: r.shortcuts }))
    .catch((err: unknown) => Object.assign(installState, { state: 'failed', message: err instanceof Error ? err.message.slice(0, 300) : 'Error' }))
  return { ...installState }
})
