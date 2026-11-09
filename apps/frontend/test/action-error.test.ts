import { describe, expect, it } from 'vitest'
import { actionErrorMessage } from '../app/composables/useAction'

/** Los errores deben decir al usuario QUÉ corregir, no el texto HTTP genérico. */
describe('actionErrorMessage', () => {
  it('usa el motivo de los servicios por socket (bóveda: { error })', () => {
    const err = { statusMessage: 'Bad Request', data: { error: 'Mínimo 12 caracteres (mejor una frase de varias palabras)' } }
    expect(actionErrorMessage(err)).toBe('Mínimo 12 caracteres (mejor una frase de varias palabras)')
  })
  it('usa statusMessage de Nitro (createError)', () => {
    expect(actionErrorMessage({ statusMessage: 'Bad Request', data: { statusMessage: 'Medio no válido' } })).toBe('Medio no válido')
  })
  it('solo recurre al texto HTTP si no hay motivo', () => {
    expect(actionErrorMessage({ statusMessage: 'Bad Request', data: {} })).toBe('Bad Request')
    expect(actionErrorMessage(new Error('fallo de red'))).toBe('fallo de red')
    expect(actionErrorMessage(null)).toBe('Error desconocido')
  })
})
