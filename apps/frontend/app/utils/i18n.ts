import { es, type MessageKey } from '../locales/es'

export type MessageParams = Record<string, string | number>

/** Sustituye `{nombre}` por parámetros. Claves desconocidas se dejan visibles para detectarlas. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match,
  )
}

export function translate(key: MessageKey, params?: MessageParams): string {
  return interpolate(es[key], params)
}
