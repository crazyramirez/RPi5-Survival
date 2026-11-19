import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import type { H3Event } from 'h3'
import { isTrustedActionRequest } from './net'
import { isPortable } from './portable'

export const KIOSK_FIFO = process.env.SURVIVAL_KIOSK_FIFO ?? '/run/survival-os/kiosk.fifo'

/** Rechaza acciones con efecto que no vengan de la propia UI (ver isTrustedActionRequest). */
export function assertTrustedAction(event: H3Event): void {
  if (!isTrustedActionRequest(event.node.req.headers)) {
    throw createError({ statusCode: 403, statusMessage: 'Acción no autorizada' })
  }
}

export function assertLinux(): void {
  // En la versión portable el anfitrión puede ser Linux, pero nunca se apaga ni se toca su escritorio.
  if (process.platform !== 'linux' || isPortable()) {
    throw createError({ statusCode: 501, statusMessage: 'Solo disponible en el equipo Survivelia OS' })
  }
}

/** systemctl poweroff/reboot como usuario de servicio (permitido por la regla polkit de Survivelia OS). */
export function systemctlPower(action: 'poweroff' | 'reboot'): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('systemctl', [action, '--no-wall'], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Envía una orden al agente del kiosco (FIFO leída en la sesión gráfica).
 * O_NONBLOCK: si no hay lector, falla con ENXIO en vez de bloquear el servidor.
 */
export async function sendKioskCommand(cmd: 'display-off' | 'exit-desktop' | 'touchpad-scroll natural' | 'touchpad-scroll traditional'): Promise<boolean> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(KIOSK_FIFO, constants.O_WRONLY | constants.O_NONBLOCK)
    await handle.write(`${cmd}\n`)
    return true
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}
