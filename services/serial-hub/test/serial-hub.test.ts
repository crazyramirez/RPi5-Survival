import { describe, expect, it } from 'vitest'
import { HW_MODELS } from '../src/enums.ts'
import { estimateTime, nodeSummary, precisionM, rememberPosition, Store, textMessage, timeSample, validateSend, validateTrack } from '../src/mesh.ts'
import { FrameParser, Session, decodeFromRadio, frame, positionRequest, textPacket, wantConfig } from '../src/meshtastic.ts'
import { applyNmea, checksumOk, coord, emptyNmea, looksLikeNmea, toTpv } from '../src/nmea.ts'
import { Msg, Writer } from '../src/proto.ts'

const hwNum = (name: string): number => Number(Object.entries(HW_MODELS).find(([, v]) => v === name)?.[0])

describe('protobuf mínimo', () => {
  it('ida y vuelta de todos los tipos usados', () => {
    const inner = new Writer().string(1, 'ñandú').uint(2, 300)
    const buf = new Writer().uint(1, 4294967295).fixed32(2, 0xdeadbeef).sfixed32(3, -404123456).float(4, -7.25).msg(5, inner).bool(6, true).finish()
    const m = new Msg(buf)
    expect(m.uint(1)).toBe(4294967295)
    expect(m.fixed32(2)).toBe(0xdeadbeef)
    expect(m.sfixed32(3)).toBe(-404123456)
    expect(m.float(4)).toBe(-7.25)
    expect(m.msg(5)?.string(1)).toBe('ñandú')
    expect(m.msg(5)?.uint(2)).toBe(300)
    expect(m.bool(6)).toBe(true)
    expect(m.uint(9)).toBeNull()
  })
  it('rechaza mensajes truncados', () => {
    const buf = new Writer().string(1, 'hola').finish()
    expect(() => new Msg(buf.subarray(0, 3))).toThrow()
  })
})

describe('tramas serie', () => {
  it('separa tramas con basura de registro y tramas partidas', () => {
    const got: Uint8Array[] = []
    const p = new FrameParser((f) => got.push(f))
    const a = frame(Uint8Array.from([1, 2, 3]))
    const b = frame(Uint8Array.from([9]))
    const log = new TextEncoder().encode('INFO  | ??:??:?? 1 [Main] booting\r\n')
    const all = new Uint8Array([...log, ...a, ...b])
    p.push(all.subarray(0, log.length + 2))
    p.push(all.subarray(log.length + 2))
    expect(got.map((g) => [...g])).toEqual([[1, 2, 3], [9]])
  })
  it('ignora longitudes imposibles', () => {
    const got: Uint8Array[] = []
    const p = new FrameParser((f) => got.push(f))
    p.push(Uint8Array.from([0x94, 0xc3, 0xff, 0xff, ...frame(Uint8Array.from([7]))]))
    expect(got.map((g) => [...g])).toEqual([[7]])
  })
  it('want_config y paquetes salientes con los números de campo de meshtastic/protobufs', () => {
    expect(new Msg(wantConfig(42)).uint(3)).toBe(42)
    const t = new Msg(textPacket({ to: 0xffffffff, channel: 1, text: 'hola', id: 7, wantAck: false })).msg(1)!
    expect(t.fixed32(2)).toBe(0xffffffff)
    expect(t.uint(3)).toBe(1)
    expect(t.msg(4)?.uint(1)).toBe(1)
    expect(t.msg(4)?.string(2)).toBe('hola')
    expect(t.fixed32(6)).toBe(7)
    const r = new Msg(positionRequest({ to: 0x5e5e0002, channel: 1, id: 9 })).msg(1)!
    expect(r.msg(4)?.uint(1)).toBe(3)
    expect(r.msg(4)?.bool(3)).toBe(true)
  })
})

describe('FromRadio y sesión', () => {
  const user = new Writer().string(1, '!5e5e0001').string(2, 'Survival Base').string(3, 'SB').uint(5, hwNum('HELTEC_V4'))
  const pos = new Writer().sfixed32(1, 283456789).sfixed32(2, -164567890).uint(3, 120).fixed32(4, 1770000000).uint(23, 13)
  const metrics = new Writer().uint(1, 101).float(2, 4.2)
  const nodeInfo = new Writer().uint(1, 0x5e5e0001).msg(2, user).msg(3, pos).float(4, 6.5).fixed32(5, 1770000100).msg(6, metrics).uint(9, 0)

  it('decodifica my_info, node_info, canal y fin de configuración', () => {
    const s = new Session()
    s.apply(decodeFromRadio(new Writer().msg(3, new Writer().uint(1, 0x5e5e0001)).finish()))
    s.apply(decodeFromRadio(new Writer().msg(4, nodeInfo).finish()))
    s.apply(decodeFromRadio(new Writer().msg(10, new Writer().uint(1, 1).msg(2, new Writer().bytes(2, new Uint8Array(32)).string(3, 'Survival')).uint(3, 1)).finish()))
    s.apply(decodeFromRadio(new Writer().msg(13, new Writer().string(1, '2.7.26')).finish()))
    s.apply(decodeFromRadio(new Writer().uint(7, 42).finish()))
    expect(s.myNodeNum).toBe(0x5e5e0001)
    expect(s.configComplete).toBe(true)
    expect(s.firmware).toBe('2.7.26')
    expect(s.channels.get(1)).toMatchObject({ name: 'Survival', role: 1, pskLength: 32 })
    const sum = nodeSummary(s.nodes.get(0x5e5e0001)!, s.myNodeNum)
    expect(sum).toMatchObject({ id: '!5e5e0001', longName: 'Survival Base', hwModel: 'HELTEC_V4', role: 'CLIENT', isMe: true, snr: 6.5, hopsAway: 0 })
    expect(sum.position).toMatchObject({ lat: 28.3456789, lon: -16.456789, alt: 120, at: '2026-02-02T02:40:00Z', precisionM: precisionM(13) })
    // 101 = alimentación externa: no es un porcentaje real.
    expect(sum.battery).toMatchObject({ level: null, powered: true, voltage: 4.2 })
  })

  it('un mensaje de texto recibido actualiza el nodo y se convierte en mensaje', () => {
    const s = new Session()
    const data = new Writer().uint(1, 1).string(2, '¿Todo bien?')
    const raw = new Writer().fixed32(1, 0x5e5e0002).fixed32(2, 0xffffffff).uint(3, 1).msg(4, data).fixed32(6, 99).fixed32(7, 1770000200).float(8, -3.5).uint(9, 1).uint(15, 3)
    const p = s.apply(decodeFromRadio(new Writer().msg(2, raw).finish()))!
    const m = textMessage(p)!
    expect(m).toMatchObject({ packetId: 99, from: '!5e5e0002', to: '^all', channel: 1, text: '¿Todo bien?', snr: -3.5, hops: 2 })
    expect(s.nodes.get(0x5e5e0002)).toMatchObject({ lastHeard: 1770000200, snr: -3.5, hopsAway: 2 })
  })
})

describe('reglas portadas de survival_mesh.py', () => {
  it('precisión por bits de canal', () => {
    expect(precisionM(0)).toBeNull()
    expect(precisionM(32)).toBeNull()
    expect(precisionM(13)).toBe(Math.round((2 ** 19 * 1e-7 * 111_320) / 2))
  })
  it('validación de envío', () => {
    expect(() => validateSend({ text: '  ' }, [0])).toThrow(/Escribe/)
    expect(() => validateSend({ text: 'x'.repeat(201) }, [0])).toThrow(/largo/)
    expect(() => validateSend({ text: 'hola', channel: 5 }, [0, 1])).toThrow(/Canal/)
    expect(() => validateSend({ text: 'hola', to: 'pepe' }, [0])).toThrow(/Destino/)
    expect(validateSend({ text: ' hola ', channel: 1, to: '!5e5e0002' }, [0, 1])).toEqual({ text: 'hola', channel: 1, to: '!5e5e0002' })
  })
  it('hora solo del canal privado y con dos muestras que coinciden', () => {
    const pkt = (ch: number, t: number) =>
      ({ fromId: '!5e5e0002', channel: ch, decoded: { portnum: 'POSITION_APP', position: { time: t } } }) as Parameters<typeof timeSample>[0]
    expect(timeSample(pkt(0, 1780000000), new Set([1]), 10)).toBeNull() // canal público
    expect(timeSample(pkt(1, 1600000000), new Set([1]), 10)).toBeNull() // hora imposible
    const a = timeSample(pkt(1, 1780000000), new Set([1]), 100)!
    const b = timeSample(pkt(1, 1780000060), new Set([1]), 160)!
    expect(estimateTime([a], 170)).toBeNull()
    expect(estimateTime([a, b], 170)).toMatchObject({ utc: 1780000070, samples: 2, spreadS: 0 })
    const c = { ...b, nodeTime: 1780000200 }
    expect(estimateTime([a, c], 170)).toBeNull() // no coinciden
  })
  it('última posición: solo con hora y solo si es más reciente', () => {
    const p = (at: string | null) => ({ lat: 1, lon: 2, alt: null, at, precisionM: null })
    expect(rememberPosition(null, p(null))).toBeNull()
    const old = rememberPosition(null, p('2026-01-01T00:00:00Z'))
    expect(rememberPosition(old, p('2025-12-31T00:00:00Z'))).toBe(old)
    expect(rememberPosition(old, p('2026-02-01T00:00:00Z'))?.at).toBe('2026-02-01T00:00:00Z')
  })
  it('nodo seguido', () => {
    expect(validateTrack({ id: null })).toBeNull()
    expect(() => validateTrack({})).toThrow()
    expect(() => validateTrack({ id: '!XYZ' })).toThrow()
  })
  it('mensajes en SQLite (node:sqlite), sin duplicados', () => {
    const st = new Store(':memory:')
    const m = { packetId: 1, from: '!a', to: '^all', channel: 0, text: 'hola', rxTime: '2026-01-01T00:00:00Z' }
    st.add(m, 'in')
    st.add(m, 'in')
    expect(st.list(10)).toHaveLength(1)
    expect(st.list(10)[0]).toMatchObject({ direction: 'in', from: '!a', text: 'hola' })
  })
})

describe('NMEA', () => {
  const withSum = (body: string): string => {
    let x = 0
    for (const ch of body) x ^= ch.charCodeAt(0)
    return `$${body}*${x.toString(16).toUpperCase().padStart(2, '0')}`
  }
  it('checksum y coordenadas', () => {
    expect(checksumOk('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47')).toBe(true)
    expect(checksumOk('$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48')).toBe(false)
    expect(coord('4807.038', 'N')).toBeCloseTo(48.1173, 4)
    expect(coord('01131.000', 'W')).toBeCloseTo(-11.516667, 5)
  })
  it('GGA + RMC + GSA → TPV 3D con hora, rumbo y velocidad', () => {
    const st = emptyNmea()
    applyNmea(st, withSum('GNRMC,101530.00,A,2827.12345,N,01615.54321,W,5.0,90.0,161126,,,A'))
    applyNmea(st, withSum('GNGGA,101530.00,2827.12345,N,01615.54321,W,1,09,0.9,120.5,M,40.0,M,,'))
    applyNmea(st, withSum('GNGSA,A,3,01,02,03,04,05,06,07,08,09,,,,1.5,0.9,1.2'))
    applyNmea(st, withSum('GPGSV,3,1,11,01,40,083,46,02,17,308,41,03,07,344,39,04,22,228,45'))
    const tpv = toTpv(st, 'COM5')
    expect(tpv).toMatchObject({ class: 'TPV', mode: 3, time: '2026-11-16T10:15:30.000Z', altMSL: 120.5, track: 90 })
    expect(tpv.lat as number).toBeCloseTo(28.452057, 5)
    expect(tpv.lon as number).toBeCloseTo(-16.259053, 5)
    expect(tpv.speed).toBeCloseTo(2.572, 3)
    expect(st.uSat).toBe(9)
    expect(st.nSat).toBe(11)
    expect(tpv).not.toHaveProperty('eph') // sin inventar precisión desde el HDOP
  })
  it('sin fijación no hay posición', () => {
    const st = emptyNmea()
    applyNmea(st, withSum('GPGGA,101530.00,,,,,0,00,99.99,,,,,,'))
    expect(toTpv(st, 'x')).toEqual({ class: 'TPV', device: 'x', mode: 1 })
  })
  it('detecta un flujo NMEA', () => {
    expect(looksLikeNmea(`${withSum('GPGGA,1,,,,,0,00,,,,,,,')}\r\n${withSum('GPRMC,1,V,,,,,,,,,,N')}\r\n`)).toBe(true)
    expect(looksLikeNmea('INFO | booting\r\nhello')).toBe(false)
  })
})
