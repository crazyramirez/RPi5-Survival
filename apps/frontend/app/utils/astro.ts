/**
 * Sol y Luna calculados en el equipo (sin Internet), con las fórmulas de la NOAA para el Sol
 * (precisión de ~1 min entre ±72° de latitud) y la edad media de la Luna para su fase.
 * Es un cálculo, no una medida: la UI lo presenta como tal y depende de la hora del equipo.
 */

const rad = (d: number): number => (d * Math.PI) / 180
const deg = (r: number): number => (r * 180) / Math.PI
const DAY_MS = 86_400_000

/** Día juliano de una fecha (UTC). */
export function julianDay(date: Date): number {
  return date.getTime() / DAY_MS + 2_440_587.5
}

interface SolarPosition {
  /** Declinación (°). */
  decl: number
  /** Ecuación del tiempo (min). */
  eqTime: number
}

function solarPosition(jd: number): SolarPosition {
  const t = (jd - 2_451_545) / 36_525
  const l0 = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289
  const trueLong = l0 + c
  const omega = 125.04 - 1934.136 * t
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega))
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(rad(omega))
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))))
  const y = Math.tan(rad(eps / 2)) ** 2
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(l0)) -
        2 * e * Math.sin(rad(m)) +
        4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
        0.5 * y * y * Math.sin(4 * rad(l0)) -
        1.25 * e * e * Math.sin(2 * rad(m)),
    )
  return { decl, eqTime }
}

export interface SunTimes {
  /** Mediodía solar. */
  noon: Date
  /** Salida y puesta (centro del disco a −0,833°, con refracción); null si ese día no hay (sol de medianoche o noche polar). */
  sunrise: Date | null
  sunset: Date | null
  /** Crepúsculo civil (−6°): hay luz para moverse sin linterna. */
  dawn: Date | null
  dusk: Date | null
  /** 'day': el Sol no se pone; 'night': no sale; null: normal. */
  polar: 'day' | 'night' | null
  /** Horas de luz entre salida y puesta. */
  daylightHours: number
}

/** Hora (UTC) a la que el Sol pasa por la altura `alt` (°) antes (−1) o después (+1) del mediodía. */
function timeAtAltitude(dayStartUtc: number, lat: number, lon: number, alt: number, sign: -1 | 1): Date | null {
  // Dos pasadas: la segunda recalcula la posición del Sol en la hora aproximada.
  let minutes = 720 - 4 * lon
  for (let i = 0; i < 2; i++) {
    const { decl, eqTime } = solarPosition(julianDay(new Date(dayStartUtc + minutes * 60_000)))
    const cosH = (Math.sin(rad(alt)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)))
    if (cosH > 1 || cosH < -1) return null
    const ha = deg(Math.acos(cosH))
    minutes = 720 - 4 * (lon + sign * -ha) - eqTime
  }
  return new Date(dayStartUtc + minutes * 60_000)
}

/**
 * Horas del Sol del día civil (UTC) que contiene `date` en (lat, lon).
 * Para mostrarlas en hora local, la UI usa la zona horaria del equipo.
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const dayStartUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const { eqTime, decl } = solarPosition(julianDay(new Date(dayStartUtc + (720 - 4 * lon) * 60_000)))
  const noon = new Date(dayStartUtc + (720 - 4 * lon - eqTime) * 60_000)
  const sunrise = timeAtAltitude(dayStartUtc, lat, lon, -0.833, -1)
  const sunset = timeAtAltitude(dayStartUtc, lat, lon, -0.833, 1)
  let polar: SunTimes['polar'] = null
  if (!sunrise || !sunset) {
    // Sin cruce del horizonte: de día si a mediodía el Sol está por encima.
    const noonAlt = 90 - Math.abs(lat - decl)
    polar = noonAlt > 0 ? 'day' : 'night'
  }
  return {
    noon,
    sunrise,
    sunset,
    dawn: timeAtAltitude(dayStartUtc, lat, lon, -6, -1),
    dusk: timeAtAltitude(dayStartUtc, lat, lon, -6, 1),
    polar,
    daylightHours: sunrise && sunset ? (sunset.getTime() - sunrise.getTime()) / 3_600_000 : polar === 'day' ? 24 : 0,
  }
}

/** Mes sinódico medio (días) y una luna nueva de referencia (2000-01-06 18:14 UTC). */
const SYNODIC = 29.530588853
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14)

export type MoonPhaseName = 'new' | 'waxingCrescent' | 'firstQuarter' | 'waxingGibbous' | 'full' | 'waningGibbous' | 'lastQuarter' | 'waningCrescent'

export interface MoonInfo {
  /** Edad en días desde la luna nueva (0–29,5). */
  age: number
  /** 0 nueva → 0,5 llena → 1 nueva. */
  phase: number
  /** Fracción iluminada (0–1). */
  illumination: number
  name: MoonPhaseName
  /** Próxima luna llena y nueva (estimación media, ±0,5 días). */
  nextFull: Date
  nextNew: Date
}

/** Fase de la Luna por su edad media (error típico < 1 día: suficiente para planificar noches con luz). */
export function moonInfo(date: Date): MoonInfo {
  const days = (date.getTime() - NEW_MOON_REF) / DAY_MS
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC
  const phase = age / SYNODIC
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const names: MoonPhaseName[] = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent']
  const name = names[Math.floor(phase * 8 + 0.5) % 8]!
  const toFull = ((0.5 - phase + 1) % 1) * SYNODIC
  const toNew = ((1 - phase) % 1) * SYNODIC || SYNODIC
  return {
    age,
    phase,
    illumination,
    name,
    nextFull: new Date(date.getTime() + (toFull || SYNODIC) * DAY_MS),
    nextNew: new Date(date.getTime() + toNew * DAY_MS),
  }
}
