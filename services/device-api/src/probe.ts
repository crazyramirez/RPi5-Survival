import type { Probe, ProbeError, ProbeOk, ProbeUnavailable } from '@survival-os/shared-types'

export const ok = <T>(value: T): ProbeOk<T> => ({ state: 'ok', value, at: new Date().toISOString() })

export const unavailable = (reason: string): ProbeUnavailable => ({ state: 'unavailable', reason })

export const failed = (reason: string): ProbeError => ({ state: 'error', reason })

export const isLinux = (): boolean => process.platform === 'linux'

export const notLinux = (): ProbeUnavailable =>
  unavailable(`Solo disponible en Linux (plataforma actual: ${process.platform})`)

/**
 * Ejecuta un recolector y convierte cualquier excepción en un estado `error`.
 * Un fallo en un recolector nunca debe tumbar el informe completo.
 */
export async function safeProbe<T>(fn: () => Promise<Probe<T>> | Probe<T>): Promise<Probe<T>> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failed(message.slice(0, 200))
  }
}
