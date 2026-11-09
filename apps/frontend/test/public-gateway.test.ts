import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Pasarela de la vista pública (scripts/public-gateway.mjs, ADR 0009). */
const GW_PORT = 39000 + Math.floor(Math.random() * 500)
let upstream: Server
let seen: { url?: string; method?: string; headers?: IncomingHttpHeaders } = {}
let gw: { allowed: (m: string, u: string) => boolean; server: Server }

beforeAll(async () => {
  upstream = createServer((req, res) => {
    seen = { url: req.url, method: req.method, headers: req.headers }
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'x=1' })
    res.end('ok')
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  process.env.PUBLIC_HOST = '127.0.0.1'
  process.env.PUBLIC_PORT = String(GW_PORT)
  process.env.NITRO_PORT = String((upstream.address() as AddressInfo).port)
  gw = (await import('../../../scripts/public-gateway.mjs')) as typeof gw
  await new Promise<void>((r) => gw.server.listen(GW_PORT, '127.0.0.1', r))
})
afterAll(() => {
  gw?.server.close()
  upstream?.close()
})

function call(path: string, opts: { method?: string; host?: string; accept?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const r = request(
      {
        host: '127.0.0.1',
        port: GW_PORT,
        path,
        method: opts.method ?? 'GET',
        headers: { host: opts.host ?? `127.0.0.1:${GW_PORT}`, accept: opts.accept ?? '*/*', ...opts.headers },
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }))
      },
    )
    r.on('error', reject)
    r.end()
  })
}

describe('lista blanca', () => {
  it('permite solo contenido público de lectura', () => {
    for (const ok of ['/', '/mapas', '/emergencias', '/emergencias/rcp-adulto', '/biblioteca', '/biblioteca/leer?u=/kiwix/x', '/_nuxt/app.js', '/maps-data/espana.pmtiles', '/map-assets/fonts/Noto Sans Regular,Noto Sans Bold/0-255.pbf', '/map-assets/sprites/light.json', '/kiwix/content/wiki/A/Agua', '/api/maps', '/api/library/protocols', '/api/library/protocols/rcp-adulto', '/api/health']) {
      expect(gw.allowed('GET', ok), ok).toBe(true)
    }
  })
  it('bloquea lo privado, el asistente, la posición y los documentos propios', () => {
    for (const no of ['/boveda', '/sistema', '/sistema/mantenimiento', '/api/vault/status', '/api/admin/backup', '/api/system/power', '/api/library/ask', '/api/library/search?q=x', '/api/library/docs', '/api/nav/status', '/api/device/status', '/biblioteca/preguntar', '/%62oveda', '/api/maps/../vault/status', '/kiwix/..%2f..%2fapi/vault']) {
      expect(gw.allowed('GET', no), no).toBe(false)
    }
  })
  it('solo GET/HEAD', () => {
    expect(gw.allowed('HEAD', '/api/maps')).toBe(true)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(gw.allowed(m, '/api/maps')).toBe(false)
  })
})

describe('comportamiento HTTP', () => {
  it('portal cautivo: otro host → 302 a la portada', async () => {
    const r = await call('/generate_204', { host: 'connectivitycheck.gstatic.com' })
    expect(r.status).toBe(302)
    expect(r.headers.location).toBe('http://127.0.0.1/')
  })
  it('página privada → 302 a la portada; API privada → 403', async () => {
    expect((await call('/boveda', { accept: 'text/html' })).status).toBe(302)
    expect((await call('/api/vault/status')).status).toBe(403)
    expect((await call('/api/maps', { method: 'POST' })).status).toBe(403)
  })
  it('reenvía lo permitido con X-Forwarded-For propio, sin cookies ni cabeceras de proxy ajenas', async () => {
    const r = await call('/api/maps', { headers: { 'x-forwarded-for': '1.2.3.4', cookie: 'a=b', range: 'bytes=0-9' } })
    expect(r.status).toBe(200)
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(seen.url).toBe('/api/maps')
    expect(seen.headers?.['x-forwarded-for']).toMatch(/127\.0\.0\.1/)
    expect(seen.headers?.['x-forwarded-for']).not.toContain('1.2.3.4')
    expect(seen.headers?.cookie).toBeUndefined()
    expect(seen.headers?.range).toBe('bytes=0-9')
  })
})
