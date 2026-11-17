import { describe, expect, it } from 'vitest'
import { platformCaps } from '../app/utils/platform'

describe('platformCaps', () => {
  it('Pi / Linux con systemd: todo visible', () => {
    const c = platformCaps({ android: false, portable: false, os: null })
    expect(c.system).toBe(true)
    expect(c.linuxHost).toBe(true)
    expect(c.piHardware && c.systemd && c.kiosk && c.wifiControl && c.clockControl && c.gpioGps).toBe(true)
    expect(c.cpuProbe).toBe('yes')
    expect(c.displayProbe && c.inputProbe && c.onScreenKeyboard && c.hostname).toBe(true)
    expect(c.deviceCompass).toBe(false)
  })

  it('Android: sin hardware de la Pi, systemd, quiosco, pantallas ni teclado propio', () => {
    const c = platformCaps({ android: true, portable: true, os: 'android' })
    expect(c.portable).toBe(true)
    expect(c.linuxHost).toBe(false)
    expect(c.piHardware || c.systemd || c.kiosk || c.wifiControl || c.clockControl || c.gpioGps).toBe(false)
    expect(c.displayProbe || c.inputProbe || c.onScreenKeyboard || c.hostname).toBe(false)
    expect(c.cpuProbe).toBe('maybe')
    expect(c.deviceCompass).toBe(true)
  })

  it('Android implica portable aunque falte la bandera', () => {
    expect(platformCaps({ android: true, portable: false, os: null }).portable).toBe(true)
  })

  it('Portable en Windows o macOS: sin CPU, pantallas ni entrada', () => {
    for (const os of ['win32', 'darwin']) {
      const c = platformCaps({ android: false, portable: true, os })
      expect(c.linuxHost).toBe(false)
      expect(c.cpuProbe).toBe('no')
      expect(c.displayProbe || c.inputProbe || c.systemd || c.kiosk).toBe(false)
      expect(c.onScreenKeyboard).toBe(true)
    }
  })

  it('Portable en Linux: lee /proc y /sys, pero no controla el equipo anfitrión', () => {
    const c = platformCaps({ android: false, portable: true, os: 'linux' })
    expect(c.linuxHost && c.displayProbe && c.inputProbe).toBe(true)
    expect(c.cpuProbe).toBe('yes')
    expect(c.piHardware || c.systemd || c.kiosk || c.wifiControl || c.clockControl).toBe(false)
  })

  it('Portable sin lectura todavía: no promete medidas de Linux', () => {
    const c = platformCaps({ android: false, portable: true, os: null })
    expect(c.linuxHost).toBe(false)
    expect(c.cpuProbe).toBe('no')
  })
})
