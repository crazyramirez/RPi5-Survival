import type { CountryChoice } from '~/utils/content'
import { locale, type Locale } from '~/utils/i18n'

export interface CountryOption extends CountryChoice {
  iso2: string | null
  /** Nombres en los cuatro idiomas: se busca por cualquiera. */
  names: string[]
  maxzoom: number
  zones: number
  /** Rectángulos [oeste, sur, este, norte] de las zonas que se descargan. */
  bboxes: [number, number, number, number][]
}

const STORAGE_KEY = 'survival-os:region'

/** Idioma propio de cada país, para proponer el idioma inicial (solo los de la interfaz). */
const COUNTRY_LANG: Record<string, Locale> = {
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es',
  PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', GQ: 'es', AD: 'es', PR: 'es',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', SN: 'fr', CI: 'fr', ML: 'fr', NE: 'fr', BF: 'fr', TG: 'fr', BJ: 'fr', GA: 'fr', CG: 'fr',
  CD: 'fr', MG: 'fr', CM: 'fr', HT: 'fr',
  IT: 'it', SM: 'it', VA: 'it',
  GB: 'en', IE: 'en', US: 'en', CA: 'en', AU: 'en', NZ: 'en', ZA: 'en', IN: 'en', NG: 'en', KE: 'en', GH: 'en', JM: 'en', SG: 'en',
  PH: 'en', MT: 'en',
}

/**
 * País del equipo para los mapas y contenidos por defecto (ADR 0018). Sin Internet ni servicios externos:
 * posición medida (GNSS o el nodo LoRa) si la hay; si no, la zona horaria del sistema; si no, la región
 * del idioma del navegador. El usuario puede elegir otro y se recuerda.
 */
export function useRegion() {
  const countries = useState<CountryOption[] | null>('region:countries', () => null)
  const timezones = useState<Record<string, string>>('region:tz', () => ({}))
  const chosen = useState<string | null>('region:chosen', () => null)
  const { nav } = useNav()

  async function load(): Promise<void> {
    try {
      chosen.value = localStorage.getItem(STORAGE_KEY)
    } catch {
      // sin almacenamiento
    }
    if (countries.value?.length) return
    try {
      const r = await $fetch<{ countries: CountryOption[]; timezones: Record<string, string> }>('/api/content/countries', { timeout: 10_000, retry: 0 })
      countries.value = r.countries
      timezones.value = r.timezones
    } catch {
      countries.value = []
    }
  }

  const byIso2 = (iso2: string | null | undefined): CountryOption | null =>
    iso2 ? ([...(countries.value ?? [])].filter((c) => c.iso2 === iso2.toUpperCase()).sort((a, b) => b.mapBytes - a.mapBytes)[0] ?? null) : null

  /** Posición medida → país cuya zona la contiene (la más pequeña, para no confundir vecinos). */
  function fromPosition(): { c: CountryOption; by: 'position' | 'lora' } | null {
    const n = nav.value
    const gnss = n?.gnss.state === 'ok' && n.gnss.value.latitude != null && n.gnss.value.longitude != null ? [n.gnss.value.latitude, n.gnss.value.longitude] : null
    const lora = n?.fallback?.state === 'ok' ? [n.fallback.value.latitude, n.fallback.value.longitude] : null
    const p = gnss ?? lora
    if (!p) return null
    const by = gnss ? ('position' as const) : ('lora' as const)
    const [lat, lon] = p as [number, number]
    let best: { c: CountryOption; area: number } | null = null
    for (const c of countries.value ?? []) {
      for (const [w, s, e, nn] of c.bboxes ?? []) {
        if (lon >= w && lon <= e && lat >= s && lat <= nn) {
          const area = (e - w) * (nn - s)
          if (!best || area < best.area) best = { c, area }
        }
      }
    }
    return best ? { c: best.c, by } : null
  }

  function fromTimezone(): CountryOption | null {
    try {
      return byIso2(timezones.value[Intl.DateTimeFormat().resolvedOptions().timeZone])
    } catch {
      return null
    }
  }

  function fromLanguage(): CountryOption | null {
    for (const l of navigator.languages ?? [navigator.language]) {
      const region = /^[a-z]{2,3}-([A-Z]{2})$/i.exec(l)?.[1]
      if (region) return byIso2(region)
    }
    return null
  }

  /** Cómo se ha detectado (para decirlo con honestidad en la interfaz). */
  const detection = computed<{ country: CountryOption; by: 'position' | 'lora' | 'timezone' | 'language' } | null>(() => {
    if (!countries.value?.length) return null
    const p = fromPosition()
    if (p) return { country: p.c, by: p.by }
    const tz = fromTimezone()
    if (tz) return { country: tz, by: 'timezone' }
    const lg = fromLanguage()
    return lg ? { country: lg, by: 'language' } : null
  })

  /** País elegido por el usuario o detectado; sin nada, España con la interfaz en español. */
  const country = computed<CountryOption | null>(() => {
    const list = countries.value ?? []
    return list.find((c) => c.id === chosen.value) ?? detection.value?.country ?? (locale.value === 'es' ? (list.find((c) => c.id === 'esp') ?? null) : null)
  })

  function choose(id: string | null): void {
    chosen.value = id
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // sin almacenamiento
    }
  }

  /** Idioma propuesto la primera vez: el del navegador, salvo inglés genérico en un país de otro idioma. */
  function suggestedLanguage(): Locale {
    const fromNav = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2).toLowerCase()).find((l): l is Locale => ['es', 'en', 'fr', 'it'].includes(l))
    const tzLang = COUNTRY_LANG[fromTimezone()?.iso2 ?? '']
    if (tzLang && (!fromNav || fromNav === 'en')) return tzLang
    return fromNav ?? 'es'
  }

  return { load, countries, country, detection, choose, suggestedLanguage }
}

/** Busca países por cualquiera de sus nombres, sin tildes ni mayúsculas. */
export function searchCountries(list: CountryOption[], q: string, limit = 8): CountryOption[] {
  const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const nq = norm(q.trim())
  if (!nq) return []
  const scored = list
    .map((c) => {
      const names = c.names.map(norm)
      const score = names.some((n) => n.startsWith(nq)) ? 0 : names.some((n) => n.includes(nq)) ? 1 : c.iso2?.toLowerCase() === nq ? 0 : 9
      return { c, score }
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
  return scored.slice(0, limit).map((x) => x.c)
}
