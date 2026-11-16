import { join } from 'node:path'
import type { PortableUsbStatus } from '@survival-os/shared-types'

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

/** Módulos de la carpeta portable (app/portable/*.mjs), fuera del bundle de Nitro: los usa también el lanzador. */
async function loadPortableModule<T>(name: 'install' | 'usb' | 'autoopen'): Promise<T> {
  const { root } = portablePaths()
  const { pathToFileURL } = await import('node:url')
  const url = pathToFileURL(join(root, 'app', 'portable', `${name}.mjs`)).href
  return (await import(/* @vite-ignore */ url)) as T
}

export function loadInstaller(): Promise<InstallModule> {
  return loadPortableModule<InstallModule>('install')
}

export const installState: InstallState = { state: 'idle', message: null, dest: null, shortcuts: [] }

// ---------------------------------------------------------------- Memoria USB (ADR 0019)

interface MediaEntry { media: string; path: string; label: string; fs: string | null; freeBytes: number; totalBytes: number }
interface VolumeInfo { removable: boolean; mount: string | null; label: string | null; fs: string | null; volumeRoot: boolean; id: string | null; rel: string | null; media: string | null }
export interface UsbModule {
  mountedMediaAsync: (platform?: string) => Promise<MediaEntry[]>
  volumeInfo: (root: string, platform?: string, media?: MediaEntry[] | null) => VolumeInfo
  ensureVolumeId: (mount: string) => string
  isInside: (child: string, parent: string, platform?: string) => boolean
  preparePlanAsync: (root: string, data: string) => Promise<PortableUsbStatus['prepare']>
}
type AutoOpenStatus = PortableUsbStatus['autoOpen']
export interface AutoOpenModule {
  status: (o: { root: string; volumeId: string | null }) => AutoOpenStatus
  enable: (o: { root: string; volumeId: string; rel: string; mode: string; messages: Record<string, string> }) => AutoOpenStatus
  disable: (o: { root: string; volumeId: string | null }) => AutoOpenStatus
  dismiss: (o: { root: string; volumeId: string }) => AutoOpenStatus
  update: (o: { root: string; volumeId: string | null; mode?: string; messages: Record<string, string> }) => AutoOpenStatus
}

export const loadUsb = (): Promise<UsbModule> => loadPortableModule<UsbModule>('usb')
export const loadAutoOpen = (): Promise<AutoOpenModule> => loadPortableModule<AutoOpenModule>('autoopen')

let mediaCache: { at: number; list: MediaEntry[] } | null = null
let planCache: { at: number; plan: PortableUsbStatus['prepare'] } | null = null

/** Unidades externas (PowerShell tarda ~1 s en Windows: se reutiliza 10 s). */
async function media(force = false): Promise<MediaEntry[]> {
  if (!force && mediaCache && Date.now() - mediaCache.at < 10_000) return mediaCache.list
  const usb = await loadUsb()
  const list = await usb.mountedMediaAsync().catch(() => [] as MediaEntry[])
  mediaCache = { at: Date.now(), list }
  return list
}

/** Dónde se ejecuta y en qué memoria (para «abrir al conectar» y «Expulsar»). */
export async function currentVolume(force = false): Promise<VolumeInfo> {
  const usb = await loadUsb()
  return usb.volumeInfo(portablePaths().root, process.platform, await media(force))
}

export async function usbStatus(force = false): Promise<PortableUsbStatus> {
  const { root, data } = portablePaths()
  const usb = await loadUsb()
  const autoopen = await loadAutoOpen()
  const list = await media(force)
  const v = usb.volumeInfo(root, process.platform, list)
  if (force || !planCache || Date.now() - planCache.at > 60_000) planCache = { at: Date.now(), plan: await usb.preparePlanAsync(root, data) }
  const { existsSync } = await import('node:fs')
  return {
    volume: { removable: v.removable, mount: v.mount, label: v.label, fs: v.fs, volumeRoot: v.volumeRoot, id: v.id },
    autoOpen: v.removable
      ? autoopen.status({ root, volumeId: v.id })
      : { supported: false, reason: null, enabled: false, paired: false, mode: 'ask', dismissed: false },
    media: list
      .filter((m) => !usb.isInside(root, m.path))
      .map((m) => ({ media: m.media, label: m.label, fs: m.fs, freeBytes: m.freeBytes, totalBytes: m.totalBytes, hasSurvival: existsSync(join(m.path, 'app', 'portable', 'launcher.mjs')) })),
    prepare: planCache.plan,
    platform: process.platform,
  }
}

/** Textos de los avisos del vigilante y de la expulsión (idioma de la interfaz), validados. */
export function cleanMessages(raw: unknown, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string') {
      const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300)
      if (s) out[k] = s
    }
  }
  return out
}
