/**
 * Protocolo UBX de u-blox, lo justo para la «ayuda sin Internet» al receptor (A-GPS local):
 *   - MON-VER (sondeo): saber si el receptor es un u-blox antes de enviarle nada más.
 *   - AID-INI: hora (solo si el reloj es fiable) y última posición conocida → arranque mucho más rápido.
 *   - AID-EPH / AID-HUI: efemérides e ionosfera/UTC que el propio receptor descargó de los satélites; se guardan
 *     mientras tiene fijación y se le devuelven al reconectarlo (sin pila, las pierde al desenchufarlo).
 * Los mensajes AID existen en u-blox 6, 7 y 8 (en M8 como «legacy»). Si un receptor no los admite, los ignora.
 */

export const UBX_SYNC1 = 0xb5
export const UBX_SYNC2 = 0x62

export const CLS_AID = 0x0b
export const ID_AID_INI = 0x01
export const ID_AID_HUI = 0x02
export const ID_AID_EPH = 0x31
export const CLS_MON = 0x0a
export const ID_MON_VER = 0x04

/** Efemérides: dejan de ser útiles a las ~4 h (el receptor las descarta solo si son viejas, pero no se arriesga). */
export const EPH_MAX_AGE_MS = 4 * 3600_000
/** Ionosfera/UTC: cambian muy despacio. */
export const HUI_MAX_AGE_MS = 7 * 24 * 3600_000

/** GPS empieza el 6-1-1980; desde 2017 va 18 s por delante de UTC (no hay segundos intercalares previstos). */
const GPS_EPOCH_MS = 315_964_800_000
const GPS_LEAP_S = 18
const WEEK_MS = 604_800_000

export interface UbxFrame {
  cls: number
  id: number
  payload: Buffer
}

export function checksum(body: Uint8Array): [number, number] {
  let a = 0
  let b = 0
  for (const x of body) {
    a = (a + x) & 0xff
    b = (b + a) & 0xff
  }
  return [a, b]
}

export function frame(cls: number, id: number, payload: Uint8Array = new Uint8Array()): Buffer {
  const out = Buffer.alloc(8 + payload.length)
  out[0] = UBX_SYNC1
  out[1] = UBX_SYNC2
  out[2] = cls
  out[3] = id
  out.writeUInt16LE(payload.length, 4)
  Buffer.from(payload).copy(out, 6)
  const [a, b] = checksum(out.subarray(2, 6 + payload.length))
  out[6 + payload.length] = a
  out[7 + payload.length] = b
  return out
}

export const pollMonVer = (): Buffer => frame(CLS_MON, ID_MON_VER)
export const pollAidEph = (): Buffer => frame(CLS_AID, ID_AID_EPH)
export const pollAidHui = (): Buffer => frame(CLS_AID, ID_AID_HUI)

/** Hora UTC (ms Unix) → semana GPS y ms de la semana. */
export function gpsTime(unixMs: number): { week: number; towMs: number } {
  const g = unixMs - GPS_EPOCH_MS + GPS_LEAP_S * 1000
  return { week: Math.floor(g / WEEK_MS), towMs: g % WEEK_MS }
}

export interface AidPosition {
  lat: number
  lon: number
  /** Altitud (m); 0 si no se conoce (el receptor la corrige). */
  alt: number
  /** Incertidumbre que se declara (m). */
  accuracyM: number
}

/**
 * AID-INI con posición (lat/lon/alt) y, si `timeMs` no es null, hora con su incertidumbre. Sin posición ni hora →
 * null (no hay nada que enviar).
 */
export function aidIni(pos: AidPosition | null, timeMs: number | null, timeAccMs = 10_000): Buffer | null {
  if (!pos && timeMs === null) return null
  const p = Buffer.alloc(48)
  let flags = 0
  if (pos) {
    p.writeInt32LE(Math.round(pos.lat * 1e7), 0)
    p.writeInt32LE(Math.round(pos.lon * 1e7), 4)
    p.writeInt32LE(Math.round(pos.alt * 100), 8)
    p.writeUInt32LE(Math.min(0xffffffff, Math.round(pos.accuracyM * 100)), 12)
    flags |= 0x01 | 0x20 // posición válida, en lat/lon/alt
  }
  if (timeMs !== null) {
    const t = gpsTime(timeMs)
    p.writeUInt16LE(t.week, 18)
    p.writeUInt32LE(t.towMs, 20)
    p.writeUInt32LE(timeAccMs, 28)
    flags |= 0x02 // hora válida
  }
  p.writeUInt32LE(flags, 44)
  return frame(CLS_AID, ID_AID_INI, p)
}

/** AID-EPH con datos (104 bytes): el satélite tiene efemérides; las de 8 bytes son «sin datos». */
export const isUsefulEph = (f: UbxFrame): boolean => f.cls === CLS_AID && f.id === ID_AID_EPH && f.payload.length === 104
export const isHui = (f: UbxFrame): boolean => f.cls === CLS_AID && f.id === ID_AID_HUI && f.payload.length === 72

/** Extrae tramas UBX válidas de un flujo binario mezclado con NMEA. Guarda el resto incompleto para la próxima. */
export class UbxScanner {
  private buf = Buffer.alloc(0)

  push(chunk: Uint8Array): UbxFrame[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const out: UbxFrame[] = []
    let i = 0
    while (i + 8 <= this.buf.length) {
      if (this.buf[i] !== UBX_SYNC1 || this.buf[i + 1] !== UBX_SYNC2) {
        i++
        continue
      }
      const len = this.buf.readUInt16LE(i + 4)
      if (len > 1024) {
        i += 2
        continue
      }
      if (i + 8 + len > this.buf.length) break // incompleta: esperar más datos
      const [a, b] = checksum(this.buf.subarray(i + 2, i + 6 + len))
      if (a === this.buf[i + 6 + len] && b === this.buf[i + 7 + len]) {
        out.push({ cls: this.buf[i + 2] as number, id: this.buf[i + 3] as number, payload: Buffer.from(this.buf.subarray(i + 6, i + 6 + len)) })
        i += 8 + len
      } else i += 2
    }
    // Se conserva solo lo que puede ser el principio de una trama (máx. 2 KB).
    this.buf = this.buf.subarray(i)
    if (this.buf.length > 2048) this.buf = this.buf.subarray(this.buf.length - 2048)
    return out
  }
}

/** Tramas guardadas (concatenadas) → lista. */
export function parseFrames(data: Uint8Array): UbxFrame[] {
  return new UbxScanner().push(data)
}

export function encodeFrames(frames: UbxFrame[]): Buffer {
  return Buffer.concat(frames.map((f) => frame(f.cls, f.id, f.payload)))
}
