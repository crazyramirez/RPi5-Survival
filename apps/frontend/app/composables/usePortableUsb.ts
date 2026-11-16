import type { PortableUsbStatus } from '@survival-os/shared-types'

/**
 * Memoria USB de Survival OS (versión portable, ADR 0019): estado compartido por la tarjeta de Mantenimiento,
 * el aviso «¿Abrir al conectar?» y Sistema (Expulsar). Los textos de los avisos del sistema (vigilante y
 * expulsión) se mandan en el idioma de la interfaz.
 */
const state = ref<PortableUsbStatus | null>(null)
let pending: Promise<void> | null = null

export function usePortableUsb() {
  const t = useT()

  function load(refresh = false): Promise<void> {
    if (pending && !refresh) return pending
    pending = $fetch<PortableUsbStatus>('/api/portable/usb', { query: refresh ? { refresh: '1' } : {}, timeout: 30_000, retry: 0 })
      .then((s) => {
        state.value = s
      })
      .catch(() => undefined)
      .finally(() => {
        pending = null
      })
    return pending
  }

  /** Textos del vigilante: {name} lo sustituye el propio vigilante por la unidad conectada. */
  const watcherMessages = (): Record<string, string> => ({
    title: 'Survival OS',
    ask: t('usb.msg.ask'),
    yes: t('usb.msg.yes'),
    no: t('usb.msg.no'),
    connect: t('usb.msg.connect'),
  })

  async function autoOpen(action: 'enable' | 'disable' | 'dismiss' | 'update', mode?: 'ask' | 'open'): Promise<void> {
    state.value = await postAction<PortableUsbStatus>('/api/portable/usb', { action, ...(mode ? { mode } : {}), messages: watcherMessages() })
  }

  async function eject(): Promise<void> {
    await postAction('/api/portable/eject', { messages: { title: 'Survival OS', ok: t('usb.eject.ok'), fail: t('usb.eject.fail') } })
  }

  return { usb: state, load, autoOpen, eject }
}

/** Nombre legible del sistema de ficheros. */
export function fsLabel(fs: string | null | undefined): string {
  const names: Record<string, string> = { fat32: 'FAT32', exfat: 'exFAT', ntfs: 'NTFS', apfs: 'APFS', hfs: 'Mac OS Plus', ext: 'ext4' }
  return fs ? (names[fs] ?? fs) : ''
}
