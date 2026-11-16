import { describe, expect, it } from 'vitest'
import { parsePmsetBatt, parseW32tmLeap, parseWinPowerStatus } from '../src/parsers.ts'

describe('equipo anfitrión (portable)', () => {
  it('Windows PowerStatus', () => {
    expect(parseWinPowerStatus('{"PowerLineStatus":1,"BatteryChargeStatus":1,"BatteryLifePercent":0.78}')).toEqual({ percent: 78, present: true, noBattery: false })
    expect(parseWinPowerStatus('{"PowerLineStatus":0,"BatteryChargeStatus":2,"BatteryLifePercent":0.12}')).toMatchObject({ percent: 12, present: false })
    // Sobremesa: sin batería; el porcentaje (1) no es real.
    expect(parseWinPowerStatus('{"PowerLineStatus":1,"BatteryChargeStatus":128,"BatteryLifePercent":1}')).toEqual({ percent: null, present: true, noBattery: true })
    expect(parseWinPowerStatus('{"PowerLineStatus":255,"BatteryChargeStatus":255,"BatteryLifePercent":2.55}')).toEqual({ percent: null, present: null, noBattery: false })
    expect(parseWinPowerStatus('basura')).toEqual({ percent: null, present: null, noBattery: false })
  })
  it('macOS pmset', () => {
    expect(parsePmsetBatt("Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t87%; charging; 0:45 remaining present: true")).toEqual({ percent: 87, present: true })
    expect(parsePmsetBatt("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t41%; discharging;")).toEqual({ percent: 41, present: false })
    expect(parsePmsetBatt("Now drawing from 'AC Power'")).toEqual({ percent: null, present: true })
  })
  it('w32tm en cualquier idioma', () => {
    expect(parseW32tmLeap('Indicador de salto: 3(sin sincronizar)\nCapa: 0')).toBe(false)
    expect(parseW32tmLeap('Leap Indicator: 0(no warning)\nStratum: 4')).toBe(true)
    expect(parseW32tmLeap('El servicio no se ha iniciado.')).toBeNull()
  })
})
