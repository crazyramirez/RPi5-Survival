/**
 * Receptor GNSS por USB (NMEA 0183) → mensajes con forma de gpsd (TPV/SKY), para que el servicio de
 * navegación funcione igual que en la Pi (ADR 0016). Solo frases con checksum válido. Sin inventar:
 * el error horizontal no se deriva del HDOP (necesitaría el UERE del receptor), se deja sin dato.
 */

export function checksumOk(line: string): boolean {
  const m = /^\$([^*]+)\*([0-9A-Fa-f]{2})$/.exec(line.trim())
  if (!m) return false
  let x = 0
  for (const ch of m[1] as string) x ^= ch.charCodeAt(0)
  return x === Number.parseInt(m[2] as string, 16)
}

/** "4023.1234","N" → 40.38539 */
export function coord(v: string | undefined, hemi: string | undefined): number | null {
  if (!v || !hemi) return null
  const dot = v.indexOf('.')
  if (dot < 3) return null
  const deg = Number(v.slice(0, dot - 2))
  const min = Number(v.slice(dot - 2))
  if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return null
  const d = deg + min / 60
  return hemi === 'S' || hemi === 'W' ? -d : d
}

const num = (v: string | undefined): number | null => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export interface NmeaState {
  /** Fecha (de RMC) y hora (de cualquier frase) en UTC. */
  date: string | null
  time: string | null
  lat: number | null
  lon: number | null
  altMSL: number | null
  speed: number | null
  track: number | null
  /** 1 sin fijación, 2 = 2D, 3 = 3D (convenio de gpsd). */
  mode: number
  quality: number | null
  uSat: number | null
  nSat: number | null
  satsByTalker: Record<string, number>
  updatedAt: number | null
}

export function emptyNmea(): NmeaState {
  return { date: null, time: null, lat: null, lon: null, altMSL: null, speed: null, track: null, mode: 1, quality: null, uSat: null, nSat: null, satsByTalker: {}, updatedAt: null }
}

const hhmmss = (v: string | undefined): string | null => {
  const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(v ?? '')
  return m ? `${m[1]}:${m[2]}:${(m[3] as string).padStart(2, '0')}` : null
}

/** Aplica una frase NMEA; devuelve true si cambió algo relevante para TPV/SKY. */
export function applyNmea(st: NmeaState, line: string, now = Date.now()): boolean {
  if (!checksumOk(line)) return false
  const body = line.trim().slice(1, line.trim().indexOf('*'))
  const f = body.split(',')
  const type = (f[0] ?? '').slice(2)
  const talker = (f[0] ?? '').slice(0, 2)
  switch (type) {
    case 'GGA': {
      st.time = hhmmss(f[1]) ?? st.time
      st.quality = num(f[6])
      if (st.quality === 0) {
        st.lat = st.lon = st.altMSL = null
        st.mode = 1
      } else {
        st.lat = coord(f[2], f[3])
        st.lon = coord(f[4], f[5])
        st.altMSL = num(f[9])
        if (st.mode < 2) st.mode = st.altMSL !== null ? 3 : 2
      }
      st.uSat = num(f[7])
      break
    }
    case 'RMC': {
      st.time = hhmmss(f[1]) ?? st.time
      const d = /^(\d{2})(\d{2})(\d{2})$/.exec(f[9] ?? '')
      if (d) st.date = `20${d[3]}-${d[2]}-${d[1]}`
      if (f[2] === 'A') {
        st.lat = coord(f[3], f[4])
        st.lon = coord(f[5], f[6])
        const knots = num(f[7])
        st.speed = knots === null ? null : Math.round(knots * 0.514444 * 1000) / 1000
        st.track = num(f[8])
      } else {
        st.mode = 1
        st.speed = st.track = null
      }
      break
    }
    case 'GSA': {
      const mode = num(f[2])
      if (mode !== null && mode >= 1 && mode <= 3) st.mode = mode
      break
    }
    case 'GSV': {
      const n = num(f[3])
      if (n !== null) {
        st.satsByTalker[talker] = n
        st.nSat = Object.values(st.satsByTalker).reduce((a, b) => a + b, 0)
      }
      break
    }
    default:
      return false
  }
  st.updatedAt = now
  return true
}

/** Estado → mensaje TPV de gpsd. */
export function toTpv(st: NmeaState, device: string): Record<string, unknown> {
  const tpv: Record<string, unknown> = { class: 'TPV', device, mode: st.mode }
  if (st.date && st.time) {
    const [h, m, sec] = st.time.split(':')
    tpv.time = `${st.date}T${h}:${m}:${Number(sec).toFixed(3).padStart(6, '0')}Z`
  }
  if (st.mode >= 2 && st.lat !== null && st.lon !== null) {
    tpv.lat = st.lat
    tpv.lon = st.lon
    if (st.speed !== null) tpv.speed = st.speed
    if (st.track !== null) tpv.track = st.track
  }
  if (st.mode >= 3 && st.altMSL !== null) tpv.altMSL = st.altMSL
  return tpv
}

export function toSky(st: NmeaState, device: string): Record<string, unknown> {
  const sky: Record<string, unknown> = { class: 'SKY', device }
  if (st.uSat !== null) sky.uSat = st.uSat
  if (st.nSat !== null) sky.nSat = st.nSat
  return sky
}

/** ¿Parece un flujo NMEA? (al menos dos frases con checksum válido). Para detectar receptores. */
export function looksLikeNmea(text: string): boolean {
  return text.split(/\r?\n/).filter((l) => l.startsWith('$') && checksumOk(l)).length >= 2
}
