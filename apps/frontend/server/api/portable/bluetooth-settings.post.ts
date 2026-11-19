import { spawn } from 'node:child_process'
import { androidBridge, isAndroid } from '../../utils/android'
import { assertPortable } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/**
 * Abre los ajustes de Bluetooth del sistema anfitrión para emparejar teclados y ratones: en Windows, macOS y
 * Android lo hace el sistema; en Linux, solo si el motor propio (bt-input.py) no puede hablar con BlueZ.
 */
const CANDIDATES: Record<string, [string, string[]][]> = {
  win32: [['explorer.exe', ['ms-settings:bluetooth']]],
  darwin: [['open', ['x-apple.systempreferences:com.apple.BluetoothSettings']]],
  linux: [
    ['gnome-control-center', ['bluetooth']],
    ['systemsettings', ['kcm_bluetooth']],
    ['blueman-manager', []],
  ],
}

function launch(list: [string, string[]][]): Promise<boolean> {
  const [first, ...rest] = list
  if (!first) return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawn(first[0], first[1], { stdio: 'ignore', detached: true, windowsHide: false })
    child.once('error', () => resolve(launch(rest)))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertPortable()
  if (isAndroid()) return await androidBridge('/app/action', { action: 'bluetooth-settings' })
  const opened = await launch(CANDIDATES[process.platform] ?? [])
  if (!opened) throw createError({ statusCode: 501, statusMessage: 'No se encontraron los ajustes de Bluetooth del sistema' })
  return { ok: true }
})
