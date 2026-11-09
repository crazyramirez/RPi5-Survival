import type { H3Event } from 'h3'
import { assertTrustedAction } from './system'

/**
 * Reenvía la petición a un servicio local (loopback). Las escrituras exigen la
 * cabecera de acción (CSRF); el destino nunca lo elige el cliente.
 */
export async function proxyToLocal(event: H3Event, target: string, opts: { allowWrite?: boolean; timeoutMs?: number } = {}) {
  const method = event.method
  if (method !== 'GET' && method !== 'HEAD') {
    if (!opts.allowWrite) throw createError({ statusCode: 405, statusMessage: 'Método no permitido' })
    assertTrustedAction(event)
  }
  // Si el navegador cierra (sale de la página), se corta también la petición al servicio:
  // así el asistente libera el único hueco del modelo en vez de seguir generando para nadie.
  const clientGone = new AbortController()
  event.node.res.once('close', () => clientGone.abort())
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 120_000), clientGone.signal])
  try {
    return await proxyRequest(event, target, {
      // Las redirecciones llegan tal cual al navegador: si el proxy las siguiera, el
      // navegador se quedaría en la URL original y las rutas relativas del contenido
      // (p. ej. /kiwix/content/<libro> → <libro>/Página_principal) se resolverían mal.
      fetchOptions: { signal, redirect: 'manual' },
      // No reenviar cookies ni cabeceras de origen al servicio interno.
      headers: { cookie: '', origin: '' },
    })
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Servicio local no disponible' })
  }
}
