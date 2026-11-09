/**
 * Utilidades de red puras (testeables sin Nitro).
 */

/** true si la dirección del socket es loopback (127.0.0.0/8, ::1 o IPv4 mapeada). */
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  if (a === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** Rutas que solo deben servirse a la pantalla local. */
const PRIVATE_PATHS = [/^\/boveda(\/|$)/i, /^\/api\/vault(\/|$)/i, /^\/api\/system(\/|$)/i, /^\/api\/admin(\/|$)/i]

export function isPrivatePath(rawPath: string): boolean {
  let path = rawPath.split('?')[0] ?? '/'
  try {
    path = decodeURIComponent(path)
  } catch {
    // Codificación inválida: se evalúa tal cual.
  }
  // Normaliza barras repetidas y segmentos "." para que //boveda o /./boveda no eludan el filtro.
  path = `/${path.split('/').filter((seg) => seg && seg !== '.').join('/')}`
  return PRIVATE_PATHS.some((re) => re.test(path))
}

/**
 * Política de acceso a rutas privadas: solo loopback y sin cabeceras de proxy
 * (si algo reenvía la petición, el origen real no es verificable).
 */
export function allowPrivateRequest(remoteAddress: string | undefined | null, headers: Record<string, unknown>): boolean {
  if (!isLoopbackAddress(remoteAddress)) return false
  if (headers['x-forwarded-for'] || headers.forwarded || headers['x-real-ip']) return false
  return true
}

/**
 * Protección CSRF para acciones con efecto (apagar, bóveda…): exige cabecera
 * personalizada (no enviable por formularios entre orígenes sin preflight) y,
 * si hay Origin, que sea el propio servidor en loopback.
 */
export function isTrustedActionRequest(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers['x-survival-action'] !== '1') return false
  const origin = headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    const u = new URL(origin)
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Nuxt inyecta un script inline con la configuración en modo SPA.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // El lector de la biblioteca embebe /kiwix y documentos del mismo origen.
  "frame-ancestors 'self'",
  "frame-src 'self'",
].join('; ')
