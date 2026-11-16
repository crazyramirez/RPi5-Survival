import { isDocumentLink, linkTitle, viewerUrl } from '~/utils/viewer'

/**
 * Kiosco sin barra del navegador: NADA puede abrir una ventana nueva ni sacar la ventana principal de
 * la app (no habría forma de volver). Enlaces con target="_blank" y window.open se reconducen al
 * visor integrado (/visor) si son documentos locales; lo externo se ignora (sin Internet no sirve).
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const origin = window.location.origin

  const open = (href: string, title: string | null): void => {
    const v = viewerUrl(href, title, origin)
    if (v) void router.push(v)
  }

  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a || !a.href) return
      const target = (a.getAttribute('target') ?? '').toLowerCase()
      let url: URL
      try {
        url = new URL(a.href)
      } catch {
        return
      }
      // download no cuenta: guardar un fichero (GPX) no saca al usuario de la app.
      const escapes = target === '_blank' || target === '_top' || target === '_parent'
      if (url.origin !== origin) {
        e.preventDefault()
        return
      }
      if (escapes || isDocumentLink(url.pathname)) {
        e.preventDefault()
        open(a.href, linkTitle(a))
      }
    },
    true,
  )

  window.open = ((url?: string | URL) => {
    if (url) open(String(url), null)
    return null
  }) as typeof window.open
})
