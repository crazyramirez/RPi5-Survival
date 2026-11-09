#!/usr/bin/env node
/**
 * Pasarela de la vista pública (ADR 0009). Solo corre con el punto de acceso Wi-Fi encendido.
 *
 * Escucha en la IP del AP (10.42.0.1:80) y reenvía a la web local (127.0.0.1:3000) SOLO:
 *   - métodos GET/HEAD;
 *   - rutas de una lista blanca cerrada (mapas, emergencias, libros Kiwix, protocolos, salud);
 *   - siempre con X-Forwarded-For → el guardián privado de Nitro rechaza cualquier ruta privada
 *     aunque algo se colara (doble barrera).
 * Cualquier otro host (comprobaciones de conectividad de los móviles) recibe 302 a la portada:
 * el móvil muestra el aviso «Iniciar sesión en la red» y abre Survival OS (portal cautivo).
 * Sin dependencias: Node estándar.
 */
import { createServer, request } from 'node:http'

const HOST = process.env.PUBLIC_HOST || '10.42.0.1'
const PORT = Number(process.env.PUBLIC_PORT || 80)
const UP_HOST = '127.0.0.1'
const UP_PORT = Number(process.env.NITRO_PORT || 3000)
const PUBLIC_NAMES = new Set([HOST, `${HOST}:${PORT}`, 'survival.local', 'survival'])

/** Páginas de la SPA permitidas (el resto de rutas se bloquean también en el cliente). */
const PAGES = [/^\/$/, /^\/mapas\/?$/, /^\/emergencias\/?$/, /^\/emergencias\/[a-z0-9-]{1,80}\/?$/, /^\/biblioteca\/?$/, /^\/biblioteca\/leer\/?$/]
/** Recursos y API de solo lectura con contenido público. */
const RESOURCES = [
  /^\/_nuxt\/[\w./-]+$/,
  // Glifos de MapLibre: «fonts/Noto Sans Regular,Noto Sans Bold/0-255.pbf» (espacios y comas).
  /^\/map-assets\/[\w ./,%-]+$/,
  /^\/maps-data\/[A-Za-z0-9_-]{1,80}\.pmtiles$/,
  /^\/kiwix\/[^\0]*$/,
  /^\/api\/health$/,
  /^\/api\/maps\/?$/,
  /^\/api\/library\/(status|books)$/,
  /^\/api\/library\/protocols(\/[a-z0-9-]{1,80})?$/,
]
// SOLO para probar en el PC contra `nuxt dev` (Vite sirve /_nuxt/@vite, /_nuxt/@fs/…). Nunca en la Pi.
if (process.env.PUBLIC_GATEWAY_DEV === '1') RESOURCES.push(/^\/_nuxt\/[^\0]*$/)

function log(msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), svc: 'public', msg, ...extra })}\n`)
}

export function allowed(method, rawUrl) {
  if (method !== 'GET' && method !== 'HEAD') return false
  let path
  try {
    path = decodeURIComponent(new URL(rawUrl, 'http://x').pathname)
  } catch {
    return false
  }
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return false
  return PAGES.some((re) => re.test(path)) || RESOURCES.some((re) => re.test(path))
}

function deny(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

export const server = createServer((req, res) => {
  const host = String(req.headers.host || '').toLowerCase()
  // Portal cautivo: cualquier dominio ajeno → portada de Survival OS.
  if (!PUBLIC_NAMES.has(host)) {
    res.writeHead(302, { location: `http://${HOST}/`, 'cache-control': 'no-store' })
    return res.end()
  }
  const url = req.url || '/'
  if (!allowed(req.method, url)) {
    const page = (req.headers.accept || '').includes('text/html')
    if (page && req.method === 'GET') {
      res.writeHead(302, { location: '/', 'cache-control': 'no-store' })
      return res.end()
    }
    return deny(res, 403, 'No disponible en la vista pública')
  }
  // Cabeceras limpias: nada de proxies anteriores; X-Forwarded-For siempre presente.
  const headers = {}
  for (const h of ['accept', 'accept-encoding', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'user-agent']) {
    if (req.headers[h]) headers[h] = req.headers[h]
  }
  headers['x-forwarded-for'] = req.socket.remoteAddress || 'unknown'
  headers['x-survival-public'] = '1'
  headers.host = `${UP_HOST}:${UP_PORT}`
  const up = request({ host: UP_HOST, port: UP_PORT, method: req.method, path: url, headers, timeout: 30_000 }, (r) => {
    const out = { ...r.headers }
    delete out['set-cookie']
    res.writeHead(r.statusCode || 502, out)
    r.pipe(res)
  })
  up.on('timeout', () => up.destroy(new Error('timeout')))
  up.on('error', () => {
    if (!res.headersSent) deny(res, 502, 'Survival OS no responde')
    else res.end()
  })
  req.on('aborted', () => up.destroy())
  up.end()
})
server.maxConnections = 64
server.headersTimeout = 15_000
server.requestTimeout = 60_000

// Solo arranca al ejecutarse directamente (las pruebas importan `allowed`).
if (import.meta.main) {
  server.listen(PORT, HOST, () => log('listening', { host: HOST, port: PORT, upstream: `${UP_HOST}:${UP_PORT}` }))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
