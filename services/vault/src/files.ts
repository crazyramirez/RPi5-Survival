import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type { VaultFile } from '@survival-os/shared-types'
import { mimeFor, safeFileName, sanitizeDate, sanitizeTags } from './policy.ts'

export const MAX_FILE_BYTES = 100 * 1024 * 1024

/** Almacén de documentos dentro del volumen descifrado (raíz = punto de montaje). */
export class VaultFiles {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private get indexPath(): string {
    return join(this.root, 'index.json')
  }

  private filePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('id inválido'), { status: 400 })
    return join(this.root, 'files', id)
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, 'files'), { recursive: true, mode: 0o700 })
    try {
      await stat(this.indexPath)
    } catch {
      await writeFile(this.indexPath, '[]', { mode: 0o600 })
    }
  }

  async list(): Promise<VaultFile[]> {
    try {
      const v = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown
      return Array.isArray(v) ? (v as VaultFile[]) : []
    } catch {
      return []
    }
  }

  private async save(list: VaultFile[]): Promise<void> {
    const tmp = `${this.indexPath}.tmp`
    await writeFile(tmp, JSON.stringify(list, null, 1), { mode: 0o600 })
    await rename(tmp, this.indexPath)
  }

  /** Guarda un flujo como documento nuevo (límite de tamaño y SHA-256 al vuelo). */
  async add(source: Readable, meta: { name: string; tags?: unknown; reviewDate?: unknown }): Promise<VaultFile> {
    const id = randomUUID()
    const dest = this.filePath(id)
    const tmp = `${dest}.part`
    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length
        if (size > MAX_FILE_BYTES) {
          cb(Object.assign(new Error('Documento demasiado grande (máx. 100 MB)'), { status: 413 }))
          return
        }
        hash.update(chunk)
        cb(null, chunk)
      },
    })
    try {
      await pipeline(source, meter, createWriteStream(tmp, { mode: 0o600 }))
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
    await rename(tmp, dest)
    const name = safeFileName(meta.name)
    const file: VaultFile = {
      id,
      name,
      mime: mimeFor(name),
      sizeBytes: size,
      sha256: hash.digest('hex'),
      tags: sanitizeTags(meta.tags),
      reviewDate: sanitizeDate(meta.reviewDate),
      addedAt: new Date().toISOString(),
    }
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
    const path = this.filePath(id) // valida el id antes de tocar nada
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
    return { file, stream: createReadStream(path) }
  }
}
