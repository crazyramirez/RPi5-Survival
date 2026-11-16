#!/usr/bin/env node
/**
 * Juegos offline (ADR 0012): sirve la copia local de Viseni Games en 127.0.0.1:8790.
 *
 * Es OTRO origen que la web (127.0.0.1:3000) a propósito: los juegos son código de terceros y así no
 * pueden leer ni lanzar acciones de Survival OS (la web exige su mismo origen, ver server/utils/net.ts).
 * Solo GET/HEAD de archivos dentro de la copia (sin listados, sin enlaces fuera), con CSP que bloquea
 * cualquier red externa y que solo deja embeber la página en la propia web del kiosco.
 * El service worker del portal se sustituye por uno que se da de baja: la copia ya es local y así no
 * se duplica en la caché de Chromium. Sin dependencias: Node estándar.
 */
import { createReadStream, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const HOST = process.env.GAMES_HOST || '127.0.0.1'
const PORT = Number(process.env.GAMES_PORT || 8790)
const ROOT = process.env.GAMES_DIR || '/var/lib/survival-os/games/current'
const APP_ORIGINS = (process.env.GAMES_FRAME_ANCESTORS || 'http://127.0.0.1:3000 http://localhost:3000').trim()

export const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8', map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml', csv: 'text/csv; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', tga: 'image/x-tga', hdr: 'image/vnd.radiance',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', weba: 'audio/webm', opus: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  wasm: 'application/wasm', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
}

export const CSP = [
  "default-src 'self' data: blob:",
  // Motores 3D (Babylon) y builds de Nuxt/Vite: eval y wasm dentro de este origen aislado.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  `frame-ancestors 'self' ${APP_ORIGINS}`,
].join('; ')

const NEUTRAL_SW = `// Survival OS: la copia ya es local; este service worker solo se da de baja.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()))
`

/** Ruta pedida → ruta relativa segura dentro de la copia, o null. Ignora la query (p. ej. ?_b=build). */
export function safePath(rawUrl) {
  let p
  try {
    p = decodeURIComponent(new URL(rawUrl, 'http://x').pathname)
  } catch {
    return null
  }
  if (p.includes('\0') || p.includes('\\')) return null
  const parts = p.split('/').filter(Boolean)
  if (parts.some((s) => s === '..' || s === '.' || s.startsWith('.'))) return null
  return parts.join('/')
}

/** Candidatos en orden: archivo exacto, <ruta>/index.html (páginas pregeneradas), y si no hay extensión, 200.html (SPA). */
export function candidates(rel) {
  const out = []
  if (rel) out.push(rel)
  out.push(rel ? `${rel}/index.html` : 'index.html')
  if (!path.posix.extname(rel)) out.push('200.html')
  return out
}

export const mimeFor = (rel) => MIME[path.posix.extname(rel).slice(1).toLowerCase()] || 'application/octet-stream'

/** Rango simple «bytes=a-b» (audio/vídeo). null = sin rango o no válido (se sirve entero). */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
  let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2])
  start = Math.max(0, start)
  end = Math.min(end, size - 1)
  return start <= end ? { start, end } : 'invalid'
}

function log(msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), svc: 'games', msg, ...extra })}\n`)
}

const BASE_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
}

function send(res, code, text) {
  res.writeHead(code, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

async function resolve(rel) {
  const root = await fs.realpath(ROOT)
  for (const c of candidates(rel)) {
    const full = path.join(root, ...c.split('/'))
    try {
      const real = await fs.realpath(full)
      if (real !== root && !real.startsWith(root + path.sep)) continue
      const st = await fs.stat(real)
      if (st.isFile()) return { file: real, rel: c, st }
    } catch {
      /* siguiente candidato */
    }
  }
  return null
}

export const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Solo lectura')
  const rel = safePath(req.url || '/')
  if (rel === null) return send(res, 400, 'Ruta no válida')
  if (rel === 'sw.js') {
    res.writeHead(200, { ...BASE_HEADERS, 'content-type': MIME.js, 'cache-control': 'no-store' })
    return res.end(req.method === 'HEAD' ? undefined : NEUTRAL_SW)
  }
  let hit
  try {
    hit = await resolve(rel)
  } catch {
    return send(res, 503, 'Juegos no descargados: Sistema → Mantenimiento → Juegos offline')
  }
  if (!hit) return send(res, 404, 'No está en la copia offline')
  const { file, st } = hit
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  const headers = {
    ...BASE_HEADERS,
    'content-type': mimeFor(hit.rel),
    'cache-control': 'no-cache',
    etag,
    'last-modified': st.mtime.toUTCString(),
    'accept-ranges': 'bytes',
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    return res.end()
  }
  const range = parseRange(req.headers.range, st.size)
  if (range === 'invalid') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${st.size}` })
    return res.end()
  }
  const { start, end } = range || { start: 0, end: st.size - 1 }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': st.size === 0 ? 0 : end - start + 1,
    ...(range ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}),
  })
  if (req.method === 'HEAD' || st.size === 0) return res.end()
  const stream = createReadStream(file, { start, end })
  stream.on('error', () => res.destroy())
  req.on('close', () => stream.destroy())
  stream.pipe(res)
})
server.maxConnections = 128
server.headersTimeout = 15_000

// Solo arranca al ejecutarse directamente (las pruebas importan las funciones puras).
if (import.meta.main) {
  server.listen(PORT, HOST, () => log('listening', { host: HOST, port: PORT, root: ROOT }))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
