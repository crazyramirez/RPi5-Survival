import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, VaultFiles } from '../src/files.ts'
import {
  backoffSeconds,
  formatRecoveryKey,
  mimeFor,
  normalizeRecoveryKey,
  parseKeyslots,
  parseUnlockedSlot,
  passphraseIsWeak,
  passphraseProblem,
  retryAfter,
  safeFileName,
  safeRelative,
  sanitizeDate,
  sanitizeTags,
} from '../src/policy.ts'

describe('política de contraseñas (equipo personal, ADR 0013)', () => {
  it('admite PIN y contraseñas cortas', () => {
    expect(passphraseProblem('2580')).toBeNull()
    expect(passphraseProblem('739164')).toBeNull()
    expect(passphraseProblem('gato')).toBeNull()
  })
  it('rechaza solo lo trivial', () => {
    expect(passphraseProblem('123')).toMatch(/Mínimo 4/)
    expect(passphraseProblem('1111')).toMatch(/previsible/)
    expect(passphraseProblem('1234')).toMatch(/previsible/)
    expect(passphraseProblem('987654')).toMatch(/previsible/)
    expect(passphraseProblem('password1')).toMatch(/previsible/)
    expect(passphraseProblem('a'.repeat(513))).toMatch(/Máximo/)
  })
  it('no acepta una clave de recuperación como contraseña', () => {
    expect(passphraseProblem(formatRecoveryKey(new Uint8Array(20).fill(7)))).toMatch(/recuperación/)
  })
  it('marca como débiles los PIN y las cortas', () => {
    expect(passphraseIsWeak('2580')).toBe(true)
    expect(passphraseIsWeak('123456789012345')).toBe(true) // solo dígitos
    expect(passphraseIsWeak('solominusculaslargas')).toBe(true)
    expect(passphraseIsWeak('caballo bateria grapa correcta')).toBe(false)
    expect(passphraseIsWeak('Rio-Tajo-1987-norte')).toBe(false)
  })
  it('cuenta caracteres Unicode, no bytes', () => {
    expect(passphraseProblem('ñañ')).toMatch(/Mínimo/)
    expect(passphraseProblem('ñandú')).toBeNull()
  })
})

describe('clave de recuperación', () => {
  it('160 bits en 8 grupos de 4 (base32 de Crockford)', () => {
    const k = formatRecoveryKey(Uint8Array.from({ length: 20 }, (_, i) => i * 13))
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(formatRecoveryKey(new Uint8Array(20))).toBe('0000-0000-0000-0000-0000-0000-0000-0000')
    expect(formatRecoveryKey(new Uint8Array(20).fill(255))).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
    expect(() => formatRecoveryKey(new Uint8Array(19))).toThrow()
  })
  it('normaliza lo tecleado a mano', () => {
    const k = formatRecoveryKey(Uint8Array.from({ length: 20 }, (_, i) => 255 - i * 7))
    expect(normalizeRecoveryKey(k)).toBe(k)
    expect(normalizeRecoveryKey(k.toLowerCase().replace(/-/g, ' '))).toBe(k)
    expect(normalizeRecoveryKey('oooo-iiii-llll-0000-0000-0000-0000-0000')).toBe('0000-1111-1111-0000-0000-0000-0000-0000')
    expect(normalizeRecoveryKey('UUUU-0000-0000-0000-0000-0000-0000-0000')).toBeNull() // U no existe
    expect(normalizeRecoveryKey('0000-0000')).toBeNull()
    expect(normalizeRecoveryKey(42)).toBeNull()
  })
  it('lee keyslots de luksDump y el slot de --test-passphrase', () => {
    const dump = [
      'LUKS header information',
      'Version:       \t2',
      'Keyslots:',
      '  0: luks2',
      '\tKey:        512 bits',
      '\tPBKDF:      argon2id',
      '  2: luks2',
      '\tKey:        512 bits',
      'Tokens:',
      'Digests:',
      '  0: pbkdf2',
    ].join('\n')
    expect(parseKeyslots(dump)).toEqual([0, 2])
    expect(parseKeyslots('Keyslots:\nTokens:\n')).toEqual([])
    expect(parseUnlockedSlot('Key slot 1 unlocked.\nCommand successful.')).toBe(1)
    expect(parseUnlockedSlot('Command successful.')).toBeNull()
  })
})

describe('límite de intentos', () => {
  it('sin espera los 3 primeros fallos, luego exponencial con tope', () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([0, 0, 0])
    expect(backoffSeconds(4)).toBe(2)
    expect(backoffSeconds(8)).toBe(32)
    expect(backoffSeconds(50)).toBe(900)
  })
  it('retryAfter descuenta el tiempo transcurrido', () => {
    expect(retryAfter(6, 1_000_000, 1_000_000 + 3_000)).toBe(5)
    expect(retryAfter(6, 1_000_000, 1_000_000 + 9_000)).toBe(0)
    expect(retryAfter(0, null, 0)).toBe(0)
  })
})

describe('saneado', () => {
  it('nombres de fichero', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName(['C:', 'Users', 'x', 'DNI.pdf'].join(String.fromCharCode(92)))).toBe('DNI.pdf')
    expect(safeFileName(`${String.fromCharCode(0x202e)}gnp.exe`)).toBe('gnp.exe')
    expect(safeFileName('...')).toBe('documento')
  })
  it('rutas relativas de USB', () => {
    expect(safeRelative('docs/a.pdf')).toBe(true)
    expect(safeRelative('../a')).toBe(false)
    expect(safeRelative('/etc/shadow')).toBe(false)
    expect(safeRelative('a//b')).toBe(false)
  })
  it('mime por lista cerrada', () => {
    expect(mimeFor('a.PDF')).toBe('application/pdf')
    expect(mimeFor('a.html')).toBe('application/octet-stream') // nunca se sirve HTML activo
  })
  it('etiquetas y fecha', () => {
    expect(sanitizeTags(['salud', ' salud ', 3, ''])).toEqual(['salud'])
    expect(sanitizeDate('2027-01-31')).toBe('2027-01-31')
    expect(sanitizeDate('31/01/2027')).toBeNull()
  })
})

describe('VaultFiles (sobre un directorio cualquiera)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('añade con SHA-256, lista, actualiza y borra', async () => {
    const v = new VaultFiles(dir)
    await v.init()
    const f = await v.add(Readable.from([Buffer.from('DOCUMENTO FICTICIO')]), { name: 'poliza.txt', tags: ['seguro'], reviewDate: '2027-06-01' })
    expect(f.sha256).toBe('d1084245eafea228c08f0cac4abc115af9c6e2e24b191c659b052f81645c5b09')
    expect(f).toMatchObject({ name: 'poliza.txt', mime: 'text/plain; charset=utf-8', sizeBytes: 18, tags: ['seguro'], reviewDate: '2027-06-01' })
    expect(readFileSync(join(dir, 'files', f.id), 'utf8')).toBe('DOCUMENTO FICTICIO')
    expect((await v.update(f.id, { name: 'poliza-hogar.txt', tags: ['seguro', 'hogar'] }))?.tags).toEqual(['seguro', 'hogar'])
    expect(await v.list()).toHaveLength(1)
    expect(await v.remove(f.id)).toBe(true)
    expect(await v.list()).toHaveLength(0)
  })

  it('rechaza ficheros enormes sin dejar restos', async () => {
    const v = new VaultFiles(dir)
    await v.init()
    const big = Readable.from((function* () {
      for (let i = 0; i <= MAX_FILE_BYTES / (1024 * 1024); i++) yield Buffer.alloc(1024 * 1024)
    })())
    await expect(v.add(big, { name: 'grande.bin' })).rejects.toThrow(/demasiado grande/)
    expect(await v.list()).toHaveLength(0)
  })

  it('ids inválidos', async () => {
    const v = new VaultFiles(dir)
    await expect(v.remove('../index.json')).rejects.toThrow()
  })
})
