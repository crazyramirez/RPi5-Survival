/**
 * POST a una acción con efecto del servidor local. Añade la cabecera exigida
 * por la protección CSRF (server/utils/net.ts → isTrustedActionRequest).
 */
export async function postAction<T = unknown>(url: string, body: Record<string, unknown> = {}): Promise<T> {
  // Cast: la inferencia de rutas de Nitro no aplica a URLs dinámicas.
  return await ($fetch as (u: string, o: Record<string, unknown>) => Promise<T>)(url, {
    method: 'POST',
    body,
    headers: { 'x-survival-action': '1' },
    timeout: 15_000,
    retry: 0,
  })
}

/**
 * Mensaje legible de un error de $fetch. Orden: motivo del propio servicio (Nitro: `data.statusMessage`;
 * bóveda y demás servicios por socket: `data.error`) antes que el texto HTTP genérico
 * («Bad Request», «Unauthorized»…), que no dice al usuario qué corregir.
 */
export function actionErrorMessage(err: unknown): string {
  const e = err as { statusMessage?: string; data?: { statusMessage?: string; error?: unknown; message?: string }; message?: string }
  const fromService = typeof e?.data?.error === 'string' && e.data.error ? e.data.error : undefined
  return e?.data?.statusMessage ?? fromService ?? e?.data?.message ?? e?.statusMessage ?? e?.message ?? 'Error desconocido'
}
