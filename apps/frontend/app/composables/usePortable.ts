/** true en la versión portable (ADR 0014): carpeta en USB/disco lanzada en Windows, macOS o Linux. */
export function usePortable(): boolean {
  return useRuntimeConfig().public.portable === true
}

/** «Cerrar Survivelia OS» (solo portable): el lanzador detiene todos los servicios. */
export async function quitPortable(): Promise<void> {
  await postAction('/api/portable/quit')
}
