/**
 * Qué puede hacer o medir cada forma de Survivelia OS (Pi/Linux con systemd, portable en Windows/macOS/Linux y app
 * Android). Lo que la plataforma NO permite nunca se oculta de la interfaz; lo que sí permite pero no se puede medir
 * ahora sigue saliendo como «no disponible» (Probe honesto, ADR 0003). Todas las reglas viven aquí.
 */
export interface PlatformInput {
  /** App Android (ADR 0020). Implica `portable`. */
  android: boolean
  /** Versión portable (ADR 0014) o app Android. */
  portable: boolean
  /** `process.platform` del equipo que mide (DeviceStatus.platform.os); null mientras no hay lectura. */
  os: string | null
}

export interface PlatformCaps {
  android: boolean
  portable: boolean
  /** Instalación de sistema (Pi o Linux con systemd): quiosco, unidades survival-*, tareas root. */
  system: boolean
  /** El equipo es Linux de escritorio/servidor: /proc y /sys legibles (pantallas DRM, entrada, CPU). */
  linuxHost: boolean
  /** Telemetría de la Pi: vcgencmd (tensión, limitación), ventilador PWM, contadores de la microSD. */
  piHardware: boolean
  /** Unidades systemd propias que se pueden vigilar. */
  systemd: boolean
  /** Temperatura y carga de CPU: legibles en Linux; en Android, según el fabricante (se decide con la lectura). */
  cpuProbe: 'yes' | 'no' | 'maybe'
  /** Salidas de pantalla (DRM) y dispositivos de entrada (/proc/bus/input). */
  displayProbe: boolean
  inputProbe: boolean
  /** Quiosco de labwc: salir al escritorio, apagar la pantalla, reiniciar y apagar el equipo. */
  kiosk: boolean
  /** Survivelia OS controla la radio Wi-Fi y el punto de acceso (en la portable es cosa del sistema anfitrión). */
  wifiControl: boolean
  /** Ajustar el reloj a mano y «Comprobar la hora ahora» (tareas root `set-time`/`time-sync`). */
  clockControl: boolean
  /** GPS por los pines GPIO (UART) de la Pi; en la portable y Android, GPS por USB. */
  gpioGps: boolean
  /** Teclado en pantalla propio (Android ya trae el suyo). */
  onScreenKeyboard: boolean
  /** Brújula del propio dispositivo (sensores de orientación): solo tablets y móviles. */
  deviceCompass: boolean
  /** El nombre de equipo significa algo (en Android siempre es «localhost»). */
  hostname: boolean
}

export function platformCaps({ android, portable: portableFlag, os }: PlatformInput): PlatformCaps {
  const portable = portableFlag || android
  const system = !portable
  // Portable: el sistema anfitrión se conoce con la primera lectura; hasta entonces no se promete nada.
  const linuxHost = !android && (system || os === 'linux')
  return {
    android,
    portable,
    system,
    linuxHost,
    piHardware: system,
    systemd: system,
    cpuProbe: linuxHost ? 'yes' : android ? 'maybe' : 'no',
    displayProbe: linuxHost,
    inputProbe: linuxHost,
    kiosk: system,
    wifiControl: system,
    clockControl: system,
    gpioGps: system,
    onScreenKeyboard: !android,
    deviceCompass: android,
    hostname: !android,
  }
}
