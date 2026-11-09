import { proxyToLocal } from '../../utils/proxy'

/** /kiwix/** → kiwix-serve (127.0.0.1:8783, --urlRootLocation=/kiwix). Solo lectura. */
export default defineEventHandler((event) => {
  const { kiwixUrl } = useRuntimeConfig(event)
  const url = getRequestURL(event)
  if (url.pathname.includes('..')) throw createError({ statusCode: 400 })
  return proxyToLocal(event, `${kiwixUrl}${url.pathname}${url.search}`)
})
