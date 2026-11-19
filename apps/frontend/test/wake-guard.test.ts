import { describe, expect, it } from 'vitest'
import { createWakeGuard } from '../app/utils/wake-guard'

/** Un toque completo: pulsar, (mover), soltar y el clic que genera el navegador. Devuelve qué se descartó. */
function tap(g: ReturnType<typeof createWakeGuard>, at: number, move = false): boolean[] {
  return [
    g.input('start', at),
    g.input('click', at + 1), // touchstart
    ...(move ? [g.input('move', at + 40), g.input('click', at + 41)] : []),
    g.input('end', at + 80),
    g.input('click', at + 81), // touchend
    g.input('click', at + 120), // mousedown / mouseup / click
  ]
}

describe('primer toque con la pantalla apagada (wake-guard)', () => {
  it('con la pantalla encendida no descarta nada', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(600)
    expect(tap(g, 10_000)).toEqual([false, false, false, false, false])
    expect(tap(g, 500_000, true)).toEqual([false, false, false, false, false, false, false])
  })

  it('tras el tiempo de apagado, el gesto entero solo despierta; el siguiente pulsa', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(600)
    expect(tap(g, 600_000, true).every(Boolean)).toBe(true)
    expect(g.input('click', 600_700)).toBe(false) // pasado el margen tras soltar
    expect(tap(g, 601_000)).toEqual([false, false, false, false, false])
  })

  it('la actividad reinicia la cuenta (también mover el ratón)', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(600)
    tap(g, 400_000)
    expect(tap(g, 900_000)).toEqual([false, false, false, false, false])
    g.input('move', 1_600_000) // el ratón enciende la pantalla sin pulsar
    expect(g.input('start', 1_600_500)).toBe(false)
  })

  it('apagada a mano desde Sistema: el siguiente toque solo enciende', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(600)
    g.arm()
    expect(tap(g, 5_000).every(Boolean)).toBe(true)
    expect(g.input('start', 6_000)).toBe(false)
  })

  it('la tecla que enciende la pantalla no escribe', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(600)
    expect(g.input('key', 700_000)).toBe(true)
    expect(g.input('key', 700_100)).toBe(false)
  })

  it('sin apagado automático (0) solo actúa si se apagó a mano', () => {
    const g = createWakeGuard(0)
    g.setOffAfter(0)
    expect(g.input('start', 99_000_000)).toBe(false)
    g.input('end', 99_000_050)
    g.arm()
    expect(g.input('start', 99_001_000)).toBe(true)
  })
})
