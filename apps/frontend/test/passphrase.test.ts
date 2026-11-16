import { describe, expect, it } from 'vitest'
import { passphraseIsWeak as serviceWeak } from '../../../services/vault/src/policy'
import { groupRecoveryInput, passphraseIsWeak } from '../app/utils/passphrase'

describe('aviso de contraseña débil', () => {
  it('coincide con la regla del servicio vault', () => {
    for (const p of ['2580', '123456789012345', 'gato', 'solominusculaslargas', 'caballo bateria grapa correcta', 'Rio-Tajo-1987-norte', 'ñandú Ñandú 12']) {
      expect(passphraseIsWeak(p), p).toBe(serviceWeak(p))
    }
  })
})

describe('entrada de clave de recuperación', () => {
  it('agrupa de 4 en 4 y limita a 32 caracteres', () => {
    expect(groupRecoveryInput('abcd efgh')).toBe('ABCD-EFGH')
    expect(groupRecoveryInput('ab')).toBe('AB')
    expect(groupRecoveryInput('x'.repeat(40))).toBe(Array(8).fill('XXXX').join('-'))
    expect(groupRecoveryInput('')).toBe('')
  })
})
