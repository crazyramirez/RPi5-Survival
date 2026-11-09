import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import type { H3Event } from 'h3'
import { isTrustedActionRequest } from './net'

export const KIOSK_FIFO = process.env.SURVIVAL_KIOSK_FIFO ?? '/run/survival-os/kiosk.fifo'

/** Rechaza acciones con efecto que no vengan de la propia UI (ver isTrustedActionRequest). */
export function assertTrustedAction(event: H3Event): void {
  if (!isTrustedActionRequest(event.node.req.headers)) {
    throw createError({ statusCode: 403, statusMessage: 'Acción no autorizada' })
  }
}

export function assertLinux(): void {
  if (process.platform !== 'linux') {
    throw createError({ statusCode: 501, statusMessage: 'Solo disponible en el equipo (Linux)' })
  }
}

/** systemctl poweroff/reboot como usuario de servicio (permitido por la regla polkit de Survival OS). */
export function systemctlPower(action: 'poweroff' | 'reboot'): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('systemctl', [action, '--no-wall'], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Envía una orden al agente del kiosco (FIFO leída en la sesión gráfica).
 * O_NONBLOCK: si no hay lector, falla con ENXIO en vez de bloquear el servidor.
 */
export async function sendKioskCommand(cmd: 'display-off' | 'exit-desktop'): Promise<boolean> {
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
