import { argon2, createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { VaultFile } from '@survival-os/shared-types'
import { MAX_FILE_BYTES } from './files.ts'
import { mimeFor, safeFileName, sanitizeDate, sanitizeTags } from './policy.ts'

/**
 * Bóveda de la versión portable (ADR 0016): sin LUKS (no existe en Windows/macOS ni sin root).
 * - Clave maestra aleatoria de 256 bits. Cada secreto (contraseña, clave de recuperación) tiene un
 *   keyslot: la clave maestra cifrada con AES-256-GCM bajo una KEK derivada con Argon2id (256 MiB, como
 *   la Pi). Recuperar/regenerar = añadir y quitar keyslots, igual que en LUKS.
 * - Documentos cifrados por bloques de 64 KiB (AES-256-GCM, nonce por bloque, AAD = id + nº de bloque +
 *   marca de último bloque: se detectan bloques cambiados, reordenados o un fichero truncado).
 * - Índice (nombres, etiquetas, fechas) cifrado. Lo que queda visible en disco: número y tamaño
 *   aproximado de los ficheros (LUKS oculta también eso; límite declarado en el ADR).
 */

export const KDF = { memory: 262_144, passes: 3, parallelism: 4 }
const CHUNK = 64 * 1024
const MAGIC = Buffer.from('SVF1')

export interface Keyslot {
  id: string
  kind: 'passphrase' | 'recovery'
  salt: string
  iv: string
  ct: string
  tag: string
}
export interface Header {
  format: 'survival-vault-portable'
  version: 1
  createdAt: string
  kdf: { alg: 'argon2id' } & typeof KDF
  slots: Keyslot[]
}

const b64 = (b: Buffer): string => b.toString('base64')
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64')

export function deriveKek(secret: string, salt: Buffer, kdf = KDF): Promise<Buffer> {
  return new Promise((ok, ko) =>
    argon2('argon2id', { message: Buffer.from(secret, 'utf8'), nonce: salt, parallelism: kdf.parallelism, tagLength: 32, memory: kdf.memory, passes: kdf.passes }, (err, key) =>
      err ? ko(err) : ok(Buffer.from(key)),
    ),
  )
}

export async function makeSlot(master: Buffer, secret: string, kind: Keyslot['kind'], kdf = KDF): Promise<Keyslot> {
  const salt = randomBytes(16)
  const kek = await deriveKek(secret, salt, kdf)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', kek, iv)
  c.setAAD(Buffer.from(`survival-vault-keyslot-v1:${kind}`))
  const ct = Buffer.concat([c.update(master), c.final()])
  kek.fill(0)
  return { id: randomUUID(), kind, salt: b64(salt), iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) }
}

/** Clave maestra si `secret` abre el keyslot; null si no (sin distinguir por qué). */
export async function openSlot(slot: Keyslot, secret: string, kdf = KDF): Promise<Buffer | null> {
  const kek = await deriveKek(secret, unb64(slot.salt), kdf)
  try {
    const d = createDecipheriv('aes-256-gcm', kek, unb64(slot.iv))
    d.setAAD(Buffer.from(`survival-vault-keyslot-v1:${slot.kind}`))
    d.setAuthTag(unb64(slot.tag))
    return Buffer.concat([d.update(unb64(slot.ct)), d.final()])
  } catch {
    return null
  } finally {
    kek.fill(0)
  }
}

/** Primer keyslot que abre `secret` (prueba todos, como LUKS). */
export async function findSlot(h: Header, secret: string): Promise<{ slot: Keyslot; master: Buffer } | null> {
  for (const slot of h.slots) {
    const master = await openSlot(slot, secret, h.kdf)
    if (master) return { slot, master }
  }
  return null
}

// ------------------------------------------------------------------ cifrado por bloques

function nonceFor(base: Buffer, counter: number): Buffer {
  const n = Buffer.from(base)
  n.writeUInt32BE((n.readUInt32BE(8) ^ counter) >>> 0, 8)
  return n
}
function aadFor(id: string, counter: number, last: boolean): Buffer {
  return Buffer.from(`${id}:${counter}:${last ? 1 : 0}`)
}

/** Cifra un flujo en formato SVF1. Devuelve tamaño y SHA-256 del texto en claro. */
async function* encryptStream(src: AsyncIterable<Buffer>, key: Buffer, id: string, meter: (n: number) => void): AsyncGenerator<Buffer> {
  const base = randomBytes(12)
  yield Buffer.concat([MAGIC, base])
  let pending = Buffer.alloc(0)
  let counter = 0
  const seal = (plain: Buffer, last: boolean): Buffer => {
    const c = createCipheriv('aes-256-gcm', key, nonceFor(base, counter))
    c.setAAD(aadFor(id, counter, last))
    const ct = Buffer.concat([c.update(plain), c.final()])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(ct.length)
    counter++
    return Buffer.concat([len, ct, c.getAuthTag()])
  }
  for await (const chunk of src) {
    meter(chunk.length)
    pending = Buffer.concat([pending, chunk])
    // Se retiene siempre al menos un bloque: el último debe sellarse con la marca «last».
    while (pending.length > CHUNK) {
      yield seal(pending.subarray(0, CHUNK), false)
      pending = pending.subarray(CHUNK)
    }
  }
  yield seal(pending, true)
}

/** Descifra SVF1; lanza si algún bloque no autentica o el fichero está truncado. */
async function* decryptStream(src: AsyncIterable<Buffer>, key: Buffer, id: string): AsyncGenerator<Buffer> {
  let buf = Buffer.alloc(0)
  let base: Buffer | null = null
  let counter = 0
  let sawLast = false
  for await (const chunk of src) {
    buf = Buffer.concat([buf, chunk])
    if (!base) {
      if (buf.length < 16) continue
      if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Formato de documento desconocido')
      base = buf.subarray(4, 16)
      buf = buf.subarray(16)
    }
    for (;;) {
      if (buf.length < 4) break
      const len = buf.readUInt32BE(0)
      if (len > CHUNK) throw new Error('Bloque dañado')
      if (buf.length < 4 + len + 16) break
      const ct = buf.subarray(4, 4 + len)
      const tag = buf.subarray(4 + len, 4 + len + 16)
      buf = buf.subarray(4 + len + 16)
      if (sawLast) throw new Error('Datos tras el último bloque')
      // Se prueba primero como bloque intermedio; si no autentica, como último.
      let plain: Buffer | null = null
      for (const last of [false, true]) {
        try {
          const d = createDecipheriv('aes-256-gcm', key, nonceFor(base, counter))
          d.setAAD(aadFor(id, counter, last))
          d.setAuthTag(tag)
          plain = Buffer.concat([d.update(ct), d.final()])
          sawLast = last
          break
        } catch {
          // siguiente intento
        }
      }
      if (!plain) throw new Error('Documento dañado o manipulado')
      counter++
      if (plain.length) yield plain
    }
  }
  if (!sawLast || buf.length) throw new Error('Documento truncado')
}

function sealBlob(key: Buffer, label: string, data: Buffer): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(label))
  const ct = Buffer.concat([c.update(data), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}
function openBlob(key: Buffer, label: string, blob: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
  d.setAAD(Buffer.from(label))
  d.setAuthTag(blob.subarray(12, 28))
  return Buffer.concat([d.update(blob.subarray(28)), d.final()])
}

/** Misma interfaz que VaultFiles (files.ts), cifrando con la clave maestra. */
export class EncryptedFiles {
  private readonly root: string
  private readonly key: Buffer
  constructor(root: string, key: Buffer) {
    this.root = root
    this.key = key
  }
  private get indexPath(): string {
    return join(this.root, 'index.enc')
  }
  private filePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('id inválido'), { status: 400 })
    return join(this.root, 'files', `${id}.enc`)
  }
  async init(): Promise<void> {
    await mkdir(join(this.root, 'files'), { recursive: true, mode: 0o700 })
    try {
      await stat(this.indexPath)
    } catch {
      await this.save([])
    }
  }
  async list(): Promise<VaultFile[]> {
    const v = JSON.parse(openBlob(this.key, 'survival-vault-index-v1', await readFile(this.indexPath)).toString('utf8')) as unknown
    return Array.isArray(v) ? (v as VaultFile[]) : []
  }
  private async save(list: VaultFile[]): Promise<void> {
    const tmp = `${this.indexPath}.tmp`
    await writeFile(tmp, sealBlob(this.key, 'survival-vault-index-v1', Buffer.from(JSON.stringify(list))), { mode: 0o600 })
    await rename(tmp, this.indexPath)
  }
  async add(source: Readable, meta: { name: string; tags?: unknown; reviewDate?: unknown }): Promise<VaultFile> {
    const id = randomUUID()
    const dest = this.filePath(id)
    const tmp = `${dest}.part`
    const hash = createHash('sha256')
    let size = 0
    const hashed = (async function* (): AsyncGenerator<Buffer> {
      for await (const c of source) {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array)
        hash.update(b)
        yield b
      }
    })()
    const out = createWriteStream(tmp, { mode: 0o600 })
    try {
      for await (const block of encryptStream(hashed, this.key, id, (n) => {
        size += n
        if (size > MAX_FILE_BYTES) throw Object.assign(new Error('Documento demasiado grande (máx. 100 MB)'), { status: 413 })
      })) {
        if (!out.write(block)) await new Promise<void>((r) => out.once('drain', () => r()))
      }
      await new Promise<void>((ok, ko) => out.end((err?: Error | null) => (err ? ko(err) : ok())))
    } catch (err) {
      out.destroy()
      await rm(tmp, { force: true })
      throw err
    }
    await rename(tmp, dest)
    const name = safeFileName(meta.name)
    const file: VaultFile = { id, name, mime: mimeFor(name), sizeBytes: size, sha256: hash.digest('hex'), tags: sanitizeTags(meta.tags), reviewDate: sanitizeDate(meta.reviewDate), addedAt: new Date().toISOString() }
    const list = await this.list()
    list.push(file)
    await this.save(list)
    return file
  }
  async update(id: string, patch: { name?: unknown; tags?: unknown; reviewDate?: unknown }): Promise<VaultFile | null> {
    const list = await this.list()
    const f = list.find((x) => x.id === id)
    if (!f) return null
    if (typeof patch.name === 'string') {
      f.name = safeFileName(patch.name)
      f.mime = mimeFor(f.name)
    }
    if (patch.tags !== undefined) f.tags = sanitizeTags(patch.tags)
    if (patch.reviewDate !== undefined) f.reviewDate = sanitizeDate(patch.reviewDate)
    await this.save(list)
    return f
  }
  async remove(id: string): Promise<boolean> {
    const path = this.filePath(id)
    const list = await this.list()
    const next = list.filter((f) => f.id !== id)
    if (next.length === list.length) return false
    await rm(path, { force: true })
    await this.save(next)
    return true
  }
  async open(id: string): Promise<{ file: VaultFile; stream: Readable } | null> {
    const path = this.filePath(id)
    const file = (await this.list()).find((f) => f.id === id)
    if (!file) return null
    return { file, stream: Readable.from(decryptStream(createReadStream(path) as AsyncIterable<Buffer>, this.key, id)) }
  }
}

/** Comparación en tiempo constante (para la confirmación de descarte). */
export const sameText = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
