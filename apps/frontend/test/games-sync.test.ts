import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** scripts/games-sync.mjs (ADR 0012): mismas reglas que games-sync.py, más el cambio de copia sin administrador. */
type Entry = { path: string; size: number | null; sha256?: string; hash16?: string }
type Mod = {
  SyncError: new (m: string) => Error
  MAX_FILE: number
  safeRel: (r: unknown) => string | null
  urlFor: (r: string) => string
  parseSw: (s: string) => Entry[]
  parseManifest: (d: unknown) => { files: Entry[]; external: { file: string; url: string }[]; generatedAt: string | null }
  mergeEntries: (a: Entry[], b: Entry[]) => Entry[]
  gameSlugs: (e: { path: string }[]) => string[]
  matches: (e: Partial<Entry>, sha: string) => boolean
  incompleteGames: (f: string[]) => string[]
  placeIn: (staging: string, rel: string) => string
  linkOrCopy: (from: string, to: string) => Promise<void>
  pointCurrent: (release: string) => Promise<void>
}
let m: Mod
let root: string

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'games-sync-'))
  process.env.GAMES_ROOT = root
  m = (await import('../../../scripts/games-sync.mjs')) as unknown as Mod
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const SHA = 'a'.repeat(64)

describe('games-sync.mjs: funciones puras', () => {
  it('rutas seguras', () => {
    expect(m.safeRel('games/alone/assets/Mapa 1.glb')).toBe('games/alone/assets/Mapa 1.glb')
    expect(m.safeRel('media/luigi/canción.mp3')).not.toBeNull()
    for (const bad of ['/etc/passwd', '../x', 'games/../../etc', 'games//x', 'games/.git/config', 'a\\b', 'a/\u0000', '', null, 5, 'x/'.repeat(30), 'a/con.txt', 'a/b:c', 'a/fin.']) {
      expect(m.safeRel(bad), String(bad)).toBeNull()
    }
  })
  it('URL codificada por segmento', () => {
    expect(m.urlFor('media/luigi pizza/ñ#1.png')).toBe('https://games.viseni.com/media/luigi%20pizza/%C3%B1%231.png')
  })
  it('sw.js', () => {
    const sw = 'const VERSION = "x"\nconst FILES = [["index.html","0123456789abcdef"],["_nuxt/a%20b.js","0000000000000000"]]\n\nself.x = 1\n'
    const e = m.parseSw(sw)
    expect(e).toHaveLength(2)
    expect(e[1]).toEqual({ path: '_nuxt/a b.js', hash16: '0'.repeat(16), size: null })
    expect(() => m.parseSw('const VERSION = 1')).toThrow(m.SyncError)
    expect(() => m.parseSw('const FILES = [["..%2F..%2Fetc%2Fpasswd","0123456789abcdef"]]\n')).toThrow(m.SyncError)
    expect(() => m.parseSw('const FILES = [["index.html","012"]]\n')).toThrow(m.SyncError)
  })
  it('manifiesto', () => {
    const man = { format: 'viseni-offline/1', generatedAt: '2026-11-13T10:00:00Z', files: [{ path: 'games/alone/index.html', size: 10, sha256: SHA }], external: [{ file: 'g', url: 'u' }, 'basura'] }
    const r = m.parseManifest(man)
    expect(r.files).toEqual([{ path: 'games/alone/index.html', size: 10, sha256: SHA }])
    expect(r.external).toEqual([{ file: 'g', url: 'u' }])
    expect(r.generatedAt).toBe('2026-11-13T10:00:00Z')
    expect(() => m.parseManifest({ files: [] })).toThrow(m.SyncError)
    expect(() => m.parseManifest({ ...man, files: [{ path: 'a', size: 1, sha256: 'ab' }] })).toThrow(m.SyncError)
    expect(() => m.parseManifest({ ...man, files: [{ path: 'a', size: -1, sha256: SHA }] })).toThrow(m.SyncError)
    expect(() => m.parseManifest({ ...man, files: [{ path: '/etc/x', size: 1, sha256: SHA }] })).toThrow(m.SyncError)
  })
  it('unión: manda el manifiesto; mayúsculas duplicadas y tamaño máximo', () => {
    const merged = m.mergeEntries(
      [{ path: 'index.html', hash16: '0'.repeat(16), size: null }, { path: 'games/alone/index.html', hash16: '1'.repeat(16), size: null }],
      [{ path: 'games/alone/index.html', size: 10, sha256: SHA }],
    )
    expect(merged.map((e) => e.path)).toEqual(['games/alone/index.html', 'index.html'])
    expect(merged[0]!.sha256).toBe(SHA)
    expect(() => m.mergeEntries([], [{ path: 'A.png', size: 1, sha256: SHA }, { path: 'a.png', size: 1, sha256: SHA }])).toThrow(m.SyncError)
    expect(() => m.mergeEntries([], Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, size: m.MAX_FILE, sha256: SHA })))).toThrow(m.SyncError)
  })
  it('hashes, juegos e incompletos', () => {
    expect(m.matches({ sha256: SHA }, SHA)).toBe(true)
    expect(m.matches({ sha256: SHA }, 'b'.repeat(64))).toBe(false)
    expect(m.matches({ hash16: 'a'.repeat(16) }, SHA)).toBe(true)
    expect(m.gameSlugs([{ path: 'games/alone/index.html' }, { path: 'games/alone/a/index.html' }, { path: 'media/x/index.html' }, { path: 'games/taki/index.html' }])).toEqual(['alone', 'taki'])
    expect(m.gameSlugs([{ path: 'index.html' }])).toEqual([])
    expect(m.incompleteGames(['games/alone/a.glb', 'games/alone/b.glb', 'games/taki/x', 'media/y.png', 'games/z'])).toEqual(['alone', 'taki'])
  })
  it('nunca escribe fuera de la copia', () => {
    const staging = path.join(root, 'st')
    expect(m.placeIn(staging, 'games/a/b.glb')).toBe(path.join(staging, 'games', 'a', 'b.glb'))
    expect(() => m.placeIn(staging, '../fuera')).toThrow(m.SyncError)
  })
})

describe('games-sync.mjs: disco (sin administrador)', () => {
  it('`current` apunta a la copia nueva y se puede cambiar otra vez', async () => {
    for (const stamp of ['r1', 'r2']) {
      const rel = path.join(root, 'releases', stamp)
      mkdirSync(rel, { recursive: true })
      writeFileSync(path.join(rel, 'index.html'), stamp)
      await m.pointCurrent(rel)
      expect(readFileSync(path.join(root, 'current', 'index.html'), 'utf8')).toBe(stamp)
    }
  })
  it('enlaza o, si no se puede, copia', async () => {
    const a = path.join(root, 'a.txt')
    const b = path.join(root, 'b.txt')
    writeFileSync(a, 'hola')
    await m.linkOrCopy(a, b)
    expect(readFileSync(b, 'utf8')).toBe('hola')
    await m.linkOrCopy(a, path.join(root, 'no-existe', 'c.txt')).catch(() => {})
    expect(existsSync(path.join(root, 'no-existe', 'c.txt'))).toBe(false)
  })
})
