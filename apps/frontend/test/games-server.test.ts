import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Juegos offline (scripts/games-server.mjs, ADR 0012) contra una copia de prueba en un directorio temporal. */
type Mod = {
  server: Server
  safePath: (u: string) => string | null
  candidates: (r: string) => string[]
  parseRange: (h: string | undefined, size: number) => { start: number; end: number } | null | 'invalid'
  mimeFor: (r: string) => string
  CSP: string
}
let gs: Mod
let base: string
let port: number

beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'games-'))
  const root = path.join(base, 'current')
  mkdirSync(path.join(root, 'games', 'alone'), { recursive: true })
  mkdirSync(path.join(root, 'game', 'alone'), { recursive: true })
  writeFileSync(path.join(root, 'index.html'), '<h1>portal</h1>')
  writeFileSync(path.join(root, '200.html'), '<h1>spa</h1>')
  writeFileSync(path.join(root, 'game', 'alone', 'index.html'), '<h1>ficha</h1>')
  writeFileSync(path.join(root, 'games', 'alone', 'index.html'), '<h1>juego</h1>')
  writeFileSync(path.join(root, 'games', 'alone', 'música.mp3'), Buffer.alloc(1000, 1))
  writeFileSync(path.join(base, 'secreto.txt'), 'no')
  try {
    symlinkSync(path.join(base, 'secreto.txt'), path.join(root, 'fuga.txt'))
  } catch {
    /* Windows sin permiso de enlaces: esa comprobación se omite */
  }
  process.env.GAMES_DIR = root
  gs = (await import('../../../scripts/games-server.mjs')) as unknown as Mod
  await new Promise<void>((r) => gs.server.listen(0, '127.0.0.1', r))
  port = (gs.server.address() as AddressInfo).port
})
afterAll(() => {
  gs?.server.close()
  rmSync(base, { recursive: true, force: true })
})

function call(p: string, opts: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path: p, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = ''
      res.setEncoding('latin1')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    r.on('error', reject)
    r.end()
  })
}

describe('games-server: funciones puras', () => {
  it('rutas: rechaza recorridos, ocultos y nulos; ignora la query', () => {
    expect(gs.safePath('/games/alone/index.html?x=1')).toBe('games/alone/index.html')
    expect(gs.safePath('/')).toBe('')
    // El parser de URL resuelve «..» (también %2e%2e) antes: nunca sale de la raíz de la copia.
    expect(gs.safePath('/../etc/passwd')).toBe('etc/passwd')
    expect(gs.safePath('/%2e%2e/x')).toBe('x')
    for (const bad of ['/.git/config', '/a/%2e%2e%2fb', '/a%00b', '/a%5cb', '/%E0%A4%A']) expect(gs.safePath(bad), bad).toBeNull()
  })
  it('candidatos: archivo, index.html de la ruta y SPA solo sin extensión', () => {
    expect(gs.candidates('game/alone')).toEqual(['game/alone', 'game/alone/index.html', '200.html'])
    expect(gs.candidates('x.png')).toEqual(['x.png', 'x.png/index.html'])
    expect(gs.candidates('')).toEqual(['index.html', '200.html'])
  })
  it('rangos', () => {
    expect(gs.parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(gs.parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(gs.parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(gs.parseRange('bytes=2000-3000', 1000)).toBe('invalid')
    expect(gs.parseRange(undefined, 1000)).toBeNull()
  })
  it('tipos MIME de los motores 3D', () => {
    expect(gs.mimeFor('a/b.wasm')).toBe('application/wasm')
    expect(gs.mimeFor('m.GLB')).toBe('model/gltf-binary')
    expect(gs.mimeFor('x.unknown')).toBe('application/octet-stream')
  })
  it('CSP: sin red externa y solo embebible por la web local', () => {
    expect(gs.CSP).toContain("connect-src 'self' data: blob:")
    expect(gs.CSP).toContain('frame-ancestors')
    expect(gs.CSP).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/)
  })
})

describe('games-server: HTTP', () => {
  it('portada, páginas pregeneradas, juego y SPA', async () => {
    expect((await call('/')).body).toBe('<h1>portal</h1>')
    expect((await call('/game/alone')).body).toBe('<h1>ficha</h1>')
    expect((await call('/game/alone/')).body).toBe('<h1>ficha</h1>')
    const g = await call('/games/alone/index.html')
    expect(g.status).toBe(200)
    expect(g.headers['content-type']).toContain('text/html')
    expect(g.headers['content-security-policy']).toContain('frame-ancestors')
    expect((await call('/music')).body).toBe('<h1>spa</h1>')
    expect((await call('/nada.png')).status).toBe(404)
  })
  it('nombres con acentos y rangos para audio', async () => {
    const r = await call(`/games/alone/${encodeURIComponent('música.mp3')}`, { headers: { range: 'bytes=10-19' } })
    expect(r.status).toBe(206)
    expect(r.headers['content-range']).toBe('bytes 10-19/1000')
    expect(r.headers['content-type']).toBe('audio/mpeg')
    expect(r.body.length).toBe(10)
  })
  it('solo lectura y sin escapar de la copia', async () => {
    expect((await call('/', { method: 'POST' })).status).toBe(405)
    expect((await call('/../secreto.txt')).status).not.toBe(200)
    expect((await call('/fuga.txt')).status).toBe(404)
  })
  it('service worker del portal sustituido por uno que se da de baja', async () => {
    const r = await call('/sw.js')
    expect(r.status).toBe(200)
    expect(r.body).toContain('unregister')
  })
})
