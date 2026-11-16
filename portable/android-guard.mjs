/**
 * Guarda de loopback para Android (ADR 0020). En un PC, 127.0.0.1 solo lo alcanzan los programas del propio usuario;
 * en Android, CUALQUIER app instalada puede conectarse a los puertos locales (malla, ubicación, documentos…).
 *
 * Se carga en todos los procesos Node de la app con NODE_OPTIONS=--import=<este fichero> (lo fija la app Android)
 * y solo actúa si existe SURVIVAL_ANDROID_TOKEN:
 *   - servidores HTTP escuchando en loopback: rechazan (403) las peticiones sin el token, que llega en la cabecera
 *     `x-survival-token` (servicios entre sí) o en la cookie `survival_app` (la WebView de la app). Los sockets
 *     Unix (bóveda, GPS) ya son privados por permisos de fichero, y la pasarela «Compartir en la red local»
 *     escucha en la IP de la red (lectura pública por diseño, ADR 0009/0016): ninguno de los dos se filtra aquí.
 *   - clientes (fetch, http.request) hacia 127.0.0.1/localhost: añaden la cabecera.
 * Sin dependencias; se prueba en apps/frontend/test/android-guard.test.ts.
 */
import http from 'node:http'
import { syncBuiltinESMExports } from 'node:module'

export const HEADER = 'x-survival-token'
export const COOKIE = 'survival_app'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

export function isLoopbackHost(host) {
  if (!host) return false
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase()
  return LOOPBACK.has(h) || h.startsWith('127.')
}

/** Comparación en tiempo constante (longitudes iguales). */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** ¿Se acepta la petición? `localAddress` es la dirección del servidor que la recibe. */
export function allowed({ localAddress, headers }, token) {
  if (!token) return true
  // Socket Unix (sin dirección) o interfaz de red (pasarela LAN): fuera del alcance de esta guarda.
  if (!localAddress || !isLoopbackHost(localAddress)) return true
  const h = headers?.[HEADER]
  if (same(Array.isArray(h) ? h[0] : h, token)) return true
  return same(cookieValue(headers?.cookie, COOKIE) ?? undefined, token)
}

/** Añade la cabecera a una petición saliente hacia loopback (objeto Headers, array o registro). */
function withToken(headers, token) {
  if (headers instanceof Headers) {
    const h = new Headers(headers)
    h.set(HEADER, token)
    return h
  }
  if (Array.isArray(headers)) return [...headers.filter(([k]) => String(k).toLowerCase() !== HEADER), [HEADER, token]]
  return { ...(headers ?? {}), [HEADER]: token }
}

export function install(token = process.env.SURVIVAL_ANDROID_TOKEN) {
  if (!token || globalThis.__survivalGuard) return false
  globalThis.__survivalGuard = true

  // ---- servidores
  const emit = http.Server.prototype.emit
  http.Server.prototype.emit = function guardedEmit(event, req, resOrSocket, ...rest) {
    if ((event === 'request' || event === 'upgrade') && req && !allowed({ localAddress: req.socket?.localAddress, headers: req.headers }, token)) {
      if (event === 'request') {
        resOrSocket.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
        resOrSocket.end('Forbidden\n')
      } else {
        resOrSocket.destroy()
      }
      return true
    }
    return emit.call(this, event, req, resOrSocket, ...rest)
  }

  // ---- clientes: fetch
  const origFetch = globalThis.fetch
  if (typeof origFetch === 'function') {
    globalThis.fetch = function guardedFetch(input, init) {
      try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
        if (isLoopbackHost(url.hostname)) {
          if (typeof input === 'object' && !(input instanceof URL) && !init?.headers) {
            input = new Request(input, { headers: withToken(input.headers, token) })
          } else {
            init = { ...(init ?? {}), headers: withToken(init?.headers, token) }
          }
        }
      } catch {
        // URL relativa o no válida: fetch dará su propio error
      }
      return origFetch.call(this, input, init)
    }
  }

  // ---- clientes: http.request / http.get
  const wrap = (orig) =>
    function guardedRequest(...args) {
      let [a, b] = args
      const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a?.hostname ?? a?.host ?? 'localhost')
      if (!a?.socketPath && isLoopbackHost(host)) {
        if (typeof a === 'string' || a instanceof URL) {
          if (b && typeof b === 'object' && typeof b !== 'function') b = { ...b, headers: withToken(b.headers, token) }
          else {
            const rest = args.slice(1)
            return orig.call(this, a, { headers: { [HEADER]: token } }, ...rest)
          }
          return orig.call(this, a, b, ...args.slice(2))
        }
        a = { ...a, headers: withToken(a.headers, token) }
        return orig.call(this, a, ...args.slice(1))
      }
      return orig.apply(this, args)
    }
  http.request = wrap(http.request)
  http.get = wrap(http.get)
  // `import { request } from 'node:http'` (ESM) también debe ver la versión con token.
  syncBuiltinESMExports()
  return true
}

install()
