/**
 * App Android (ADR 0020): el mismo servidor que la versión portable, lanzado por la app nativa. Lo que solo
 * Android sabe hacer (mantener la CPU despierta durante una descarga, abrir el instalador de un APK, fijar la
 * pantalla) se pide al puente nativo (127.0.0.1 con token: lo añade android-guard.mjs).
 */
export function isAndroid(): boolean {
  return process.platform === 'android' && !!process.env.SURVIVAL_ANDROID_BRIDGE
}

export async function androidBridge<T = unknown>(path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const base = process.env.SURVIVAL_ANDROID_BRIDGE
  if (!base) throw createError({ statusCode: 501, statusMessage: 'Solo en la app Android' })
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw createError({ statusCode: res.status, statusMessage: data.error ?? 'Error de la app Android' })
  return data
}

/** Mantiene la CPU (y el Wi-Fi) despiertos mientras dure una tarea larga: si no, Android las congela con la pantalla apagada. */
export function keepAwake(job: string, on: boolean): void {
  if (!isAndroid()) return
  void androidBridge('/power/keep-awake', { job, on }).catch(() => undefined)
}
