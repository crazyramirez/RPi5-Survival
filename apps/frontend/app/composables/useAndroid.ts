/** true en la app Android (ADR 0020): la misma interfaz que la portable, lanzada por la app nativa. */
export function useAndroid(): boolean {
  return useRuntimeConfig().public.android === true
}
