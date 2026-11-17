import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AidStore, MIN_TRUSTED_CLOCK_MS } from '../src/aid.ts'
import { aidIni, CLS_AID, frame, gpsTime, ID_AID_EPH, ID_AID_HUI, ID_AID_INI, parseFrames, pollAidEph, pollMonVer, UbxScanner } from '../src/ubx.ts'

describe('UBX', () => {
  it('tramas con el checksum de u-blox (valores de referencia del protocolo)', () => {
    expect(pollMonVer().toString('hex')).toBe('b5620a0400000e34')
    expect(pollAidEph().toString('hex')).toBe('b5620b3100003cbf')
  })

  it('hora GPS: semana y ms de la semana (18 s por delante de UTC)', () => {
    // 2026-11-17T00:00:00Z
    const t = gpsTime(Date.UTC(2026, 10, 17))
    expect(t.week).toBe(2445)
    expect(t.towMs).toBe(2 * 86_400_000 + 18_000)
  })

  it('AID-INI: posición en lat/lon (1e-7 °, cm) y hora con su incertidumbre', () => {
    const f = aidIni({ lat: 36.5, lon: -4.8, alt: 33, accuracyM: 5000 }, Date.UTC(2026, 10, 17), 10_000)
    const [fr] = parseFrames(f as Buffer)
    expect(fr?.cls).toBe(CLS_AID)
    expect(fr?.id).toBe(ID_AID_INI)
    const p = fr?.payload as Buffer
    expect(p.length).toBe(48)
    expect(p.readInt32LE(0)).toBe(365_000_000)
    expect(p.readInt32LE(4)).toBe(-48_000_000)
    expect(p.readInt32LE(8)).toBe(3300)
    expect(p.readUInt32LE(12)).toBe(500_000)
    expect(p.readUInt16LE(18)).toBe(2445)
    expect(p.readUInt32LE(28)).toBe(10_000)
    expect(p.readUInt32LE(44)).toBe(0x23)
    expect(aidIni(null, null)).toBeNull()
    expect(parseFrames(aidIni(null, Date.UTC(2026, 10, 17)) as Buffer)[0]?.payload.readUInt32LE(44)).toBe(0x02)
  })

  it('el escáner saca las tramas UBX de un flujo mezclado con NMEA y troceado', () => {
    const eph = frame(CLS_AID, ID_AID_EPH, Buffer.alloc(104, 7))
    const mixed = Buffer.concat([Buffer.from('$GPGGA,1,,,,,0,00,,,,,,,*66\r\n'), eph, Buffer.from('$GPRMC,1,V*00\r\n'), pollMonVer()])
    const s = new UbxScanner()
    const out = [...s.push(mixed.subarray(0, 50)), ...s.push(mixed.subarray(50, 100)), ...s.push(mixed.subarray(100))]
    expect(out.map((f) => [f.cls, f.id, f.payload.length])).toEqual([
      [CLS_AID, ID_AID_EPH, 104],
      [0x0a, 0x04, 0],
    ])
  })
})

describe('AidStore (ayuda sin Internet)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aid-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const now = MIN_TRUSTED_CLOCK_MS + 30 * 86_400_000
  const eph = (sv: number) => ({ cls: CLS_AID, id: ID_AID_EPH, payload: Buffer.alloc(104, sv) })

  it('sin datos: solo la hora (si el reloj es creíble); con reloj de 1970, nada', () => {
    const s = new AidStore(join(dir, 'a'))
    expect(s.messages(now)).toHaveLength(1)
    expect(s.messages(0)).toHaveLength(0)
  })

  it('guarda y devuelve posición, ionosfera y efemérides mientras valen', () => {
    const s = new AidStore(join(dir, 'b'))
    s.savePosition(36.5, -4.8, 33, now)
    // Menos de 4 efemérides útiles o «sin datos» (8 bytes): no se guardan.
    expect(s.saveFrames([eph(1), { cls: CLS_AID, id: ID_AID_EPH, payload: Buffer.alloc(8) }], now)).toBe(1)
    expect(s.saveFrames([eph(1), eph(2), eph(3), eph(4), { cls: CLS_AID, id: ID_AID_HUI, payload: Buffer.alloc(72) }], now)).toBe(4)
    // Persistente: otra instancia lee lo mismo.
    const again = new AidStore(join(dir, 'b'))
    expect(again.messages(now + 60_000)).toHaveLength(1 + 1 + 4)
    // A las 5 h las efemérides ya no se envían; la ionosfera sí.
    expect(again.messages(now + 5 * 3600_000)).toHaveLength(2)
    // Posición antigua: incertidumbre mayor.
    const ini = parseFrames(again.messages(now + 2 * 86_400_000)[0] as Buffer)[0]?.payload as Buffer
    expect(ini.readUInt32LE(12)).toBe(300_000 * 100)
  })
})
