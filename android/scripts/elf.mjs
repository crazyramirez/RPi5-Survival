/**
 * Lectura y parcheo mínimo de ELF de 64 bits little-endian (arm64-v8a, x86_64) para empaquetar binarios en el APK
 * (ADR 0020). Sin dependencias: se prueba en apps/frontend/test/android-natives.test.ts.
 *
 * Android solo extrae del APK los ficheros `lib*.so` de jniLibs/<abi>/, y son los únicos que una app puede
 * ejecutar (W^X desde Android 10). Las bibliotecas con soname versionado (`libssl.so.3`) se renombran
 * (`libssl3.so`) y se reescriben en su sitio DT_NEEDED y DT_SONAME de todos los ELF: el nombre nuevo nunca es
 * más largo, así que la tabla de cadenas no cambia de tamaño.
 */

const DT_NULL = 0
const DT_NEEDED = 1
const DT_STRTAB = 5
const DT_STRSZ = 10
const DT_SONAME = 14
const DT_RPATH = 15
const DT_RUNPATH = 29
const PT_LOAD = 1
const PT_DYNAMIC = 2
const PT_INTERP = 3

export const EM_AARCH64 = 183
export const EM_X86_64 = 62

/** ¿Es un ELF? */
export function isElf(buf) {
  return buf.length > 64 && buf.readUInt32BE(0) === 0x7f454c46
}

function cstr(buf, off) {
  let end = off
  while (end < buf.length && buf[end] !== 0) end++
  return buf.toString('latin1', off, end)
}

/**
 * Cabecera, segmentos y sección dinámica. Lanza si no es ELF64 LE.
 * → { machine, type, interp, loads[{offset,vaddr,filesz,align}], needed[{name,strOff}], soname, runpath, dyn }
 */
export function parseElf(buf) {
  if (!isElf(buf)) throw new Error('no es un ELF')
  if (buf[4] !== 2 || buf[5] !== 1) throw new Error('solo ELF64 little-endian')
  const type = buf.readUInt16LE(0x10)
  const machine = buf.readUInt16LE(0x12)
  const phoff = Number(buf.readBigUInt64LE(0x20))
  const phentsize = buf.readUInt16LE(0x36)
  const phnum = buf.readUInt16LE(0x38)
  const loads = []
  let dynamic = null
  let interp = null
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    const pt = buf.readUInt32LE(o)
    const offset = Number(buf.readBigUInt64LE(o + 8))
    const vaddr = Number(buf.readBigUInt64LE(o + 16))
    const filesz = Number(buf.readBigUInt64LE(o + 32))
    const align = Number(buf.readBigUInt64LE(o + 48))
    if (pt === PT_LOAD) loads.push({ offset, vaddr, filesz, align })
    if (pt === PT_DYNAMIC) dynamic = { offset, filesz }
    if (pt === PT_INTERP) interp = cstr(buf, offset)
  }
  const out = { machine, type, interp, loads, needed: [], soname: null, runpath: null, dyn: [] }
  if (!dynamic) return out
  const entries = []
  for (let o = dynamic.offset; o + 16 <= dynamic.offset + dynamic.filesz; o += 16) {
    const tag = Number(buf.readBigInt64LE(o))
    const val = Number(buf.readBigUInt64LE(o + 8))
    if (tag === DT_NULL) break
    entries.push({ tag, val, at: o })
  }
  out.dyn = entries
  const strtabVaddr = entries.find((e) => e.tag === DT_STRTAB)?.val
  const strsz = entries.find((e) => e.tag === DT_STRSZ)?.val ?? 0
  if (strtabVaddr === undefined) return out
  const strtab = vaddrToOffset(loads, strtabVaddr)
  out.strtab = { offset: strtab, size: strsz }
  for (const e of entries) {
    if (e.tag === DT_NEEDED) out.needed.push({ name: cstr(buf, strtab + e.val), strOff: strtab + e.val })
    if (e.tag === DT_SONAME) out.soname = { name: cstr(buf, strtab + e.val), strOff: strtab + e.val }
    if (e.tag === DT_RUNPATH || e.tag === DT_RPATH) {
      out.runpath = cstr(buf, strtab + e.val)
      out.runpathStr = { strOff: strtab + e.val, tagAt: e.at, tag: e.tag }
    }
  }
  return out
}

function vaddrToOffset(loads, vaddr) {
  for (const l of loads) if (vaddr >= l.vaddr && vaddr < l.vaddr + l.filesz) return vaddr - l.vaddr + l.offset
  throw new Error(`dirección 0x${vaddr.toString(16)} fuera de los segmentos`)
}

/**
 * Nombre válido para jniLibs: `lib*.so`. Los sonames versionados pierden los puntos de la versión
 * (`libicuuc.so.78` → `libicuuc78.so`, `libz.so.1.3` → `libz13.so`), así nunca son más largos.
 */
export function androidLibName(soname) {
  if (/^lib[\w+-]+(\.[\w+-]+)*\.so$/.test(soname) && !/\.so\.\d/.test(soname)) return soname
  const m = /^(lib[\w+.-]+?)\.so((?:\.\w+)+)$/.exec(soname)
  if (!m) throw new Error(`soname no reconocido: ${soname}`)
  return `${m[1]}${m[2].replace(/\./g, '')}.so`
}

/** Escribe `name` en lugar de la cadena de `strOff` (mismo tamaño o menor). */
function rewriteString(buf, strOff, oldName, name) {
  if (name === oldName) return false
  if (Buffer.byteLength(name, 'latin1') > Buffer.byteLength(oldName, 'latin1')) throw new Error(`${name} es más largo que ${oldName}`)
  buf.fill(0, strOff, strOff + oldName.length + 1)
  buf.write(name, strOff, 'latin1')
  return true
}

/**
 * Renombra DT_NEEDED y DT_SONAME según `map` (soname original → nombre Android). Devuelve el número de cambios.
 * Las cadenas de DT_NEEDED también las usa .gnu.version_r (vn_file), que apunta al mismo desplazamiento.
 */
export function patchElf(buf, map) {
  const info = parseElf(buf)
  let changes = 0
  for (const n of info.needed) {
    const to = map.get(n.name)
    if (to && rewriteString(buf, n.strOff, n.name, to)) changes++
  }
  if (info.soname) {
    const to = map.get(info.soname.name)
    if (to && rewriteString(buf, info.soname.strOff, info.soname.name, to)) changes++
  }
  return changes
}

/**
 * DT_RUNPATH → `$ORIGIN`: el enlazador de Android busca las bibliotecas junto al ejecutable aunque no le llegue
 * LD_LIBRARY_PATH (p. ej. bajo la traducción ARM de los emuladores x86). Termux deja aquí su prefijo
 * (/data/data/com.termux/files/usr/lib), que es más largo, así que se reescribe en su sitio. Si el ELF no tiene
 * RUNPATH no se toca (no hay hueco para añadirlo): devuelve false.
 */
export function setRunpathOrigin(buf) {
  const info = parseElf(buf)
  if (!info.runpathStr) return false
  const want = '$ORIGIN'
  if (info.runpath === want) return true
  if (info.runpath.length < want.length) return false
  // DT_RPATH (obsoleto) → DT_RUNPATH, que es el que bionic respeta junto a LD_LIBRARY_PATH.
  if (info.runpathStr.tag === DT_RPATH) buf.writeBigInt64LE(BigInt(DT_RUNPATH), info.runpathStr.tagAt)
  return rewriteString(buf, info.runpathStr.strOff, info.runpath, want)
}

/** Alineación mínima de los segmentos cargables (16 KB = válido en dispositivos con páginas de 16 KB). */
export function minLoadAlign(info) {
  return Math.min(...info.loads.map((l) => l.align))
}

/** Bibliotecas del sistema Android que una app puede enlazar (NDK, API pública). */
export const SYSTEM_LIBS = new Set([
  'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libz.so', 'libandroid.so', 'libEGL.so', 'libGLESv2.so', 'libGLESv3.so',
  'libvulkan.so', 'libjnigraphics.so', 'libmediandk.so', 'libOpenSLES.so', 'libaaudio.so', 'libnativewindow.so', 'libsync.so',
  'libbinder_ndk.so', 'libneuralnetworks.so', 'libcamera2ndk.so', 'libicu.so', 'libstdc++.so',
])
