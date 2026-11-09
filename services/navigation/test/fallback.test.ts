import { describe, expect, it } from 'vitest'
import { meshFallback } from '../src/fallback.ts'

describe('posición de respaldo del nodo LoRa', () => {
  const now = Date.parse('2026-11-09T01:00:00Z')

  it('sin servicio, sin conexión o sin posición: no disponible con motivo', () => {
    expect(meshFallback(null, now)).toEqual({ state: 'unavailable', reason: 'Malla LoRa no disponible' })
    expect(meshFallback({ connected: false }, now).state).toBe('unavailable')
    expect(meshFallback({ connected: true, me: { id: '!1a2b3c4d', position: null } }, now)).toEqual({
      state: 'unavailable',
      reason: 'El nodo LoRa no informa posición',
    })
  })

  it('rechaza coordenadas imposibles en vez de mostrarlas', () => {
    expect(meshFallback({ connected: true, me: { position: { lat: 123, lon: 4 } } }, now).state).toBe('unavailable')
    expect(meshFallback({ connected: true, me: { position: { lat: '36', lon: -4 } } }, now).state).toBe('unavailable')
  })

  it('posición con antigüedad calculada con la hora de la Pi', () => {
    const r = meshFallback({ connected: true, me: { id: '!1a2b3c4d', position: { lat: 40.4167754, lon: -3.7037902, alt: 38, at: '2026-11-09T00:48:00Z' } } }, now)
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.value).toEqual({
      source: 'meshtastic',
      nodeId: '!1a2b3c4d',
      nodeName: null,
      remote: false,
      precisionM: null,
      latitude: 40.4167754,
      longitude: -3.7037902,
      altitudeM: 38,
      time: '2026-11-09T00:48:00Z',
      ageSeconds: 720,
      lastKnown: false,
    })
  })

  it('última posición conocida marcada como tal', () => {
    const r = meshFallback({ connected: true, me: { position: { lat: 1, lon: 2, at: '2026-11-09T00:00:00Z', cached: true } } }, now)
    expect(r.state === 'ok' && r.value.lastKnown).toBe(true)
  })

  it('sin hora de la posición: antigüedad desconocida (null), no cero', () => {
    const r = meshFallback({ connected: true, me: { position: { lat: 1, lon: 2, at: null } } }, now)
    expect(r.state === 'ok' && r.value.ageSeconds).toBeNull()
  })

  it('nodo seguido por radio: su posición, nombre y precisión; sin posición aún, se dice', () => {
    const me = { id: '!5e5e0001', position: null }
    const r = meshFallback(
      { connected: true, me, tracked: { id: '!1a2b3c4d', longName: 'Bolsillo', position: { lat: 36.5, lon: -4.8, at: '2026-11-09T00:59:00Z', precisionM: 2918 } } },
      now,
    )
    expect(r.state === 'ok' && r.value).toMatchObject({ nodeId: '!1a2b3c4d', nodeName: 'Bolsillo', remote: true, precisionM: 2918, ageSeconds: 60 })
    expect(meshFallback({ connected: true, me, tracked: { id: '!1a2b3c4d', position: null } }, now)).toEqual({
      state: 'unavailable',
      reason: 'El nodo seguido aún no ha enviado su posición',
    })
  })

  it('servicio antiguo sin `tracked`: usa el nodo propio', () => {
    const r = meshFallback({ connected: true, me: { id: '!1a2b3c4d', position: { lat: 1, lon: 2, at: null } } }, now)
    expect(r.state === 'ok' && r.value.remote).toBe(false)
  })
})
