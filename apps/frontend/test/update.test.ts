import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Actualizaciones desde GitHub (ADR 0021): firma, manifiesto, elección de fichero, motor contra un «GitHub» falso
 * local, aplicación con autoprueba y vuelta atrás (portable), versiones del monorepo y la tarea root de la Pi.
 */
type Manifest = { version: string; tag: string; minFrom: string; assets: Asset[]; notes: Record<string, string> }
type Asset = { name: string; kind: string; platforms: string[]; size: number; sha256: string }
type Lib = {
  TRUSTED_KEYS: Record<string, string>
  parseVersion: (v: unknown) => number[] | null
  compareVersions: (a: string, b: string) => number
  generateSigningKey: () => { privatePem: string; publicX: string }
  publicXOf: (pem: string) => string
  signManifest: (b: Buffer, pem: string, id: string) => string
  verifyManifest: (b: Buffer, sig: string, keys?: Record<string, string>) => { ok: boolean; keyId?: string; error?: string }
  validateManifest: (m: unknown) => Manifest
  pickAsset: (m: Manifest, o: { kind: string; platform: string; runtimes?: string[] }) => Asset | null
  decide: (m: Manifest, o: { installed: string; kind: string; platform: string; runtimes?: string[] }) => { status: string; asset: Asset | null }
  pickNotes: (n: Record<string, string>, l: string) => string | null
  normalizeSettings: (raw: unknown, kind: string) => { mode: string }
  inInstallWindow: (d: Date) => boolean
  checkDue: (st: unknown, now: number, force?: boolean) => boolean
}
type Paths = { kind: string; platform: string; runtimes: string[]; dir: string; downloads: string; state: string; settings: string }
type Engine = {
  enginePaths: (profile: string, root: string, o?: { platform?: string; arch?: string; env?: Record<string, string> }) => Paths
  check: (p: Paths, o: Record<string, unknown>) => Promise<{ state: Record<string, unknown>; manifest: Manifest | null; error?: { code: string } ; skipped?: boolean }>
  fetchUpdate: (p: Paths, o: Record<string, unknown>) => Promise<{ file: string; version: string }>
  autoRun: (p: Paths, o: Record<string, unknown>) => Promise<{ action: string; file?: string }>
  readState: (p: Paths) => Record<string, unknown>
}
type Apply = {
  applyUpdate: (root: string, pid: number, o: Record<string, unknown>) => Promise<{ ok: boolean; version: string | null; message: string | null }>
}

const scripts = (f: string): string => fileURLToPath(new URL(`../../../scripts/${f}`, import.meta.url))
let lib: Lib
let engine: Engine
let apply: Apply
let tmp: string
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

beforeAll(async () => {
  lib = (await import('../../../scripts/update-lib.mjs')) as unknown as Lib
  engine = (await import('../../../scripts/update-engine.mjs')) as unknown as Engine
  apply = (await import('../../../portable/apply-update.mjs')) as unknown as Apply
  tmp = mkdtempSync(path.join(tmpdir(), 'survival-update-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function manifestFor(version: string, assets: Asset[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 1, name: 'Survival OS', version, tag: `v${version}`, date: '2026-11-20', minFrom: '0.0.0', notes: { es: 'Novedades', en: "What's new" }, assets, ...extra }
}
const asset = (name: string, kind: string, platforms: string[], size = 10, sum = 'a'.repeat(64)): Asset => ({ name, kind, platforms, size, sha256: sum })

describe('update-lib: versiones, firma y manifiesto', () => {
  it('versiones X.Y.Z estrictas', () => {
    expect(lib.parseVersion('0.10.0')).toEqual([0, 10, 0])
    for (const bad of ['v1.0.0', '1.0', '1.0.0-beta', '01.0.0', ' ', null]) expect(lib.parseVersion(bad)).toBeNull()
    expect(lib.compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(lib.compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(() => lib.compareVersions('x', '1.0.0')).toThrow()
  })

  it('la clave de confianza es una Ed25519 real (no un marcador)', () => {
    const keys = Object.values(lib.TRUSTED_KEYS)
    expect(keys.length).toBeGreaterThan(0)
    for (const x of keys) expect(Buffer.from(x, 'base64url')).toHaveLength(32)
  })

  it('firma: verifica, y rechaza bytes alterados, otra clave y firmas ilegibles', () => {
    const k = lib.generateSigningKey()
    const other = lib.generateSigningKey()
    const keys = { test: k.publicX }
    expect(lib.publicXOf(k.privatePem)).toBe(k.publicX)
    const bytes = Buffer.from('{"a":1}\n')
    const sig = lib.signManifest(bytes, k.privatePem, 'test')
    expect(lib.verifyManifest(bytes, sig, keys)).toEqual({ ok: true, keyId: 'test' })
    expect(lib.verifyManifest(Buffer.from('{"a":2}\n'), sig, keys).ok).toBe(false)
    expect(lib.verifyManifest(bytes, lib.signManifest(bytes, other.privatePem, 'test'), keys).ok).toBe(false)
    expect(lib.verifyManifest(bytes, lib.signManifest(bytes, other.privatePem, 'otra'), keys).error).toMatch(/clave desconocida/)
    expect(lib.verifyManifest(bytes, 'basura', keys).ok).toBe(false)
    // Las claves de confianza reales no aceptan una firma de prueba.
    expect(lib.verifyManifest(bytes, sig).ok).toBe(false)
  })

  it('manifiesto: valida todo y rechaza lo raro', () => {
    const ok = manifestFor('1.2.3', [asset('survival-os-1.2.3.tar.gz', 'system', ['linux-arm64'])])
    expect(lib.validateManifest(ok).version).toBe('1.2.3')
    const bad: Record<string, unknown>[] = [
      { ...ok, schema: 2 },
      { ...ok, tag: '1.2.3' },
      { ...ok, minFrom: '2.0.0' },
      { ...ok, notes: { de: 'x' } },
      { ...ok, assets: [] },
      { ...ok, assets: [asset('../evil.tar.gz', 'system', ['linux-arm64'])] },
      { ...ok, assets: [asset('survival-os-9.9.9.tar.gz', 'system', ['linux-arm64'])] },
      { ...ok, assets: [asset('survival-os-1.2.3.tar.gz', 'raro', ['linux-arm64'])] },
      { ...ok, assets: [asset('survival-os-1.2.3.tar.gz', 'system', ['beos-x86'])] },
      { ...ok, assets: [{ ...asset('survival-os-1.2.3.tar.gz', 'system', ['linux-arm64']), sha256: 'zz' }] },
      { ...ok, assets: [{ ...asset('survival-os-1.2.3.tar.gz', 'system', ['linux-arm64']), size: -1 }] },
    ]
    for (const m of bad) expect(() => lib.validateManifest(m)).toThrow(/manifiesto no válido/)
  })

  it('elige el fichero: Pi, Android y portable (la carpeta multisistema conserva todos sus sistemas)', () => {
    const all = ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']
    const m = lib.validateManifest(
      manifestFor('1.0.0', [
        asset('survival-os-1.0.0.tar.gz', 'system', ['linux-arm64', 'linux-x64'], 11),
        asset('survival-os-1.0.0-portable.zip', 'portable', all, 200),
        asset('survival-os-1.0.0-portable-win-x64.zip', 'portable', ['win-x64'], 50),
        asset('survival-os-1.0.0-portable-linux-x64.zip', 'portable', ['linux-x64'], 50),
        asset('survival-os-1.0.0-android-arm64.apk', 'android', ['android-arm64'], 80),
      ]),
    )
    expect(lib.pickAsset(m, { kind: 'system', platform: 'linux-arm64' })?.name).toBe('survival-os-1.0.0.tar.gz')
    expect(lib.pickAsset(m, { kind: 'android', platform: 'android-arm64' })?.name).toBe('survival-os-1.0.0-android-arm64.apk')
    expect(lib.pickAsset(m, { kind: 'android', platform: 'android-x64' })).toBeNull()
    expect(lib.pickAsset(m, { kind: 'portable', platform: 'win-x64', runtimes: ['win-x64'] })?.name).toBe('survival-os-1.0.0-portable-win-x64.zip')
    expect(lib.pickAsset(m, { kind: 'portable', platform: 'win-x64', runtimes: ['win-x64', 'darwin-arm64'] })?.name).toBe('survival-os-1.0.0-portable.zip')
    expect(lib.pickAsset(m, { kind: 'portable', platform: 'darwin-x64', runtimes: [] })?.name).toBe('survival-os-1.0.0-portable.zip')
  })

  it('decide: al día, nueva, nunca bajar, minFrom y sin fichero', () => {
    const m = lib.validateManifest(manifestFor('1.0.0', [asset('survival-os-1.0.0.tar.gz', 'system', ['linux-arm64'])], { minFrom: '0.9.0' }))
    const o = { kind: 'system', platform: 'linux-arm64' }
    expect(lib.decide(m, { ...o, installed: '1.0.0' }).status).toBe('up-to-date')
    expect(lib.decide(m, { ...o, installed: '1.1.0' }).status).toBe('newer-installed')
    expect(lib.decide(m, { ...o, installed: '0.9.0' }).status).toBe('available')
    expect(lib.decide(m, { ...o, installed: '0.8.5' }).status).toBe('needs-step')
    expect(lib.decide(m, { kind: 'system', platform: 'linux-x64', installed: '0.9.0' }).status).toBe('no-asset')
  })

  it('notas, modo por defecto, ventana nocturna y frecuencia de comprobación', () => {
    expect(lib.pickNotes({ es: 'a', en: 'b' }, 'fr')).toBe('a')
    expect(lib.pickNotes({ en: 'b' }, 'it')).toBe('b')
    expect(lib.normalizeSettings(null, 'portable').mode).toBe('auto')
    expect(lib.normalizeSettings(null, 'system').mode).toBe('notify')
    expect(lib.normalizeSettings({ mode: 'rm -rf' }, 'android').mode).toBe('notify')
    expect(lib.normalizeSettings({ mode: 'off' }, 'system').mode).toBe('off')
    expect(lib.inInstallWindow(new Date(2026, 0, 1, 3, 0))).toBe(true)
    expect(lib.inInstallWindow(new Date(2026, 0, 1, 6, 0))).toBe(false)
    const now = Date.parse('2026-11-16T12:00:00Z')
    expect(lib.checkDue({ okAt: '2026-11-16T00:00:00Z' }, now)).toBe(false)
    expect(lib.checkDue({ okAt: '2026-11-15T10:00:00Z' }, now)).toBe(true)
    expect(lib.checkDue({ okAt: '2026-11-16T11:00:00Z' }, now, true)).toBe(true)
    expect(lib.checkDue({}, now)).toBe(true)
  })
})

describe('update-engine: contra un GitHub falso local', () => {
  let server: Server
  let base: string
  const key = { pem: '', x: '' }
  const files = new Map<string, Buffer>()
  let requests: string[] = []
  const zip = Buffer.from('contenido del zip de la portable 1.0.0'.repeat(1000))

  function publish(manifest: Record<string, unknown>, pem = key.pem, id = 'test'): void {
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
    files.set('survival-os-update.json', bytes)
    files.set('survival-os-update.json.sig', Buffer.from(lib.signManifest(bytes, pem, id)))
  }

  function portableRoot(name: string, version = '0.9.0', runtimes = ['win-x64']): string {
    const root = path.join(tmp, name)
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(path.join(root, 'app', 'VERSION'), `${version}\n`)
    for (const r of runtimes) mkdirSync(path.join(root, 'runtime', r), { recursive: true })
    return root
  }
  const pathsOf = (root: string): Paths => engine.enginePaths('portable', root, { platform: 'win32', arch: 'x64', env: {} })

  beforeAll(async () => {
    const k = lib.generateSigningKey()
    key.pem = k.privatePem
    key.x = k.publicX
    files.set('survival-os-1.0.0-portable-win-x64.zip', zip)
    server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? '/').split('/').pop() ?? '')
      requests.push(name)
      const body = files.get(name)
      if (!body) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-length': body.length }).end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  const opts = (): Record<string, unknown> => ({ base, keys: { test: key.x } })
  const good = (): Record<string, unknown> => manifestFor('1.0.0', [asset('survival-os-1.0.0-portable-win-x64.zip', 'portable', ['win-x64'], zip.length, sha(zip))])

  it('rutas: portable con sus sistemas; Pi en /var/lib/survival-os-update', () => {
    const root = portableRoot('rutas', '0.9.0', ['win-x64', 'linux-x64'])
    const p = pathsOf(root)
    expect(p.kind).toBe('portable')
    expect(p.platform).toBe('win-x64')
    expect(p.runtimes.sort()).toEqual(['linux-x64', 'win-x64'])
    expect(engine.enginePaths('portable', root, { platform: 'android', arch: 'arm64', env: {} }).kind).toBe('android')
    const pi = engine.enginePaths('pi', '/', { arch: 'arm64', env: {} })
    expect(pi.dir).toBe('/var/lib/survival-os-update')
    expect(pi.platform).toBe('linux-arm64')
  })

  it('comprueba, descarga y verifica; la segunda vez no vuelve a bajar', async () => {
    publish(good())
    const p = pathsOf(portableRoot('ok'))
    const c = await engine.check(p, { ...opts(), force: true })
    expect(c.error).toBeUndefined()
    expect(c.state.status).toBe('available')
    const f = await engine.fetchUpdate(p, opts())
    expect(readFileSync(f.file)).toEqual(zip)
    expect(readFileSync(`${f.file}.sha256`, 'utf8')).toContain(sha(zip))
    expect((engine.readState(p).download as { version: string }).version).toBe('1.0.0')
    requests = []
    await engine.fetchUpdate(p, opts())
    expect(requests).not.toContain('survival-os-1.0.0-portable-win-x64.zip')
  })

  it('fichero alterado en el servidor: se rechaza y se borra', async () => {
    publish(good())
    files.set('survival-os-1.0.0-portable-win-x64.zip', Buffer.from(zip).fill(65, 0, 10))
    const p = pathsOf(portableRoot('alterado'))
    await expect(engine.fetchUpdate(p, opts())).rejects.toThrow(/SHA-256/)
    expect(existsSync(path.join(p.downloads, 'survival-os-1.0.0-portable-win-x64.zip'))).toBe(false)
    files.set('survival-os-1.0.0-portable-win-x64.zip', zip)
  })

  it('manifiesto firmado con otra clave o sin firma: no se confía', async () => {
    const p = pathsOf(portableRoot('firma'))
    publish(good(), lib.generateSigningKey().privatePem)
    expect((await engine.check(p, { ...opts(), force: true })).error?.code).toBe('signature')
    files.delete('survival-os-update.json.sig')
    expect((await engine.check(p, { ...opts(), force: true })).error?.code).toBe('no-release')
    publish(good())
  })

  it('sin red: lo dice y conserva la última comprobación buena', async () => {
    publish(good())
    const p = pathsOf(portableRoot('sinred'))
    await engine.check(p, { ...opts(), force: true })
    const okAt = engine.readState(p).okAt
    const r = await engine.check(p, { base: 'http://127.0.0.1:9', keys: { test: key.x }, force: true })
    expect(r.error?.code).toBe('offline')
    expect(engine.readState(p).okAt).toBe(okAt)
    expect(engine.readState(p).status).toBe('available')
  })

  it('automático: «off» ni se conecta; «notify» no descarga; «auto» descarga; máx. una comprobación cada 20 h', async () => {
    publish(good())
    const root = portableRoot('auto')
    const p = pathsOf(root)
    mkdirSync(p.dir, { recursive: true })
    writeFileSync(p.settings, JSON.stringify({ mode: 'off' }))
    requests = []
    expect((await engine.autoRun(p, opts())).action).toBe('off')
    expect(requests).toEqual([])
    writeFileSync(p.settings, JSON.stringify({ mode: 'notify' }))
    expect((await engine.autoRun(p, opts())).action).toBe('checked')
    expect(requests).not.toContain('survival-os-1.0.0-portable-win-x64.zip')
    requests = []
    expect((await engine.check(p, opts())).skipped).toBe(true)
    expect(requests).toEqual([])
    writeFileSync(p.settings, JSON.stringify({ mode: 'auto' }))
    const r = await engine.autoRun(p, opts())
    expect(r.action).toBe('downloaded')
    expect(r.file && existsSync(r.file)).toBe(true)
  })

  it('al día y minFrom: no hay nada que instalar', async () => {
    const p = pathsOf(portableRoot('aldia', '1.0.0'))
    publish(good())
    expect((await engine.check(p, { ...opts(), force: true })).state.status).toBe('up-to-date')
    await expect(engine.fetchUpdate(p, opts())).rejects.toThrow(/al día/)
    const old = pathsOf(portableRoot('vieja', '0.5.0'))
    publish({ ...good(), minFrom: '0.9.0' })
    expect((await engine.check(old, { ...opts(), force: true })).state.status).toBe('needs-step')
  })
})

describe('apply-update: autoprueba y vuelta atrás (portable)', () => {
  function prepared(name: string): string {
    const root = path.join(tmp, `apply-${name}`)
    for (const [rel, text] of [['app/VERSION', '0.9.0\n'], ['runtime/win-x64/node.exe', 'node viejo'], ['LEEME.txt', 'viejo'], ['data/maps/es.pmtiles', 'MIS DATOS']]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), text)
    }
    const base = path.join(root, '.update', 'staging', 'Survival OS')
    for (const [rel, text] of [['app/VERSION', '1.0.0\n'], ['runtime/win-x64/node.exe', 'node nuevo'], ['LEEME.txt', 'nuevo'], ['data/LEEME.txt', 'del zip']]) {
      mkdirSync(path.dirname(path.join(base, rel)), { recursive: true })
      writeFileSync(path.join(base, rel), text)
    }
    writeFileSync(path.join(root, '.update', 'ready.json'), JSON.stringify({ version: '1.0.0', from: '0.9.0', base: '.update/staging/Survival OS' }))
    return root
  }
  const read = (root: string, rel: string): string => readFileSync(path.join(root, rel), 'utf8')

  it('autoprueba correcta: versión nueva, datos intactos, anterior en .previous', async () => {
    const root = prepared('ok')
    const r = await apply.applyUpdate(root, 0, { relaunchAfter: false, data: path.join(root, 'data'), selfTestImpl: async () => true })
    expect(r).toMatchObject({ ok: true, version: '1.0.0' })
    expect(read(root, 'app/VERSION')).toBe('1.0.0\n')
    expect(read(root, 'runtime/win-x64/node.exe')).toBe('node nuevo')
    expect(read(root, 'data/maps/es.pmtiles')).toBe('MIS DATOS')
    expect(existsSync(path.join(root, 'data', 'LEEME.txt'))).toBe(false)
    expect(read(root, '.previous/app/VERSION')).toBe('0.9.0\n')
    expect(existsSync(path.join(root, '.update'))).toBe(false)
    expect(JSON.parse(read(root, 'data/update/last-apply.json'))).toMatchObject({ ok: true, version: '1.0.0' })
  })

  it('la versión nueva no arranca: vuelve sola a la anterior', async () => {
    const root = prepared('falla')
    const r = await apply.applyUpdate(root, 0, { relaunchAfter: false, data: path.join(root, 'data'), selfTestImpl: async () => false })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/no arrancó/)
    expect(read(root, 'app/VERSION')).toBe('0.9.0\n')
    expect(read(root, 'runtime/win-x64/node.exe')).toBe('node viejo')
    expect(read(root, 'LEEME.txt')).toBe('viejo')
    expect(read(root, 'data/maps/es.pmtiles')).toBe('MIS DATOS')
    expect(read(root, '.update-failed/Survival OS/app/VERSION')).toBe('1.0.0\n')
    expect(existsSync(path.join(root, '.update'))).toBe(false)
    expect(JSON.parse(read(root, 'data/update/last-apply.json'))).toMatchObject({ ok: false, version: '1.0.0' })
  })

  it('preparación manipulada (base fuera de .update): no toca nada', async () => {
    const root = prepared('base')
    writeFileSync(path.join(root, '.update', 'ready.json'), JSON.stringify({ version: '1.0.0', from: '0.9.0', base: 'data' }))
    const r = await apply.applyUpdate(root, 0, { relaunchAfter: false, data: path.join(root, 'data'), selfTestImpl: async () => true })
    expect(r.ok).toBe(false)
    expect(read(root, 'app/VERSION')).toBe('0.9.0\n')
  })
})

describe('set-version: una sola versión en el monorepo', () => {
  it('detecta y corrige desajustes (package.json y package-lock.json)', async () => {
    const m = (await import('../../../scripts/set-version.mjs')) as unknown as {
      checkVersions: (r: string) => { version: string; mismatches: unknown[] }
      setVersion: (v: string, r: string) => void
    }
    const root = path.join(tmp, 'mono')
    const pkg = (dir: string, version: string, extra: Record<string, unknown> = {}): void => {
      mkdirSync(path.join(root, dir), { recursive: true })
      writeFileSync(path.join(root, dir, 'package.json'), `${JSON.stringify({ name: dir || 'raiz', version, ...extra }, null, 2)}\n`)
    }
    pkg('', '1.0.0', { workspaces: ['apps/*', 'services/x'] })
    pkg('apps/a', '1.0.0')
    pkg('services/x', '0.8.0')
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' }, 'apps/a': { version: '1.0.0' }, 'services/x': { version: '0.8.0' } } }))
    expect(m.checkVersions(root).mismatches).toHaveLength(2)
    m.setVersion('1.1.0', root)
    expect(m.checkVersions(root)).toEqual({ version: '1.1.0', mismatches: [] })
    expect(() => m.setVersion('v2', root)).toThrow()
  })

  it('el repositorio está alineado', async () => {
    const m = (await import('../../../scripts/set-version.mjs')) as unknown as { checkVersions: () => { mismatches: unknown[] } }
    expect(m.checkVersions().mismatches).toEqual([])
  })
})

describe('empaquetado: el actualizador viaja en la Pi y en la portable', () => {
  it('release.mjs y stage-app.mjs incluyen update-engine y update-lib; el temporizador se habilita', () => {
    for (const f of ['release.mjs', 'stage-app.mjs']) {
      const s = readFileSync(scripts(f), 'utf8')
      expect(s).toContain("'update-engine.mjs'")
      expect(s).toContain("'update-lib.mjs'")
    }
    expect(readFileSync(scripts('install-system.sh'), 'utf8')).toContain('survival-update.timer')
    expect(readFileSync(fileURLToPath(new URL('../../../systemd/survival-update.timer', import.meta.url)), 'utf8')).toContain('Unit=survival-admin@update-auto.service')
  })
})

const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)
describe.skipIf(!python)('tarea root de la Pi (admin-job.py)', () => {
  it('instala solo descargas verificadas, con el instalador de la release nueva, y respeta el modo', () => {
    const script = fileURLToPath(new URL('../../../tests/python/test_admin_job_update.py', import.meta.url))
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
