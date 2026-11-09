import type { NavFallbackPosition, Probe } from '@survival-os/shared-types'

/** Lo que se lee de GET /status de survival-mesh (solo los campos usados). */
interface MeshNodeLike {
  id?: string | null
  longName?: unknown
  shortName?: unknown
  position?: { lat?: unknown; lon?: unknown; alt?: unknown; at?: unknown; cached?: unknown; precisionM?: unknown } | null
}

export interface MeshStatusLike {
  connected?: boolean
  me?: MeshNodeLike | null
  /** Nodo seguido (servicio ≥ 0.2.0); si falta, se usa el propio. */
  tracked?: MeshNodeLike | null
}

/**
 * Posición de respaldo a partir del nodo LoRa seguido (el propio, o uno remoto que llega por radio). Sin inventar: si el servicio no responde, el nodo
 * no está conectado o no informa posición, se dice por qué. La antigüedad se calcula con la hora de la Pi.
 */
export function meshFallback(mesh: MeshStatusLike | null, nowMs: number): Probe<NavFallbackPosition> {
  if (!mesh) return { state: 'unavailable', reason: 'Malla LoRa no disponible' }
  if (!mesh.connected) return { state: 'unavailable', reason: 'Nodo LoRa no conectado' }
  const node = mesh.tracked ?? mesh.me
  const remote = !!node?.id && !!mesh.me?.id && node.id !== mesh.me.id
  const pos = node?.position
  const lat = pos?.lat
  const lon = pos?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { state: 'unavailable', reason: remote ? 'El nodo seguido aún no ha enviado su posición' : 'El nodo LoRa no informa posición' }
  }
  const time = typeof pos?.at === 'string' && !Number.isNaN(Date.parse(pos.at)) ? pos.at : null
  const age = time ? Math.max(0, Math.round((nowMs - Date.parse(time)) / 1000)) : null
  return {
    state: 'ok',
    value: {
      source: 'meshtastic',
      nodeId: typeof node?.id === 'string' ? node.id : null,
      nodeName: typeof node?.longName === 'string' ? node.longName : typeof node?.shortName === 'string' ? node.shortName : null,
      remote,
      precisionM: typeof pos?.precisionM === 'number' && pos.precisionM > 0 ? pos.precisionM : null,
      latitude: lat,
      longitude: lon,
      altitudeM: typeof pos?.alt === 'number' ? pos.alt : null,
      time,
      ageSeconds: age,
      lastKnown: pos?.cached === true,
    },
    at: new Date(nowMs).toISOString(),
  }
}
