import { describe, expect, it } from 'vitest'
import { chipName, LineSplitter, looksLikeMeshtastic, MAX_LINE_BYTES, parseLine, RateLimiter, readingsOf } from '../src/protocol.ts'

describe('looksLikeMeshtastic', () => {
  it('reconoce el registro de un nodo Meshtastic (con o sin colores ANSI)', () => {
    expect(looksLikeMeshtastic('[34mDEBUG [0m| 14:24:32 139 [Router] [34mRouting sniffing (id=0x5883d279)')).toBe(true)
    expect(looksLikeMeshtastic('INFO  | ??:??:?? 3 [Main] Booted')).toBe(true)
  })
  it('no confunde mensajes del protocolo propio ni texto cualquiera', () => {
    expect(looksLikeMeshtastic('{"v":1,"type":"hello","device":"cyd-1"}')).toBe(false)
    expect(looksLikeMeshtastic('DEBUG: sensor listo')).toBe(false)
    expect(looksLikeMeshtastic('ets Jun  8 2016 00:22:57')).toBe(false)
  })
})

describe('parseLine (protocolo v1)', () => {
  it('acepta mensajes válidos', () => {
    const r = parseLine('{"v":1,"type":"reading","device":"cyd-1","ts":1200,"payload":{"sensor":"temp_c","value":21.5,"unit":"°C"}}')
    expect(r).toEqual({ ok: true, msg: { type: 'reading', device: 'cyd-1', ts: 1200, payload: { sensor: 'temp_c', value: 21.5, unit: '°C' } } })
  })
  it('rechaza versión, tipo, device y payload incorrectos', () => {
    expect(parseLine('{"v":2,"type":"hello","device":"a"}')).toMatchObject({ ok: false })
    expect(parseLine('{"v":1,"type":"rm -rf","device":"a"}')).toMatchObject({ ok: false, reason: 'tipo desconocido' })
    expect(parseLine('{"v":1,"type":"hello","device":"../../x"}')).toMatchObject({ ok: false, reason: 'device inválido' })
    expect(parseLine('{"v":1,"type":"hello","device":"a","payload":[1]}')).toMatchObject({ ok: false })
    expect(parseLine('basura binaria \u0000\u0001')).toMatchObject({ ok: false, reason: 'JSON inválido' })
    expect(parseLine(`{"v":1,"type":"hello","device":"a","payload":{"x":"${'a'.repeat(MAX_LINE_BYTES)}"}}`)).toMatchObject({ ok: false, reason: 'línea demasiado larga' })
  })
})

describe('readingsOf', () => {
  it('una o varias lecturas; descarta inválidas', () => {
    expect(readingsOf({ sensor: 't', value: 1, unit: 'C' })).toEqual([{ sensor: 't', value: 1, unit: 'C' }])
    expect(
      readingsOf({ readings: [{ sensor: 'a', value: 1 }, { sensor: 'b', value: Number.NaN }, { sensor: 'c d', value: 2 }, { sensor: 'e', value: '3' }] }),
    ).toEqual([{ sensor: 'a', value: 1, unit: '' }])
  })
})

describe('LineSplitter', () => {
  it('reconstruye líneas fragmentadas y CRLF', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":')).toEqual([])
    expect(s.push('1}\r\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}'])
    expect(s.push(':3}\n')).toEqual(['{"c":3}'])
  })
  it('descarta una línea gigante sin crecer en memoria y se recupera', () => {
    const s = new LineSplitter()
    s.push('x'.repeat(MAX_LINE_BYTES * 3))
    expect(s.push('resto de la línea mala\n{"ok":1}\n')).toEqual(['{"ok":1}'])
  })
})

describe('RateLimiter', () => {
  it('limita por segundo', () => {
    const r = new RateLimiter(3)
    expect([0, 1, 2, 3].map(() => r.allow(1000))).toEqual([true, true, true, false])
    expect(r.allow(2001)).toBe(true)
  })
})

describe('chipName', () => {
  it('identifica chips comunes', () => {
    expect(chipName('303a', '1001')).toBe('ESP32 (USB nativo)')
    expect(chipName('1a86', '7523')).toBe('CH340')
    expect(chipName(null, null)).toBe('?:?')
  })
})
