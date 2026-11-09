const LOCALE = 'es-ES'

export function formatNumber(n: number, maxFractionDigits = 1): string {
  return n.toLocaleString(LOCALE, { maximumFractionDigits: maxFractionDigits })
}

/** Bytes en unidades SI (1 GB = 10^9 B), como las etiquetas de las tarjetas microSD. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i++
  }
  return `${formatNumber(value, value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—'
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

export function formatTemp(c: number): string {
  return `${formatNumber(c, 1)} °C`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Antigüedad legible y corta: «45 s», «12 min», «3 h», «2 d». */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}
