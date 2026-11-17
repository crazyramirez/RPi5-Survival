/**
 * «Volver a la lista»: si la pantalla anterior del historial es esa lista (con su búsqueda o filtro), es «Atrás» de
 * verdad: no se apila otra entrada y la lista sigue como estaba. Si se llegó de otro sitio (favorito, Inicio), se abre.
 */
export function useBackTo(): (path: string) => void {
  const router = useRouter()
  return (path) => {
    const prev: unknown = window.history.state?.back
    if (typeof prev === 'string' && prev.split(/[?#]/)[0] === path) router.back()
    else void router.push(path)
  }
}
