/**
 * Reloj compartido. Se actualiza en cada cambio de minuto (no cada segundo)
 * para no forzar repintados continuos. El plugin `clock.client` lo mantiene.
 */
export function useNow() {
  return useState<Date>('clock:now', () => new Date())
}
