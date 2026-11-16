/**
 * Herramientas de campo puras (sin estado ni red): conversión de unidades, Morse, alfabeto fonético
 * y cálculo de agua y comida según las normas mínimas del Manual Esfera.
 */

// ------------------------------------------------------------------ Unidades (factores exactos por definición)
export type UnitCategory = 'length' | 'mass' | 'volume' | 'temperature' | 'speed' | 'pressure'

/** Unidad: factor a la unidad base de la categoría (temperatura aparte). */
export const UNITS: Record<Exclude<UnitCategory, 'temperature'>, Record<string, number>> = {
  // base: metro
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, nmi: 1852, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  // base: kilogramo
  mass: { kg: 1, g: 0.001, t: 1000, lb: 0.45359237, oz: 0.028349523125 },
  // base: litro
  volume: { L: 1, mL: 0.001, 'm³': 1000, 'gal (US)': 3.785411784, 'gal (UK)': 4.54609, 'fl oz (US)': 0.0295735295625, 'qt (US)': 0.946352946 },
  // base: m/s
  speed: { 'km/h': 1 / 3.6, 'm/s': 1, mph: 0.44704, kn: 1852 / 3600 },
  // base: pascal
  pressure: { hPa: 100, kPa: 1000, bar: 100_000, atm: 101_325, mmHg: 133.322387415, inHg: 3386.389, psi: 6894.757293168 },
}
export const TEMPERATURE_UNITS = ['°C', '°F', 'K'] as const

export function unitsOf(cat: UnitCategory): string[] {
  return cat === 'temperature' ? [...TEMPERATURE_UNITS] : Object.keys(UNITS[cat])
}

export function convert(value: number, cat: UnitCategory, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null
  if (cat === 'temperature') {
    const c = from === '°C' ? value : from === '°F' ? ((value - 32) * 5) / 9 : from === 'K' ? value - 273.15 : Number.NaN
    if (Number.isNaN(c) || c < -273.15) return null
    return to === '°C' ? c : to === '°F' ? (c * 9) / 5 + 32 : to === 'K' ? c + 273.15 : null
  }
  const f = UNITS[cat][from]
  const g = UNITS[cat][to]
  return f === undefined || g === undefined ? null : (value * f) / g
}

// ------------------------------------------------------------------ Morse (Recomendación UIT-R M.1677-1)
export const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '/': '-..-.', '(': '-.--.', ')': '-.--.-', ':': '---...', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '"': '.-..-.', '@': '.--.-.',
}

/** Texto → Morse: letras separadas por espacio y palabras por « / ». Acentos y Ñ: letra base (UIT no los define). */
export function toMorse(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].map((c) => MORSE[c]).filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' / ')
}

/** Morse → texto (lo desconocido como «?»). */
export function fromMorse(code: string): string {
  const rev = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]))
  return code
    .trim()
    .split(/\s*\/\s*|\s{3,}/)
    .map((w) => w.split(/\s+/).filter(Boolean).map((s) => rev[s] ?? '?').join(''))
    .join(' ')
}

/**
 * Secuencia de encendido/apagado (ms) para emitir Morse con luz. Unidad: duración del punto.
 * Raya = 3, separación entre señales = 1, entre letras = 3, entre palabras = 7 (UIT).
 * Devuelve pares [encendido, apagado].
 */
export function morseTimeline(code: string, unitMs: number): [number, number][] {
  const out: [number, number][] = []
  const words = code.split(' / ')
  words.forEach((w) => {
    const letters = w.split(' ')
    letters.forEach((l, li) => {
      ;[...l].forEach((s, si) => {
        const on = (s === '-' ? 3 : 1) * unitMs
        const lastInLetter = si === l.length - 1
        const lastLetter = li === letters.length - 1
        // Tras la última señal del mensaje, también 7: pausa antes de repetirlo.
        const gap = !lastInLetter ? 1 : !lastLetter ? 3 : 7
        out.push([on, gap * unitMs])
      })
    })
  })
  return out
}

// ------------------------------------------------------------------ Alfabeto fonético (OACI / OTAN)
export const NATO: Record<string, string> = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo',
  L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform',
  V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Niner',
}

/** Deletreo: una palabra por carácter (lo que no está en el alfabeto, tal cual). */
export function spell(text: string): string[] {
  return [...text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()].filter((c) => c.trim()).map((c) => NATO[c] ?? c)
}

// ------------------------------------------------------------------ Agua y comida (Manual Esfera, 2018)
/** Normas mínimas del Manual Esfera 2018 (WASH 2.1 y Nutrición). */
export const SPHERE = {
  /** Agua para beber y cocinar, por persona y día (L): supervivencia, según clima y fisiología (2,5–3). */
  drinkLPerDay: 3,
  /** Agua total para beber, cocinar e higiene personal, por persona y día (L): mínimo de emergencia. */
  basicLPerDay: 15,
  /** Energía por persona y día (kcal). */
  kcalPerDay: 2100,
} as const

export interface RationPlan {
  drinkL: number
  basicL: number
  kcal: number
}

export function rations(people: number, days: number): RationPlan | null {
  if (!Number.isFinite(people) || !Number.isFinite(days) || people <= 0 || days <= 0 || people > 10_000 || days > 3650) return null
  const pd = people * days
  return { drinkL: pd * SPHERE.drinkLPerDay, basicL: pd * SPHERE.basicLPerDay, kcal: pd * SPHERE.kcalPerDay }
}
