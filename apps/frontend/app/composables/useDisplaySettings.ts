export type DimLevel = 0 | 30 | 60

export interface DisplaySettings {
  highContrast: boolean
  largeText: boolean
  dim: DimLevel
  /** Teclado en pantalla al tocar campos de texto. */
  osk: boolean
}

const STORAGE_KEY = 'survival-os:display'
const DEFAULTS: DisplaySettings = { highContrast: false, largeText: false, dim: 0, osk: true }

function load(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>
    return {
      highContrast: parsed.highContrast === true,
      largeText: parsed.largeText === true,
      dim: parsed.dim === 30 || parsed.dim === 60 ? parsed.dim : 0,
      osk: parsed.osk !== false,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function apply(s: DisplaySettings): void {
  const root = document.documentElement
  root.dataset.contrast = s.highContrast ? 'high' : 'normal'
  root.dataset.text = s.largeText ? 'large' : 'normal'
  root.style.setProperty('--dim', String(s.dim / 100))
}

/** Preferencias de visualización locales al navegador del kiosco. */
export function useDisplaySettings() {
  const settings = useState<DisplaySettings>('display:settings', () => ({ ...DEFAULTS }))
  const panelOpen = useState<boolean>('display:panelOpen', () => false)

  function init(): void {
    settings.value = load()
    apply(settings.value)
  }

  function update(patch: Partial<DisplaySettings>): void {
    settings.value = { ...settings.value, ...patch }
    apply(settings.value)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch {
      // Sin almacenamiento: el ajuste dura hasta recargar.
    }
  }

  return { settings, panelOpen, init, update }
}
