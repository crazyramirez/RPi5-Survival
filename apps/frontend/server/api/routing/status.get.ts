import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RoutingStatus } from '@survival-os/shared-types'
import { BROUTER_URL, ROUTING_DIR } from '../../utils/routing'

/** Estado de las rutas sin conexión: el servidor BRouter local responde y qué datos hay instalados. */
export default defineEventHandler(async (): Promise<RoutingStatus> => {
  let manifest: { brouter?: string; downloadedAt?: string; segments?: { name: string; bytes: number; mtime: string }[] } = {}
  try {
    manifest = JSON.parse(await fs.readFile(join(ROUTING_DIR, 'manifest.json'), 'utf8'))
  } catch {
    // sin instalar
  }
  let available = false
  let reason: string | null = null
  try {
    // Cualquier respuesta HTTP (incluido el error por falta de parámetros) indica que el servidor vive.
    const res = await fetch(`${BROUTER_URL}/brouter`, { signal: AbortSignal.timeout(3000) })
    available = res.status > 0
  } catch {
    reason = manifest.segments?.length ? 'El motor de rutas no responde' : 'Rutas sin conexión no instaladas (Mantenimiento → Rutas)'
  }
  return {
    available,
    reason: available ? null : reason,
    brouter: manifest.brouter ?? null,
    segments: (manifest.segments ?? []).map(({ name, bytes, mtime }) => ({ name, bytes, mtime })),
    downloadedAt: manifest.downloadedAt ?? null,
  }
})
