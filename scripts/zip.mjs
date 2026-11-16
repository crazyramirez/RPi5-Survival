/**
 * Extracción de zip sin dependencias ni programas externos (sin Zip64: los zip de la portable y de BRouter son
 * menores de 4 GiB). La usan la actualización de la portable (portable-admin.mjs) y, en Android, el motor de
 * descargas: el `tar` de Android (toybox) no abre zip.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** Extrae `zipFile` bajo `dest`. Rechaza rutas que salgan de `dest`. `onProgress(n, total)` cada 200 entradas. */
export function extractZip(zipFile, dest, onProgress = () => {}) {
  const buf = readFileSync(zipFile)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip no válido')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const destReal = resolve(dest)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip dañado')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const attrs = buf.readUInt32LE(p + 38)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    const out = resolve(destReal, ...name.split('/'))
    if (!out.startsWith(destReal + sep)) throw new Error(`ruta peligrosa en el zip: ${name}`)
    if (name.endsWith('/')) {
      mkdirSync(out, { recursive: true })
      continue
    }
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null
    if (!data) throw new Error(`compresión no soportada en ${name}`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
    const mode = (attrs >>> 16) & 0o777
    if (process.platform !== 'win32' && mode) chmodSync(out, mode)
    if (n % 200 === 0) onProgress(n, count)
  }
}
