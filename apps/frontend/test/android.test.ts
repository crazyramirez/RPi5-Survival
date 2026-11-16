import { createServer } from 'node:http'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIGHT_ASSISTANT, downloadPlan, llmFits, orderPlan } from '../app/utils/content'
// @ts-expect-error módulos .mjs sin tipos (portable/, scripts/ y android/, fuera del monorepo TypeScript)
import { ANDROID_BUNDLED, PREFERRED_PORTS, androidComponentLinks, optionalServices, platformKey, serviceEnv, vaultSocket } from '../../../portable/lib.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { allowed, cookieValue, install, isLoopbackHost } from '../../../portable/android-guard.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { parseAndroidVolumes } from '../../../portable/usb.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { androidLibName, parseElf, patchElf, setRunpathOrigin } from '../../../android/scripts/elf.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { closure, depsOf, parsePackages } from '../../../android/scripts/natives.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { extractZip } from '../../../scripts/zip.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { writeZip } from '../../../scripts/stage-app.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { platformKey as enginePlatformKey } from '../../../scripts/content-engine.mjs'

describe('android: plataforma y entorno (ADR 0020)', () => {
  it('claves de runtime android-arm64 y android-x64', () => {
    expect(platformKey('android', 'arm64')).toBe('android-arm64')
    expect(platformKey('android', 'x64')).toBe('android-x64')
    expect(platformKey('android', 'ia32')).toBeNull()
    expect(enginePlatformKey('android', 'arm64')).toBe('android-arm64')
  })
  it('bóveda y gpsd por socket Unix en la carpeta privada de la app', () => {
    expect(vaultSocket('android', '/sdcard/SurvivalOS', 47800, '/data/user/0/app/files')).toBe(join('/data/user/0/app/files', 'vault.sock'))
    const env = serviceEnv({ root: '/p', data: '/sdcard/SurvivalOS', ports: PREFERRED_PORTS, platform: 'android', privateDir: '/p' })
    expect(env.hub.GPSD_SOCKET).toBe(join('/p', 'gpsd.sock'))
    expect(env.navigation.GPSD_SOCKET).toBe(join('/p', 'gpsd.sock'))
    expect(env.vault.VAULT_SOCKET).toBe(join('/p', 'vault.sock'))
    // Fuera de Android, como siempre (TCP en loopback).
    expect(serviceEnv({ root: '/p', data: '/p/data', ports: PREFERRED_PORTS, platform: 'linux' }).hub.GPSD_SOCKET).toBeUndefined()
  })
  it('componentes del APK enlazados solo si su binario existe y hay versión', () => {
    const lib = '/data/app/x/lib/arm64'
    const have = new Set([join(lib, 'libkiwix-serve.so'), join(lib, 'libkiwix-manage.so'), join(lib, 'libllama-server.so'), join(lib, 'libpmtiles.so')])
    const out = androidComponentLinks({ root: '/p', key: 'android-arm64', libDir: lib, versions: { 'kiwix-tools': '3.8.2', llama: 'b12428', pmtiles: '1.31.2', xpdf: '4.06' } }, (p: string) => have.has(p))
    expect(out.map((c: { comp: string }) => c.comp)).toEqual(['kiwix-tools', 'llama', 'pmtiles'])
    const kiwix = out[0]
    expect(kiwix.dir).toBe(join('/p', 'runtime', 'android-arm64', 'kiwix-tools'))
    expect(kiwix.links).toContainEqual({ name: 'kiwix-serve', target: join(lib, 'libkiwix-serve.so') })
    expect(Object.values(ANDROID_BUNDLED).flatMap((b) => Object.values(b as Record<string, string>)).every((n) => /^lib[\w-]+\.so$/.test(n))).toBe(true)
  })
  it('BRouter en Android lo arranca la app (puente), sin JRE', () => {
    const data = '/sd'
    const rt = join('/p', 'runtime', 'android-arm64')
    const files = new Set([join(rt, 'brouter', 'profiles2'), join(data, 'routing', 'segments4')])
    const fs = { exists: (p: string) => files.has(p), read: () => '', hasRd5: () => true }
    const s = optionalServices({ root: '/p', data, key: 'android-arm64', ports: PREFERRED_PORTS, platform: 'android', threads: 4 }, fs)
    expect(s.brouter.bridge).toBe('routing')
    expect(s.brouter.params.port).toBe(PREFERRED_PORTS.brouter)
    expect(s.brouter.cmd).toBeUndefined()
  })
})

describe('android: guarda de loopback', () => {
  it('reconoce loopback', () => {
    for (const h of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]', '127.0.0.53']) expect(isLoopbackHost(h)).toBe(true)
    for (const h of ['192.168.1.5', '10.0.0.1', '', null]) expect(isLoopbackHost(h)).toBe(false)
  })
  it('cookie y cabecera; sockets Unix y la pasarela LAN quedan fuera', () => {
    const tok = 'a'.repeat(48)
    expect(cookieValue('x=1; survival_app=abc; y=2', 'survival_app')).toBe('abc')
    expect(allowed({ localAddress: '127.0.0.1', headers: {} }, tok)).toBe(false)
    expect(allowed({ localAddress: '127.0.0.1', headers: { 'x-survival-token': tok } }, tok)).toBe(true)
    expect(allowed({ localAddress: '127.0.0.1', headers: { 'x-survival-token': `${tok}x` } }, tok)).toBe(false)
    expect(allowed({ localAddress: '::ffff:127.0.0.1', headers: { cookie: `survival_app=${tok}` } }, tok)).toBe(true)
    expect(allowed({ localAddress: undefined, headers: {} }, tok)).toBe(true)
    expect(allowed({ localAddress: '192.168.43.1', headers: {} }, tok)).toBe(true)
    expect(allowed({ localAddress: '127.0.0.1', headers: {} }, undefined)).toBe(true)
  })
  it('instalada: rechaza sin token y fetch a loopback lo añade solo', async () => {
    expect(install('t'.repeat(32))).toBe(true)
    const server = createServer((_req, res) => res.end('ok'))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const raw = await new Promise<string>((ok) => {
      const s = connect(port, '127.0.0.1', () => s.write(`GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`))
      let buf = ''
      s.on('data', (d) => (buf += String(d)))
      s.on('close', () => ok(buf))
    })
    expect(raw.startsWith('HTTP/1.1 403')).toBe(true)
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    server.close()
  })
})

describe('android: volúmenes extraíbles (usb.mjs)', () => {
  it('solo montados, extraíbles y con ruta /storage/<uuid>', () => {
    const v = parseAndroidVolumes(JSON.stringify([
      { uuid: '1A2B-3C4D', path: '/storage/1A2B-3C4D', label: 'SanDisk USB', removable: true, state: 'mounted' },
      { uuid: 'ABCD-0001', path: '/storage/ABCD-0001', label: 'microSD', removable: true, state: 'unmounted' },
      { uuid: 'X/../../data', path: '/storage/X/../../data', label: 'malo', removable: true, state: 'mounted' },
      { uuid: '9999-0000', path: '/data/otro', label: 'ruta rara', removable: true, state: 'mounted' },
    ]))
    expect(v).toEqual([{ uuid: '1A2B-3C4D', path: '/storage/1A2B-3C4D', label: 'SanDisk USB', fs: null }])
    expect(parseAndroidVolumes('no es json')).toEqual([])
  })
})

/** ELF64 LE mínimo: un PT_LOAD con todo el fichero, PT_DYNAMIC, tabla de cadenas con DT_NEEDED y DT_SONAME. */
function fakeElf(needed: string[], soname: string, runpath?: string): Buffer {
  const strs = ['', soname, ...needed, ...(runpath ? [runpath] : [])]
  const strtab = Buffer.from(`${strs.join('\0')}\0`, 'latin1')
  const off = (s: string) => Buffer.from(`${strs.slice(0, strs.indexOf(s)).join('\0')}\0`, 'latin1').length - (strs.indexOf(s) === 0 ? 1 : 0)
  const phoff = 64
  const dynOff = phoff + 2 * 56
  const dynEntries: [number, number][] = [...needed.map((n) => [1, off(n)] as [number, number]), [14, off(soname)], [5, 0], [10, strtab.length], ...(runpath ? [[29, off(runpath)] as [number, number]] : []), [0, 0]]
  const strOff = dynOff + dynEntries.length * 16
  dynEntries[needed.length + 1] = [5, strOff]
  const size = strOff + strtab.length
  const b = Buffer.alloc(size)
  b.writeUInt32BE(0x7f454c46, 0)
  b[4] = 2
  b[5] = 1
  b.writeUInt16LE(3, 0x10)
  b.writeUInt16LE(183, 0x12)
  b.writeBigUInt64LE(BigInt(phoff), 0x20)
  b.writeUInt16LE(56, 0x36)
  b.writeUInt16LE(2, 0x38)
  // PT_LOAD
  b.writeUInt32LE(1, phoff)
  b.writeBigUInt64LE(0n, phoff + 8)
  b.writeBigUInt64LE(0n, phoff + 16)
  b.writeBigUInt64LE(BigInt(size), phoff + 32)
  b.writeBigUInt64LE(16384n, phoff + 48)
  // PT_DYNAMIC
  b.writeUInt32LE(2, phoff + 56)
  b.writeBigUInt64LE(BigInt(dynOff), phoff + 56 + 8)
  b.writeBigUInt64LE(BigInt(dynEntries.length * 16), phoff + 56 + 32)
  dynEntries.forEach(([tag, val], i) => {
    b.writeBigInt64LE(BigInt(tag), dynOff + i * 16)
    b.writeBigUInt64LE(BigInt(val), dynOff + i * 16 + 8)
  })
  strtab.copy(b, strOff)
  return b
}

describe('android: binarios del APK (elf.mjs, natives.mjs)', () => {
  it('nombres válidos para jniLibs, nunca más largos', () => {
    expect(androidLibName('libssl.so.3')).toBe('libssl3.so')
    expect(androidLibName('libicuuc.so.78')).toBe('libicuuc78.so')
    expect(androidLibName('libz.so.1.3.1')).toBe('libz131.so')
    expect(androidLibName('libc++_shared.so')).toBe('libc++_shared.so')
    for (const s of ['libssl.so.3', 'libicuuc.so.78', 'libz.so.1.3.1']) expect(androidLibName(s).length).toBeLessThanOrEqual(s.length)
  })
  it('renombra DT_NEEDED y DT_SONAME en su sitio', () => {
    const elf = fakeElf(['libssl.so.3', 'libc.so', 'libz.so.1'], 'libcrypto.so.3')
    const info = parseElf(elf)
    expect(info.needed.map((n: { name: string }) => n.name)).toEqual(['libssl.so.3', 'libc.so', 'libz.so.1'])
    const map = new Map([['libssl.so.3', 'libssl3.so'], ['libz.so.1', 'libz1.so'], ['libcrypto.so.3', 'libcrypto3.so']])
    expect(patchElf(elf, map)).toBe(3)
    const after = parseElf(elf)
    expect(after.needed.map((n: { name: string }) => n.name)).toEqual(['libssl3.so', 'libc.so', 'libz1.so'])
    expect(after.soname.name).toBe('libcrypto3.so')
    expect(after.loads[0].align).toBe(16384)
  })
  it('RUNPATH de Termux → $ORIGIN (bibliotecas junto al ejecutable)', () => {
    const elf = fakeElf(['libz.so.1'], 'libfoo.so', '/data/data/com.termux/files/usr/lib')
    expect(setRunpathOrigin(elf)).toBe(true)
    expect(parseElf(elf).runpath).toBe('$ORIGIN')
    expect(parseElf(elf).needed[0].name).toBe('libz.so.1')
    expect(setRunpathOrigin(fakeElf(['libz.so.1'], 'libbar.so'))).toBe(false)
  })
  it('índice de Termux y cierre de dependencias', () => {
    const idx = parsePackages('Package: nodejs-lts\nVersion: 24.22.3\nDepends: libc++, openssl (>= 3), c-ares\n\nPackage: openssl\nDepends: ca-certificates, zlib\n\nPackage: zlib\n\nPackage: c-ares\n\nPackage: libc++\n')
    expect(depsOf(idx.get('nodejs-lts'))).toEqual(['libc++', 'openssl', 'c-ares'])
    expect(closure(idx, ['nodejs-lts'])).toEqual(['c-ares', 'libc++', 'nodejs-lts', 'openssl', 'zlib'])
    expect(() => closure(idx, ['no-existe'])).toThrow()
  })
})

describe('android: zip en JavaScript (el tar de Android no abre zip)', () => {
  it('writeZip → extractZip conserva el contenido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    mkdirSync(join(dir, 'src', 'profiles2'), { recursive: true })
    writeFileSync(join(dir, 'src', 'profiles2', 'trekking.brf'), 'assign x = 1\n'.repeat(100))
    writeFileSync(join(dir, 'src', 'README.txt'), 'hola')
    expect(writeZip(join(dir, 'src'), join(dir, 'a.zip'), 'brouter')).toBe(2)
    extractZip(join(dir, 'a.zip'), join(dir, 'out'))
    expect(readFileSync(join(dir, 'out', 'brouter', 'profiles2', 'trekking.brf'), 'utf8')).toBe('assign x = 1\n'.repeat(100))
    expect(readFileSync(join(dir, 'out', 'brouter', 'README.txt'), 'utf8')).toBe('hola')
  })
})

describe('asistente según la memoria del equipo', () => {
  const GiB = 1024 ** 3
  const llm = (id: string, bytes: number, def = false) => ({ id, kind: 'llm', group: 'asistente', lang: 'mul', priority: 2, default: def, approxBytes: bytes, license: '', title: id, description: '', equivalentOf: null, variants: null })
  const catalog = [llm('asistente', 2.4e9, true), llm('asistente-llama32', 1.92e9), llm(LIGHT_ASSISTANT, 1.07e9)]
  it('cabe: ~1,3 × el modelo + 1,5 GiB', () => {
    expect(llmFits(2.4e9, 8 * GiB)).toBe(true)
    expect(llmFits(2.4e9, 3.7 * GiB)).toBe(false)
    expect(llmFits(1.07e9, 3.7 * GiB)).toBe(true)
    expect(llmFits(2.4e9, null)).toBe(true)
  })
  it('tablet de 4 GB: solo el ligero, y queda activo (el último)', () => {
    const all = downloadPlan(catalog, new Set(), 'es', null, 'all', 3.7 * GiB)
    expect(all.filter((i: { kind: string }) => i.kind === 'llm').map((i: { id: string }) => i.id)).toEqual([LIGHT_ASSISTANT])
    const rec = downloadPlan(catalog, new Set(), 'es', null, 'recommended', 3.7 * GiB)
    expect(rec.map((i: { id: string }) => i.id)).toContain(LIGHT_ASSISTANT)
    expect(orderPlan(all).at(-1).id).toBe(LIGHT_ASSISTANT)
  })
  it('equipo de 8 GB: todos, y el principal activo', () => {
    const all = downloadPlan(catalog, new Set(), 'es', null, 'all', 8 * GiB)
    expect(all.filter((i: { kind: string }) => i.kind === 'llm')).toHaveLength(3)
    expect(orderPlan(all).at(-1).id).toBe('asistente')
    const rec = downloadPlan(catalog, new Set(), 'es', null, 'recommended', 8 * GiB)
    expect(rec.filter((i: { kind: string }) => i.kind === 'llm').map((i: { id: string }) => i.id)).toEqual(['asistente'])
  })
})
