import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aidIni, EPH_MAX_AGE_MS, encodeFrames, HUI_MAX_AGE_MS, isHui, isUsefulEph, parseFrames, type AidPosition, type UbxFrame } from './ubx.ts'

/**
 * Datos para ayudar a un receptor u-blox a fijar antes sin Internet (ubx.ts): última posición, efemérides e
 * ionosfera/UTC que el propio receptor descargó. Todo son datos medidos por un receptor real; nada se inventa.
 */

/** Antes de esta fecha el reloj del equipo no es creíble (sin RTC, arranca en 1970/2000): no se envía la hora. */
export const MIN_TRUSTED_CLOCK_MS = Date.UTC(2026, 0, 1)

interface Meta {
  position: { lat: number; lon: number; alt: number | null; at: number } | null
  ephAt: number | null
  huiAt: number | null
}

export class AidStore {
  private readonly dir: string
  private meta: Meta = { position: null, ephAt: null, huiAt: null }
  private lastPositionSave = 0

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    try {
      const m = JSON.parse(readFileSync(join(dir, 'aid.json'), 'utf8')) as Partial<Meta>
      this.meta = { position: m.position ?? null, ephAt: m.ephAt ?? null, huiAt: m.huiAt ?? null }
    } catch {
      // sin datos guardados todavía
    }
  }

  private write(name: string, data: string | Uint8Array): void {
    const p = join(this.dir, name)
    writeFileSync(`${p}.tmp`, data)
    renameSync(`${p}.tmp`, p)
  }

  /** Posición con fijación de cualquier receptor (como mucho una escritura por minuto). */
  savePosition(lat: number, lon: number, alt: number | null, now = Date.now()): void {
    if (now - this.lastPositionSave < 60_000) return
    this.lastPositionSave = now
    this.meta.position = { lat, lon, alt, at: now }
    this.write('aid.json', JSON.stringify(this.meta))
  }

  /** Guarda lo que respondió el receptor a los sondeos AID-EPH/AID-HUI. Devuelve cuántas efemérides útiles. */
  saveFrames(frames: UbxFrame[], now = Date.now()): number {
    const eph = frames.filter(isUsefulEph)
    const hui = frames.filter(isHui).slice(-1)
    if (eph.length >= 4) {
      this.write('aid-eph.ubx', encodeFrames(eph))
      this.meta.ephAt = now
    }
    if (hui.length) {
      this.write('aid-hui.ubx', encodeFrames(hui))
      this.meta.huiAt = now
    }
    if (eph.length >= 4 || hui.length) this.write('aid.json', JSON.stringify(this.meta))
    return eph.length
  }

  private read(name: string): UbxFrame[] {
    try {
      return parseFrames(readFileSync(join(this.dir, name)))
    } catch {
      return []
    }
  }

  /**
   * Mensajes para un receptor recién conectado, en orden: AID-INI (posición y hora), AID-HUI y AID-EPH si aún
   * valen. La posición se declara con una incertidumbre que crece con su antigüedad (pudo moverse).
   */
  messages(now = Date.now()): Buffer[] {
    const out: Buffer[] = []
    const p = this.meta.position
    let pos: AidPosition | null = null
    if (p) {
      const ageH = (now - p.at) / 3600_000
      pos = { lat: p.lat, lon: p.lon, alt: p.alt ?? 0, accuracyM: ageH < 1 ? 5_000 : ageH < 24 ? 50_000 : 300_000 }
      if (p.alt === null) pos.accuracyM = Math.max(pos.accuracyM, 10_000)
    }
    const clockOk = now >= MIN_TRUSTED_CLOCK_MS
    const ini = aidIni(pos, clockOk ? now : null)
    if (ini) out.push(ini)
    // Sin hora fiable las efemérides no sirven (el receptor no sabría qué parte usar).
    if (!clockOk) return out
    if (this.meta.huiAt && now - this.meta.huiAt < HUI_MAX_AGE_MS) out.push(...encodeAll(this.read('aid-hui.ubx')))
    if (this.meta.ephAt && now - this.meta.ephAt < EPH_MAX_AGE_MS) out.push(...encodeAll(this.read('aid-eph.ubx')))
    return out
  }
}

const encodeAll = (frames: UbxFrame[]): Buffer[] => frames.map((f) => encodeFrames([f]))
