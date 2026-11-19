import { ref } from 'vue'
import { de } from '../locales/de'
import { en } from '../locales/en'
import { es, type MessageKey } from '../locales/es'
import { fr } from '../locales/fr'
import { it } from '../locales/it'
import { ja } from '../locales/ja'
import { zh } from '../locales/zh'
import { serverDe } from '../locales/server/de'
import { serverEn } from '../locales/server/en'
import { serverFr } from '../locales/server/fr'
import { serverIt } from '../locales/server/it'
import { serverJa } from '../locales/server/ja'
import { serverZh } from '../locales/server/zh'

export type MessageParams = Record<string, string | number>
export type Locale = 'es' | 'en' | 'fr' | 'it' | 'de' | 'zh' | 'ja'

/** Idiomas de la interfaz. El nombre va en su propio idioma (quien no lee español debe reconocer el suyo). */
export const LOCALES: readonly { code: Locale; name: string; bcp47: string }[] = [
  { code: 'es', name: 'Español', bcp47: 'es-ES' },
  { code: 'en', name: 'English', bcp47: 'en-GB' },
  { code: 'fr', name: 'Français', bcp47: 'fr-FR' },
  { code: 'it', name: 'Italiano', bcp47: 'it-IT' },
  { code: 'de', name: 'Deutsch', bcp47: 'de-DE' },
  { code: 'zh', name: '中文', bcp47: 'zh-CN' },
  { code: 'ja', name: '日本語', bcp47: 'ja-JP' },
]

const STORAGE_KEY = 'survival-os:locale'
const catalogs: Record<Locale, Record<MessageKey, string>> = { es, en, fr, it, de, zh, ja }
const serverCatalogs: Partial<Record<Locale, Record<string, string>>> = { en: serverEn, fr: serverFr, it: serverIt, de: serverDe, zh: serverZh, ja: serverJa }

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && LOCALES.some((l) => l.code === v)
}

function initialLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Sin almacenamiento: español.
  }
  return 'es'
}

/** Idioma activo (español por defecto). Cambiarlo recarga la app: así nada queda a medio traducir. */
export const locale = ref<Locale>(initialLocale())

/** Cookie del idioma: la envía el navegador en cada petición y el servidor la pasa a los servicios. */
export function syncLocaleCookie(): void {
  try {
    document.cookie = `survival-lang=${locale.value}; path=/; max-age=31536000; SameSite=Strict`
  } catch {
    // Sin cookies: los servicios responden en español.
  }
}

export function setLocale(l: Locale): void {
  if (!isLocale(l) || l === locale.value) return
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    // Sin almacenamiento: dura hasta recargar.
  }
  locale.value = l
  syncLocaleCookie()
  window.location.reload()
}

/** Etiqueta BCP 47 del idioma activo, para fechas y números (`toLocaleString`). */
export function bcp47(): string {
  return LOCALES.find((l) => l.code === locale.value)?.bcp47 ?? 'es-ES'
}

/**
 * Sustituye `{nombre}` por parámetros. Claves desconocidas se dejan visibles para detectarlas.
 * Plural: `{n:libro|libros}` elige la forma según el número y las reglas del idioma (Intl.PluralRules: en
 * francés 0 y 1 son singular). Así nunca se ve «libro(s)».
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template
    .replace(/\{(\w+):([^|{}]*)\|([^{}]*)\}/g, (match, name: string, one: string, other: string) => {
      const n = Number(params[name])
      if (params[name] === undefined || !Number.isFinite(n)) return match
      return pluralRules().select(n) === 'one' ? one : other
    })
    .replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match))
}

let rules: { lang: string; pr: Intl.PluralRules } | null = null
function pluralRules(): Intl.PluralRules {
  const lang = bcp47()
  if (!rules || rules.lang !== lang) rules = { lang, pr: new Intl.PluralRules(lang) }
  return rules.pr
}

/** Texto de la interfaz en el idioma activo; si una traducción faltara, el español. */
export function translate(key: MessageKey, params?: MessageParams): string {
  return interpolate(catalogs[locale.value][key] ?? es[key], params)
}

const templateCache = new Map<string, { re: RegExp; out: string }[]>()

function serverTemplates(l: Locale): { re: RegExp; out: string }[] {
  let list = templateCache.get(l)
  if (!list) {
    list = Object.entries(serverCatalogs[l] ?? {})
      .filter(([k]) => /\{\d+\}/.test(k))
      .map(([k, out]) => ({
        re: new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)\\\}/g, '(.*?)')}$`),
        out,
      }))
    templateCache.set(l, list)
  }
  return list
}

/**
 * Texto que llega de un servicio (motivo de «no disponible», error). Los servicios hablan español; aquí se
 * traduce si está en el catálogo (exacto, o plantilla con {0}, {1}…). Si no, se muestra tal cual: mejor el
 * motivo real en español que ocultarlo.
 */
export function translateServer(text: string | null | undefined): string {
  if (!text) return text ?? ''
  if (locale.value === 'es') return text
  const cat = serverCatalogs[locale.value]
  const exact = cat?.[text]
  if (exact) return exact
  for (const { re, out } of serverTemplates(locale.value)) {
    const m = re.exec(text)
    if (m) return out.replace(/\{(\d+)\}/g, (_, i: string) => m[Number(i) + 1] ?? '')
  }
  return text
}
