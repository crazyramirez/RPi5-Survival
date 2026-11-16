import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { EncryptedFiles, findSlot, makeSlot, openSlot, type Header } from '../src/crypto-store.ts'

const FAST = { memory: 8192, passes: 1, parallelism: 1 } // solo en tests; en uso real 256 MiB
const read = async (s: Readable): Promise<Buffer> => {
  const parts: Buffer[] = []
  for await (const c of s) parts.push(c as Buffer)
  return Buffer.concat(parts)
}

describe('keyslots (Argon2id + AES-256-GCM)', () => {
  it('abre con el secreto correcto y no con otro', async () => {
    const master = randomBytes(32)
    const slot = await makeSlot(master, '2580', 'passphrase', FAST)
    expect((await openSlot(slot, '2580', FAST))?.equals(master)).toBe(true)
    expect(await openSlot(slot, '2581', FAST)).toBeNull()
    // Un keyslot de recuperación no se puede hacer pasar por uno de contraseña (AAD con el tipo).
    expect(await openSlot({ ...slot, kind: 'recovery' }, '2580', FAST)).toBeNull()
  })
  it('recuperación: la clave abre su keyslot; sustituir la contraseña deja de abrir la olvidada', async () => {
    const master = randomBytes(32)
    const h: Header = {
      format: 'survival-vault-portable', version: 1, createdAt: '', kdf: { alg: 'argon2id', ...FAST },
      slots: [await makeSlot(master, 'olvidada', 'passphrase', FAST), await makeSlot(master, 'AAAA-BBBB', 'recovery', FAST)],
    }
    const rec = await findSlot({ ...h, slots: h.slots.filter((s) => s.kind === 'recovery') }, 'AAAA-BBBB')
    expect(rec?.master.equals(master)).toBe(true)
    const h2: Header = { ...h, slots: [await makeSlot(rec!.master, 'nueva', 'passphrase', FAST), ...h.slots.filter((s) => s.kind === 'recovery')] }
    expect(await findSlot(h2, 'olvidada')).toBeNull()
    expect((await findSlot(h2, 'nueva'))?.master.equals(master)).toBe(true)
    expect((await findSlot(h2, 'AAAA-BBBB'))?.master.equals(master)).toBe(true)
  })
})

describe('documentos cifrados por bloques', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-portable-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const key = randomBytes(32)

  it('ida y vuelta (vacío, pequeño y varios bloques) e índice cifrado', async () => {
    const v = new EncryptedFiles(dir, key)
    await v.init()
    for (const size of [0, 10, 64 * 1024, 200 * 1024 + 7]) {
      const data = randomBytes(size)
      const f = await v.add(Readable.from([data.subarray(0, 1000), data.subarray(1000)]), { name: `doc-${size}.bin` })
      expect(f.sizeBytes).toBe(size)
      const opened = await v.open(f.id)
      expect((await read(opened!.stream)).equals(data)).toBe(true)
    }
    // Nada legible en disco: ni nombres en el índice ni contenido.
    const marker = Buffer.from('SECRETO-NO-DEBE-VERSE')
    const f = await v.add(Readable.from([marker]), { name: 'nombre-privado.txt', tags: ['salud'] })
    expect(readFileSync(join(dir, 'index.enc')).includes(Buffer.from('nombre-privado'))).toBe(false)
    expect(readFileSync(join(dir, 'files', `${f.id}.enc`)).includes(marker)).toBe(false)
    expect((await v.list()).find((x) => x.id === f.id)).toMatchObject({ name: 'nombre-privado.txt', tags: ['salud'] })
  })

  it('detecta un bloque manipulado y un fichero truncado', async () => {
    const v = new EncryptedFiles(dir, key)
    const data = randomBytes(150 * 1024)
    const f = await v.add(Readable.from([data]), { name: 'x.bin' })
    const path = join(dir, 'files', `${f.id}.enc`)
    const orig = readFileSync(path)
    const tampered = Buffer.from(orig)
    tampered[200] = (tampered[200] as number) ^ 1
    writeFileSync(path, tampered)
    await expect(read((await v.open(f.id))!.stream)).rejects.toThrow(/dañado|manipulado/)
    // Truncado justo en un límite de bloque: sin el último bloque marcado → error.
    const firstBlock = 16 + 4 + 64 * 1024 + 16
    writeFileSync(path, orig.subarray(0, firstBlock))
    await expect(read((await v.open(f.id))!.stream)).rejects.toThrow(/truncado/)
  })

  it('otra clave no abre el índice', async () => {
    const other = new EncryptedFiles(dir, randomBytes(32))
    await expect(other.list()).rejects.toThrow()
  })

  it('borra el fichero cifrado al quitarlo', async () => {
    const v = new EncryptedFiles(dir, key)
    const f = await v.add(Readable.from([Buffer.from('a')]), { name: 'b.txt' })
    expect(await v.remove(f.id)).toBe(true)
    expect(readdirSync(join(dir, 'files')).includes(`${f.id}.enc`)).toBe(false)
  })
})
