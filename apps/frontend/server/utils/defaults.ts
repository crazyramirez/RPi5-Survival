import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isLang, type Lang } from './lang'
import { isPortable, portablePaths } from './portable'

/**
 * Ajustes por defecto del EQUIPO (no del navegador): idioma y país que la interfaz usa mientras el usuario no
 * elija otros en pantalla. Los escribe `npm run express -- defaults` (o un agente LLM, ver AGENTS.md):
 *   Pi:        /etc/survival-os/defaults.json   (root, 0644)
 *   Portable:  <datos>/defaults.json
 */
export interface DeviceDefaults {
  locale: Lang | null
  country: string | null
}

export function defaultsFile(): string {
  return isPortable() ? join(portablePaths().data, 'defaults.json') : (process.env.SURVIVAL_DEFAULTS_FILE ?? '/etc/survival-os/defaults.json')
}

export async function readDefaults(): Promise<DeviceDefaults> {
  try {
    const raw = JSON.parse(await fs.readFile(defaultsFile(), 'utf8')) as { locale?: unknown; country?: unknown }
    const locale = isLang(raw.locale) ? raw.locale : null
    const country = typeof raw.country === 'string' && /^[a-z]{3}$/.test(raw.country) ? raw.country : null
    return { locale, country }
  } catch {
    return { locale: null, country: null }
  }
}
