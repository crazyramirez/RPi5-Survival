import { translate } from '~/utils/i18n'

/** Traducción. Hoy solo español; el catálogo está aislado en ~/locales. */
export function useT() {
  return translate
}
