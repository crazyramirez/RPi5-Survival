import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PORTABLE_FOLDERS, assertPortable, portablePaths, type PortableFolder } from '../../utils/portable'
import { assertTrustedAction } from '../../utils/system'

/** Abre una carpeta de datos (lista cerrada) en el explorador de archivos del sistema. */
export default defineEventHandler(async (event) => {
  assertTrustedAction(event)
  assertPortable()
  const body = (await readBody<{ folder?: string }>(event).catch(() => null)) ?? {}
  const folder = body.folder as PortableFolder
  if (!folder || !Object.hasOwn(PORTABLE_FOLDERS, folder)) throw createError({ statusCode: 400, statusMessage: 'Carpeta no válida' })
  const dir = join(portablePaths().data, PORTABLE_FOLDERS[folder])
  await mkdir(dir, { recursive: true })
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]]
  spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
  return { opened: dir }
})
