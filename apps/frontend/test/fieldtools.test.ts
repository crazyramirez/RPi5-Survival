import { describe, expect, it } from 'vitest'
import { convert, fromMorse, morseTimeline, rations, spell, toMorse, unitsOf } from '../app/utils/fieldtools'

describe('conversión de unidades', () => {
  it('longitud, masa, volumen, velocidad y presión con factores exactos', () => {
    expect(convert(1, 'length', 'mi', 'km')).toBeCloseTo(1.609344, 9)
    expect(convert(1, 'length', 'nmi', 'm')).toBe(1852)
    expect(convert(10, 'mass', 'kg', 'lb')).toBeCloseTo(22.0462, 4)
    expect(convert(1, 'volume', 'gal (US)', 'L')).toBeCloseTo(3.785411784, 9)
    expect(convert(100, 'speed', 'km/h', 'kn')).toBeCloseTo(53.9957, 4)
    expect(convert(1013.25, 'pressure', 'hPa', 'atm')).toBeCloseTo(1, 9)
    expect(convert(1, 'pressure', 'atm', 'mmHg')).toBeCloseTo(760, 3)
  })

  it('temperatura, sin bajar del cero absoluto', () => {
    expect(convert(100, 'temperature', '°C', '°F')).toBeCloseTo(212, 9)
    expect(convert(-40, 'temperature', '°F', '°C')).toBeCloseTo(-40, 9)
    expect(convert(0, 'temperature', 'K', '°C')).toBeCloseTo(-273.15, 9)
    expect(convert(-300, 'temperature', '°C', 'K')).toBeNull()
  })

  it('unidades desconocidas o valores no numéricos: null', () => {
    expect(convert(1, 'length', 'm', 'parsec')).toBeNull()
    expect(convert(Number.NaN, 'length', 'm', 'km')).toBeNull()
    expect(unitsOf('temperature')).toEqual(['°C', '°F', 'K'])
  })
})

describe('Morse', () => {
  it('SOS, acentos y separación de palabras', () => {
    expect(toMorse('sos')).toBe('... --- ...')
    expect(toMorse('  Ayuda  aquí ')).toBe('.- -.-- ..- -.. .- / .- --.- ..- ..')
    expect(fromMorse('... --- ... / .- --.- ..- ..')).toBe('SOS AQUI')
    expect(fromMorse('...---...')).toBe('?')
  })

  it('tiempos UIT: punto 1, raya 3, entre señales 1, entre letras 3, entre palabras 7', () => {
    expect(morseTimeline('.- / -', 100)).toEqual([[100, 100], [300, 700], [300, 700]])
    expect(morseTimeline('... ---', 200).map(([on]) => on)).toEqual([200, 200, 200, 600, 600, 600])
  })
})

describe('alfabeto fonético', () => {
  it('deletrea letras y cifras; ignora espacios', () => {
    expect(spell('Ñu 9')).toEqual(['November', 'Uniform', 'Niner'])
  })
})

describe('agua y comida (Esfera)', () => {
  it('4 personas, 3 días', () => {
    expect(rations(4, 3)).toEqual({ drinkL: 36, basicL: 180, kcal: 25_200 })
  })
  it('valores no válidos: null', () => {
    expect(rations(0, 3)).toBeNull()
    expect(rations(2, -1)).toBeNull()
    expect(rations(Number.NaN, 1)).toBeNull()
  })
})
