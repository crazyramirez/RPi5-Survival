import { describe, expect, it } from 'vitest'
import { collectStatus, createStatusCache } from '../src/status.ts'
import { loadConfig, isLoopbackHost } from '../src/config.ts'

describe('collectStatus (plataforma actual)', () => {
  it('devuelve todos los bloques con estados válidos, sin lanzar', async () => {
    const status = await collectStatus(['/'])
    const probes = [
      status.uptime, status.cpu, status.fan, status.memory, status.storage, status.power,
      status.battery, status.rtc, status.time, status.network, status.display, status.input,
      status.serial, status.software, status.services, status.sdHealth,
    ]
    for (const p of probes) {
      expect(['ok', 'unavailable', 'error']).toContain(p.state)
      if (p.state !== 'ok') expect(p.reason.length).toBeGreaterThan(0)
    }
    expect(Date.parse(status.collectedAt)).not.toBeNaN()
  })

  it('la batería nunca es "ok" sin un medidor del kernel', async () => {
    const status = await collectStatus(['/'])
    if (status.battery.state === 'ok') {
      expect(status.battery.value.percent).toBeGreaterThanOrEqual(0)
      expect(status.battery.value.percent).toBeLessThanOrEqual(100)
    } else {
      expect(status.battery.reason).toMatch(/medidor|Linux/)
    }
  })

})

describe('createStatusCache', () => {
  it('deduplica peticiones concurrentes', async () => {
    const get = createStatusCache(['/'], 60_000)
    const [a, b] = await Promise.all([get(), get()])
    expect(a).toBe(b)
    expect(await get()).toBe(a)
  })
})

describe('config', () => {
  it('por defecto escucha solo en loopback', () => {
    const c = loadConfig({})
    expect(c.host).toBe('127.0.0.1')
    expect(isLoopbackHost(c.host)).toBe(true)
    expect(c.port).toBe(8781)
  })
  it('rechaza valores fuera de rango', () => {
    const c = loadConfig({ DEVICE_API_PORT: '99999', DEVICE_API_CACHE_SECONDS: '-1' })
    expect(c.port).toBe(8781)
    expect(c.cacheSeconds).toBe(5)
  })
  it('detecta hosts no loopback', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.10')).toBe(false)
  })
})
