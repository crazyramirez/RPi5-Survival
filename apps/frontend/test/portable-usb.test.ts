import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error módulos .mjs sin tipos (portable/, fuera del monorepo TypeScript)
import { autoOpenPaths, cleanRel, desktopArg, disable, dismiss, enable, parseConf, serializeConf, status } from '../../../portable/autoopen.mjs'
// @ts-expect-error módulo .mjs sin tipos
import { makeIcns, makeIco, makeIconPng } from '../../../portable/icon.mjs'
import {
  attrHiddenNames, autorunInf, ejectSpec, findVolume, finderInfoWithCustomIcon, fsKind, hiddenFile, isInside, parseMacMount,
  parseProcMounts, prepareUsb, readVolumeId, volumeInfo,
  // @ts-expect-error módulo .mjs sin tipos
} from '../../../portable/usb.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'survival-usb-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const ID = '0123456789abcdef0123456789abcdef'

describe('portable usb: iconos', () => {
  it('PNG válido al tamaño pedido', () => {
    const png = makeIconPng(32)
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(32)
  })
  it('ICO con varios tamaños e ICNS con cabecera y longitud correctas', () => {
    const ico = makeIco([16, 32, 256])
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    expect(ico[6 + 32]).toBe(0) // 256 se escribe como 0
    const icns = makeIcns()
    expect(icns.subarray(0, 4).toString('latin1')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
  })
})

describe('portable usb: unidades', () => {
  it('normaliza el sistema de ficheros', () => {
    expect(fsKind('FAT32')).toBe('fat32')
    expect(fsKind('msdos')).toBe('fat32')
    expect(fsKind('vfat')).toBe('fat32')
    expect(fsKind('exFAT')).toBe('exfat')
    expect(fsKind('fuseblk')).toBe('ntfs')
    expect(fsKind('')).toBeNull()
  })
  it('lee los montajes de macOS y Linux', () => {
    const mac = parseMacMount('/dev/disk3s1 on / (apfs, local)\n/dev/disk4s1 on /Volumes/SURVIVAL OS (exfat, local, nodev)\n')
    expect(mac.get('/Volumes/SURVIVAL OS')).toBe('exfat')
    const lin = parseProcMounts('/dev/sda1 /media/u/MI\\040USB vfat rw 0 0\n')
    expect(lin.get('/media/u/MI USB')).toEqual({ fs: 'vfat', dev: '/dev/sda1' })
  })
  it('encuentra la memoria que contiene la carpeta (Windows sin distinguir mayúsculas)', () => {
    const media = [{ media: 'E/USB', path: 'E:\\', label: 'USB', fs: 'exfat' }]
    expect(isInside('e:\\Survivelia OS', 'E:\\', 'win32')).toBe(true)
    expect(findVolume('E:\\Survivelia OS', media, 'win32')?.media).toBe('E/USB')
    expect(findVolume('C:\\Users\\u', media, 'win32')).toBeNull()
  })
  it('volumeInfo: raíz de la memoria, carpeta relativa e identificador', () => {
    const mount = join(tmp, 'vol')
    mkdirSync(join(mount, '.survival-os'), { recursive: true })
    writeFileSync(join(mount, '.survival-os', 'volume-id'), `${ID}\n`)
    const media = [{ media: 'extra/vol', path: mount, label: 'vol', fs: 'exfat' }]
    const atRoot = volumeInfo(mount, process.platform, media)
    expect(atRoot).toMatchObject({ removable: true, volumeRoot: true, id: ID, rel: '.' })
    const sub = volumeInfo(join(mount, 'Survivelia OS'), process.platform, media)
    expect(sub).toMatchObject({ removable: true, volumeRoot: false, rel: 'Survivelia OS' })
    expect(volumeInfo(join(tmp, 'otro'), process.platform, media).removable).toBe(false)
  })
})

describe('portable usb: integración visual', () => {
  it('autorun.inf solo con icono y nombre (CRLF)', () => {
    expect(autorunInf()).toBe('[autorun]\r\nicon=app\\portable\\icon.ico\r\nlabel=Survivelia OS\r\n')
  })
  it('nunca oculta los lanzadores de Windows ni de macOS (el atributo es común en FAT/exFAT)', () => {
    const names = attrHiddenNames({ volumeRoot: true, hasExe: true })
    expect(names).toContain('app')
    expect(names).toContain('abrir-survival-os.sh')
    expect(names).toContain('autorun.inf')
    expect(names).not.toContain('Survivelia OS.exe')
    expect(names).not.toContain('Survivelia OS.app')
    expect(names).not.toContain('data')
    expect(attrHiddenNames({ volumeRoot: false, hasExe: false })).not.toContain('Abrir Survivelia OS.cmd')
  })
  it('.hidden: en Linux se ocultan las cosas de Windows y macOS, no su lanzador', () => {
    const h = hiddenFile({ volumeRoot: true }).split('\n')
    expect(h).toContain('Survivelia OS.exe')
    expect(h).toContain('Survivelia OS.app')
    expect(h).not.toContain('abrir-survival-os.sh')
  })
  it('FinderInfo: marca de icono personalizado conservando el resto', () => {
    expect(finderInfoWithCustomIcon('')).toBe(`${'00'.repeat(8)}04${'00'.repeat(23)}`)
    const keep = finderInfoWithCustomIcon(`${'11'.repeat(8)}40${'22'.repeat(23)}`)
    expect(keep.slice(16, 18)).toBe('44')
    expect(keep.slice(0, 16)).toBe('11'.repeat(8))
  })
})

describe('portable usb: expulsar', () => {
  it('Windows: solo letras de unidad y textos por entorno, nunca en el código', () => {
    expect(() => ejectSpec('win32', 'E:\\; calc', 1, {})).toThrow()
    const s = ejectSpec('win32', 'E:\\', 42, { ok: "'; Remove-Item C:\\ #" })
    expect(s.args.join(' ')).not.toContain('Remove-Item')
    expect(s.env.SURVIVAL_EJECT_OK).toContain('Remove-Item')
    expect(s.env.SURVIVAL_EJECT_PID).toBe('42')
  })
  it('macOS y Linux: la ruta va por entorno', () => {
    const mac = ejectSpec('darwin', '/Volumes/X"; rm -rf ~', 1, {})
    expect(mac.args[1]).not.toContain('rm -rf')
    expect(mac.args[1]).toContain('diskutil eject')
    expect(ejectSpec('linux', '/media/u/X', 1, {}).args[1]).toContain('gio mount -e')
  })
})

describe('portable usb: abrir al conectar', () => {
  it('configuración: ida y vuelta, y se descartan valores peligrosos', () => {
    const text = serializeConf({
      mode: 'open',
      volumes: [{ id: ID, rel: '.' }, { id: 'malo', rel: '.' }, { id: `${ID.slice(0, 31)}f`, rel: '../fuera' }],
      dismissed: [ID],
      messages: { ask: 'Línea\nmala {name}' },
    })
    const c = parseConf(text)
    expect(c.mode).toBe('open')
    expect(c.volumes).toEqual([{ id: ID, rel: '.' }])
    expect(c.dismissed).toEqual([ID])
    expect(c.messages.ask).toBe('Línea mala {name}')
    expect(cleanRel('Survivelia OS')).toBe('Survivelia OS')
    expect(cleanRel('C:\\x')).toBeNull()
  })
  it('Exec= de un .desktop escapado', () => {
    expect(desktopArg('/home/a b/$x"')).toBe('"/home/a b/\\$x\\""')
  })
  it('rutas por usuario, sin administrador', () => {
    // Carpeta interna con el nombre de antes (siguen valiendo los ya activados); acceso visible con el nuevo.
    const win = autoOpenPaths('win32', { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' }, 'C:\\u')
    expect(win.dir).toBe(join('C:\\L', 'Survival OS USB'))
    expect(win.shortcut).toMatch(/Survivelia OS \(USB\)\.lnk$/)
    expect(win.legacy?.[0]).toMatch(/Survival OS \(USB\)\.lnk$/)
    expect(autoOpenPaths('darwin', {}, '/Users/u').agent).toMatch(/LaunchAgents[\\/]org\.survival-os\.usb\.plist$/)
    expect(autoOpenPaths('linux', {}, '/home/u').autostart).toMatch(/\.config[\\/]autostart[\\/]survival-os-usb\.desktop$/)
  })
  it('activar, cambiar de opinión y desactivar (Linux, sin tocar el sistema)', () => {
    const root = join(tmp, 'portable-ao')
    mkdirSync(join(root, 'app', 'portable'), { recursive: true })
    writeFileSync(join(root, 'app', 'portable', 'usb-watch.sh'), '#!/bin/sh\n')
    writeFileSync(join(root, 'app', 'portable', 'icon.png'), makeIconPng(16))
    const saved = { ...process.env }
    process.env.SURVIVAL_AUTOOPEN_DIR = join(tmp, 'ao')
    process.env.SURVIVAL_SHORTCUT_DIR = join(tmp, 'ao-links')
    process.env.SURVIVAL_AUTOOPEN_DRY = '1'
    try {
      expect(status({ root, volumeId: ID, platform: 'linux' })).toMatchObject({ supported: true, enabled: false, paired: false })
      const on = enable({ root, volumeId: ID, rel: '.', mode: 'ask', messages: { yes: 'Open' }, platform: 'linux' })
      expect(on).toMatchObject({ enabled: true, paired: true, mode: 'ask' })
      const paths = autoOpenPaths('linux')
      expect(readFileSync(paths.autostart, 'utf8')).toContain('usb-watch.sh" watch')
      expect(readFileSync(paths.desktop, 'utf8')).toContain('Name=Survivelia OS (USB)')
      expect(parseConf(readFileSync(paths.conf, 'utf8')).messages.yes).toBe('Open')
      expect(disable({ root, volumeId: ID, platform: 'linux' })).toMatchObject({ enabled: false, paired: false })
      expect(existsSync(paths.autostart) || existsSync(paths.desktop) || existsSync(paths.conf)).toBe(false)
      expect(dismiss({ root, volumeId: ID, platform: 'linux' }).dismissed).toBe(true)
    } finally {
      process.env = saved
    }
  })
})

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0
describe.skipIf(!hasSh)('portable usb: vigilante (usb-watch.sh)', () => {
  it('solo abre memorias emparejadas, una vez por conexión', () => {
    const dir = join(tmp, 'watch')
    const mount = join(tmp, 'mnt-a')
    const other = join(tmp, 'mnt-b')
    mkdirSync(dir, { recursive: true })
    for (const [m, id] of [[mount, ID], [other, 'ffffffffffffffffffffffffffffffff']] as const) {
      mkdirSync(join(m, '.survival-os'), { recursive: true })
      writeFileSync(join(m, '.survival-os', 'volume-id'), `${id}\n`)
    }
    writeFileSync(join(dir, 'usb-watch.sh'), readFileSync(resolve(__dirname, '../../../portable/usb-watch.sh')))
    writeFileSync(join(dir, 'autoopen.conf'), serializeConf({ mode: 'open', volumes: [{ id: ID, rel: '.' }] }))
    const toSh = (p: string) => p.replace(/\\/g, '/')
    const run = (cmd: string, mounts: string[]) =>
      spawnSync('sh', [toSh(join(dir, 'usb-watch.sh')), cmd], { env: { ...process.env, SURVIVAL_WATCH_DRY: '1', SURVIVAL_WATCH_MOUNTS: mounts.map(toSh).join('\n') }, encoding: 'utf8' })
    const launched = () => (existsSync(join(dir, 'launched')) ? readFileSync(join(dir, 'launched'), 'utf8').trim().split('\n') : [])
    expect(run('check', [mount, other]).status).toBe(0)
    expect(launched()).toEqual([`${toSh(mount)}/.`])
    run('check', [mount, other])
    expect(launched()).toHaveLength(1) // sigue conectada: no se repite
    run('check', [other])
    run('check', [mount, other])
    expect(launched()).toHaveLength(2) // se volvió a conectar
    run('seed', [])
    run('open', [mount])
    expect(launched()).toHaveLength(3)
  })
})

describe('portable usb: preparar una memoria', () => {
  it('copia la app, los datos que faltan e integra la memoria; al repetir conserva sus datos', async () => {
    const root = join(tmp, 'src')
    const data = join(root, 'data')
    const target = join(tmp, 'usb')
    for (const d of ['app/portable', 'runtime/win-x64', 'runtime/linux-x64', 'Survivelia OS.app/Contents/MacOS', 'data/maps', 'data/logs', 'data/browser']) mkdirSync(join(root, d), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(root, 'app', 'portable', 'launcher.mjs'), '// lanzador')
    writeFileSync(join(root, 'app', 'portable', 'icon.png'), makeIconPng(16))
    writeFileSync(join(root, 'app', 'portable', 'icon.icns'), makeIcns())
    writeFileSync(join(root, 'app', 'portable', 'data-LEEME.txt'), 'datos')
    writeFileSync(join(root, 'runtime', 'win-x64', 'node.exe'), 'x')
    writeFileSync(join(root, 'runtime', 'linux-x64', 'node'), 'x')
    writeFileSync(join(root, 'Survivelia OS.exe'), 'exe')
    writeFileSync(join(root, 'abrir-survival-os.sh'), '#!/bin/sh')
    writeFileSync(join(root, 'LEEME.txt'), 'leeme')
    writeFileSync(join(data, 'maps', 'zona.pmtiles'), 'mapa-origen')
    writeFileSync(join(data, 'logs', 'web.log'), 'log')
    writeFileSync(join(data, 'browser', 'Cookies'), 'privado')
    const lines: string[] = []

    const r = await prepareUsb({ root, data, target, fs: 'exfat', withData: true, rename: false, platform: 'linux', version: '9.9.9', log: (l: string) => lines.push(l) })
    expect(r.existing).toBe(false)
    expect(readVolumeId(target)).toBe(r.id)
    for (const f of ['app/portable/launcher.mjs', 'runtime/win-x64/node.exe', 'Survivelia OS.exe', 'Survivelia OS.app', 'LEEME.txt', 'autorun.inf', 'autorun.sh', '.xdg-volume-info', '.hidden', '.VolumeIcon.icns', '.VolumeIcon.png', 'data/maps/zona.pmtiles', 'data/LEEME.txt']) {
      expect(existsSync(join(target, f)), f).toBe(true)
    }
    expect(existsSync(join(target, 'data', 'logs'))).toBe(false)
    expect(existsSync(join(target, 'data', 'browser'))).toBe(false)
    expect(lines.some((l) => l.includes('solo incluye'))).toBe(true) // faltan darwin y linux-arm64

    // La memoria ya tiene sus propios datos: se actualiza la app y no se pisa nada suyo.
    writeFileSync(join(target, 'data', 'maps', 'zona.pmtiles'), 'mapa-de-la-memoria-distinto')
    writeFileSync(join(root, 'app', 'portable', 'launcher.mjs'), '// lanzador nuevo')
    const r2 = await prepareUsb({ root, data, target, fs: 'exfat', withData: true, rename: false, platform: 'linux', version: '9.9.10', log: () => undefined })
    expect(r2.existing).toBe(true)
    expect(r2.id).toBe(r.id)
    expect(readFileSync(join(target, 'data', 'maps', 'zona.pmtiles'), 'utf8')).toBe('mapa-de-la-memoria-distinto')
    expect(readFileSync(join(target, 'app', 'portable', 'launcher.mjs'), 'utf8')).toBe('// lanzador nuevo')
    expect(existsSync(join(target, 'app.part'))).toBe(false)
  })
  it('bases SQLite abiertas: instantánea consistente, sin -wal/-shm; el índice de la biblioteca no se copia', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const root = join(tmp, 'src-sql')
    const data = join(root, 'data')
    const target = join(tmp, 'usb-sql')
    mkdirSync(join(root, 'app', 'portable'), { recursive: true })
    mkdirSync(join(data, 'serial-hub'), { recursive: true })
    mkdirSync(join(data, 'library'), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(root, 'app', 'portable', 'launcher.mjs'), '//')
    writeFileSync(join(data, 'library', 'index.sqlite'), 'indice')
    // Base abierta en modo WAL con datos aún sin volcar al fichero principal (como serial-hub en marcha).
    const db = new DatabaseSync(join(data, 'serial-hub', 'mesh.db'))
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE m (t TEXT); INSERT INTO m VALUES (\'hola\')')
    try {
      await prepareUsb({ root, data, target, withData: true, rename: false, platform: 'linux', log: () => undefined })
    } finally {
      db.close()
    }
    const copy = new DatabaseSync(join(target, 'data', 'serial-hub', 'mesh.db'), { readOnly: true })
    expect(copy.prepare('SELECT t FROM m').all()).toEqual([{ t: 'hola' }])
    copy.close()
    expect(existsSync(join(target, 'data', 'serial-hub', 'mesh.db-wal'))).toBe(false)
    expect(existsSync(join(target, 'data', 'library', 'index.sqlite'))).toBe(false)
  })
  it('no prepara la misma memoria desde la que se ejecuta', async () => {
    const root = join(tmp, 'self')
    mkdirSync(root, { recursive: true })
    await expect(prepareUsb({ root, data: join(root, 'data'), target: root, platform: 'linux' })).rejects.toThrow(/misma memoria/)
  })
})
