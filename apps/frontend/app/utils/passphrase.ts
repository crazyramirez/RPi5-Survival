/**
 * Aviso en vivo de contraseña débil (solo presentación). Copia de `passphraseIsWeak` del servicio
 * vault (services/vault/src/policy.ts); un test comprueba que ambas coinciden.
 * Débil = corta, solo dígitos o de una sola clase sin ser frase: se acepta (equipo personal,
 * ADR 0013), pero no resiste un ataque offline si roban la microSD.
 */
export function passphraseIsWeak(p: string): boolean {
  if ([...p].length < 12 || /^\d+$/.test(p)) return true
  const classes = [/[a-zñáéíóúü]/, /[A-ZÑÁÉÍÓÚÜ]/, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(p)).length
  return classes < 2 && p.trim().split(/\s+/).length < 4
}

/** Agrupa lo que se teclea como clave de recuperación en bloques de 4 (solo presentación). */
export function groupRecoveryInput(raw: string): string {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32)
  return s.match(/.{1,4}/g)?.join('-') ?? ''
}
