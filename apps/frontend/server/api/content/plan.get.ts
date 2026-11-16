import type { ContentCatalogItem } from '@survival-os/shared-types'
import { autoFit, downloadPlan, orderPlan, type ContentLang } from '../../../app/utils/content'
import { readDefaults } from '../../utils/defaults'
import { contentOverview, countryOptions } from '../../utils/content'
import { requestLang } from '../../utils/lang'

/**
 * Plan de descarga calculado en el servidor (ADR 0018), el mismo que «Descargarlo todo» en pantalla. Para
 * automatizar sin tocar la pantalla (npm run express, agentes LLM):
 *   GET /api/content/plan?mode=all|recommended&lang=es&country=esp
 * Devuelve los elementos en orden de instalación, ya ajustados al espacio libre; se lanzan con
 *   POST /api/admin/content {action:"install", items:[…]}  (cabecera x-survival-action: 1, solo desde el equipo).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const defaults = await readDefaults()
  const langQ = String(q.lang ?? '')
  const lang = (['es', 'en', 'fr', 'it'].includes(langQ) ? langQ : (defaults.locale ?? requestLang(event))) as ContentLang
  const mode = q.mode === 'recommended' ? 'recommended' : 'all'
  const ov = await contentOverview(lang)
  const { countries } = await countryOptions(lang)
  const countryId = typeof q.country === 'string' && /^[a-z]{3}$/.test(q.country) ? q.country : (defaults.country ?? (lang === 'es' ? 'esp' : null))
  const country = countries.find((c) => c.id === countryId) ?? null
  const installed = new Set(ov.items.filter((s) => s.state === 'installed').map((s) => s.id))
  const plan = downloadPlan(ov.catalog as ContentCatalogItem[], installed, lang, country, mode, ov.ramBytes)
  const fit = autoFit(plan, ov.freeBytes)
  const sum = (xs: ContentCatalogItem[]): number => xs.reduce((n, i) => n + i.approxBytes, 0)
  return {
    lang,
    country: country ? { id: country.id, name: country.name } : null,
    mode,
    freeBytes: ov.freeBytes,
    items: orderPlan(fit.keep).map((i) => i.id),
    bytes: sum(fit.keep),
    dropped: fit.dropped.map((i) => i.id),
    droppedBytes: sum(fit.dropped),
    complete: plan.length === 0,
  }
})
