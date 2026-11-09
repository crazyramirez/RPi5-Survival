import { CONTENT_SECURITY_POLICY } from '../utils/net'

/**
 * Cabeceras de seguridad. La CSP impide al navegador cargar cualquier recurso
 * externo (CDN, fuentes, mapas remotos): garantía de funcionamiento offline.
 * En desarrollo se omite la CSP para no romper la recarga en caliente de Vite.
 */
export default defineEventHandler((event) => {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  }
  if (!import.meta.dev) headers['content-security-policy'] = CONTENT_SECURITY_POLICY
  setResponseHeaders(event, headers)
})
