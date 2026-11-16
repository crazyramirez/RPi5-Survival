import { join } from 'node:path'

/**
 * Versión portable (ADR 0014): la app corre en Windows/macOS/Linux desde una carpeta (USB o disco),
 * lanzada por portable/launcher.mjs. Aquí no hay systemd, kiosco, bóveda LUKS ni tareas de
 * mantenimiento de la Pi: esas acciones se rechazan en lugar de intentar tocar el sistema anfitrión.
 */
export function isPortable(): boolean {
  return process.env.SURVIVAL_PORTABLE === '1'
}

export function assertNotPortable(): void {
  if (isPortable()) throw createError({ statusCode: 409, statusMessage: 'No disponible en la versión portable' })
}

export function assertPortable(): void {
  if (!isPortable()) throw createError({ statusCode: 404 })
}

/** Raíz de la carpeta portable y su carpeta de datos (las fija el lanzador). */
export function portablePaths(): { root: string; data: string } {
  const root = process.env.SURVIVAL_PORTABLE_ROOT ?? ''
  return { root, data: process.env.SURVIVAL_PORTABLE_DATA ?? join(root, 'data') }
}

/** Carpetas de datos que la interfaz puede abrir en el explorador de archivos (lista cerrada). */
export const PORTABLE_FOLDERS = {
  data: '',
  maps: 'maps',
  docs: 'library/docs',
  zim: 'library/zim',
} as const
export type PortableFolder = keyof typeof PORTABLE_FOLDERS

export interface InstallPlan {
  key: string | null
  dest: string
  same: boolean
  update: boolean
  bytes: number
  dataBytes: number
  copiesData: boolean
}
export interface InstallState {
  state: 'idle' | 'running' | 'done' | 'failed'
  message: string | null
  dest: string | null
  shortcuts: string[]
}
interface InstallModule {
  installPlan: (root: string) => InstallPlan
  installHere: (o: { root: string; onProgress: (m: string) => void }) => Promise<{ dest: string; shortcuts: string[] }>
}

/** El instalador vive en la carpeta portable (app/portable/install.mjs), fuera del bundle de Nitro. */
export async function loadInstaller(): Promise<InstallModule> {
  const { root } = portablePaths()
  const { pathToFileURL } = await import('node:url')
  const url = pathToFileURL(join(root, 'app', 'portable', 'install.mjs')).href
  return (await import(/* @vite-ignore */ url)) as InstallModule
}

export const installState: InstallState = { state: 'idle', message: null, dest: null, shortcuts: [] }
