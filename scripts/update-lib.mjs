/**
 * Actualizaciones desde GitHub Releases (ADR 0021): funciones puras, sin E/S de red. Las usan el motor
 * (update-engine.mjs: Pi, portable y Android), la publicación (release-publish.mjs) y los tests.
 *
 * Contrato de una release:
 *   survival-os-update.json       manifiesto (versión, notas, ficheros con tamaño y SHA-256)
 *   survival-os-update.json.sig   {"alg":"ed25519","keyId":"…","sig":"<base64>"} sobre los BYTES exactos del manifiesto
 * Una instalación solo acepta manifiestos firmados con una clave de TRUSTED_KEYS.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'

export const REPO = 'crazyramirez/Survivelia-OS'
export const MANIFEST_NAME = 'survival-os-update.json'
export const SIG_NAME = `${MANIFEST_NAME}.sig`
/** Última release publicada (redirección de GitHub, sin API ni límite de peticiones). */
export const LATEST_BASE = `https://github.com/${REPO}/releases/latest/download`
/** Ficheros de una etiqueta concreta (no cambian aunque se publique otra versión mientras se descarga). */
export const tagBase = (tag) => `https://github.com/${REPO}/releases/download/${tag}`

/**
 * Claves públicas Ed25519 de confianza (32 bytes en base64url, como «x» de una JWK). La privada vive solo en el
 * equipo de quien publica (~/.survival-os/update-signing-key.pem). Para rotar: publicar primero una versión que
 * ya lleve aquí la clave nueva y, después, firmar con ella.
 */
export const TRUSTED_KEYS = Object.freeze({
  'survival-2026-11': 'XNjxY1scmfOYb6l6nwCFsQDjoTXPw7ffdsllKmSMsY0',
})

export const MODES = ['auto', 'notify', 'off']
export const LANGS = ['es', 'en', 'fr', 'it']
/** Plataformas de los ficheros. system = tarball de la Pi/Linux con systemd; portable = carpeta; android = APK. */
export const KINDS = ['system', 'portable', 'android']
export const PORTABLE_TARGETS = ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']
/** Intervalo mínimo entre comprobaciones automáticas (las manuales, siempre). */
export const CHECK_EVERY_MS = 20 * 3600 * 1000
/** Al abrir la app o volver a primer plano: como mucho una comprobación cada 10 min (sin red, ni se anota). */
export const WAKE_EVERY_MS = 10 * 60 * 1000

// ------------------------------------------------------------------ versiones

/** «0.10.0» → [0, 10, 0]; cualquier otra cosa (prefijos, sufijos, ceros a la izquierda) → null. */
export function parseVersion(v) {
  const m = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.exec(typeof v === 'string' ? v.trim() : '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** <0 si a<b, 0 si iguales, >0 si a>b. Lanza con versiones no válidas. */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`versión no válida: ${pa ? b : a}`)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

// ------------------------------------------------------------------ firma

const toB64url = (buf) => Buffer.from(buf).toString('base64url')

function publicKeyFrom(x) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })
}

/** Par de claves nuevo: { privatePem, publicX } (publicX va en TRUSTED_KEYS). */
export function generateSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicX: publicKey.export({ format: 'jwk' }).x,
  }
}

/** Clave pública (x) de una privada PEM: para comprobar que coincide con TRUSTED_KEYS antes de publicar. */
export function publicXOf(privatePem) {
  return createPublicKey(createPrivateKey(privatePem)).export({ format: 'jwk' }).x
}

/** Firma los bytes del manifiesto → texto del .sig. */
export function signManifest(bytes, privatePem, keyId) {
  const sig = sign(null, Buffer.from(bytes), createPrivateKey(privatePem))
  return `${JSON.stringify({ alg: 'ed25519', keyId, sig: toB64url(sig) })}\n`
}

/**
 * Verifica la firma del manifiesto con las claves dadas (por defecto, las de confianza).
 * → { ok: true, keyId } | { ok: false, error }
 */
export function verifyManifest(bytes, sigText, keys = TRUSTED_KEYS) {
  let s
  try {
    s = JSON.parse(String(sigText))
  } catch {
    return { ok: false, error: 'firma ilegible' }
  }
  if (!s || s.alg !== 'ed25519' || typeof s.keyId !== 'string' || typeof s.sig !== 'string') return { ok: false, error: 'firma con formato desconocido' }
  const x = Object.hasOwn(keys, s.keyId) ? keys[s.keyId] : null
  if (!x || x === '__PUBLIC_KEY__') return { ok: false, error: `clave desconocida: ${s.keyId.slice(0, 40)}` }
  let good = false
  try {
    good = verify(null, Buffer.from(bytes), publicKeyFrom(x), Buffer.from(s.sig, 'base64url'))
  } catch {
    good = false
  }
  return good ? { ok: true, keyId: s.keyId } : { ok: false, error: 'firma no válida' }
}

// ------------------------------------------------------------------ manifiesto

const ASSET_NAME_RE = /^survival-os-\d+\.\d+\.\d+(-[a-z0-9+_-]+)?\.(tar\.gz|zip|apk)$/
const PLATFORM_RE = /^(linux|win|darwin|android)-(x64|arm64)$/

/** Valida y normaliza un manifiesto ya parseado. Lanza Error con el motivo. Nada sin validar pasa. */
export function validateManifest(m) {
  const fail = (msg) => {
    throw new Error(`manifiesto no válido: ${msg}`)
  }
  if (!m || typeof m !== 'object') fail('no es un objeto')
  if (m.schema !== 1) fail(`esquema ${String(m.schema)} no soportado`)
  if (!parseVersion(m.version)) fail('versión')
  if (m.tag !== `v${m.version}`) fail('etiqueta')
  if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) fail('fecha')
  if (!parseVersion(m.minFrom) || compareVersions(m.minFrom, m.version) > 0) fail('minFrom')
  if (m.commit !== undefined && (typeof m.commit !== 'string' || !/^[0-9a-f]{40}$/.test(m.commit))) fail('commit')
  const notes = {}
  if (m.notes !== undefined) {
    if (!m.notes || typeof m.notes !== 'object') fail('notas')
    for (const [k, v] of Object.entries(m.notes)) {
      if (!LANGS.includes(k) || typeof v !== 'string' || v.length > 20_000) fail(`notas (${k})`)
      notes[k] = v
    }
  }
  if (!Array.isArray(m.assets) || m.assets.length === 0 || m.assets.length > 40) fail('ficheros')
  const assets = m.assets.map((a, i) => {
    if (!a || typeof a !== 'object') fail(`fichero ${i}`)
    if (typeof a.name !== 'string' || !ASSET_NAME_RE.test(a.name) || !a.name.includes(`-${m.version}`)) fail(`nombre ${i}`)
    if (!KINDS.includes(a.kind)) fail(`tipo de ${a.name}`)
    if (!Array.isArray(a.platforms) || !a.platforms.length || a.platforms.some((p) => typeof p !== 'string' || !PLATFORM_RE.test(p))) fail(`plataformas de ${a.name}`)
    if (!Number.isSafeInteger(a.size) || a.size <= 0 || a.size >= 4 * 1024 ** 3) fail(`tamaño de ${a.name}`)
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) fail(`sha256 de ${a.name}`)
    return { name: a.name, kind: a.kind, platforms: [...a.platforms], size: a.size, sha256: a.sha256 }
  })
  if (new Set(assets.map((a) => a.name)).size !== assets.length) fail('nombres repetidos')
  return { schema: 1, version: m.version, tag: m.tag, date: m.date, minFrom: m.minFrom, commit: m.commit ?? null, notes, assets }
}

/** Parsea y valida los bytes del manifiesto (tras verificar su firma). */
export function parseManifest(bytes) {
  let obj
  try {
    obj = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new Error('manifiesto no válido: JSON ilegible')
  }
  return validateManifest(obj)
}

/**
 * Fichero para esta instalación:
 *   system   → el tarball que declare la plataforma (linux-arm64 / linux-x64);
 *   android  → el APK de la arquitectura;
 *   portable → el zip MÁS PEQUEÑO que contenga todos los sistemas que ya lleva esta carpeta (`runtimes`) y el
 *              actual: una memoria USB para todos los sistemas sigue sirviendo en todos tras actualizarse.
 */
export function pickAsset(manifest, { kind, platform, runtimes = [] }) {
  const need = kind === 'portable' ? [...new Set([platform, ...runtimes])] : [platform]
  const fits = manifest.assets.filter((a) => a.kind === kind && need.every((p) => a.platforms.includes(p)))
  fits.sort((a, b) => a.size - b.size)
  return fits[0] ?? null
}

/**
 * ¿Qué hacer con este manifiesto?
 *   up-to-date      la instalada es la última
 *   newer-installed la instalada es más nueva (desarrollo): nunca se baja de versión
 *   available       hay versión nueva y fichero para esta plataforma
 *   no-asset        hay versión nueva, pero no para esta plataforma
 *   needs-step      la instalada es anterior a minFrom: hay que pasar antes por una intermedia (a mano)
 */
export function decide(manifest, { installed, kind, platform, runtimes = [] }) {
  const cmp = compareVersions(manifest.version, installed)
  if (cmp === 0) return { status: 'up-to-date', asset: null }
  if (cmp < 0) return { status: 'newer-installed', asset: null }
  if (compareVersions(installed, manifest.minFrom) < 0) return { status: 'needs-step', asset: null }
  const asset = pickAsset(manifest, { kind, platform, runtimes })
  return asset ? { status: 'available', asset } : { status: 'no-asset', asset: null }
}

/** Notas en el idioma pedido; si no hay, en español; si no, en inglés; si no, las primeras. */
export function pickNotes(notes, lang) {
  if (!notes) return null
  return notes[lang] ?? notes.es ?? notes.en ?? Object.values(notes)[0] ?? null
}

// ------------------------------------------------------------------ ajustes y momento seguro

/** Modo por defecto: la portable de escritorio se aplica al cerrar (no interrumpe); Pi y Android avisan. */
export function defaultMode(kind) {
  return kind === 'portable' ? 'auto' : 'notify'
}

/** Ajustes guardados (JSON ya parseado o null) → { mode }. Valores desconocidos → por defecto. */
export function normalizeSettings(raw, kind) {
  const mode = raw && MODES.includes(raw.mode) ? raw.mode : defaultMode(kind)
  return { mode }
}

/** Ventana de instalación automática en la Pi: de 02:00 a 05:59 (hora local). */
export function inInstallWindow(date = new Date()) {
  const h = date.getHours()
  return h >= 2 && h < 6
}

/**
 * ¿Toca comprobar sola? Manual siempre; automática si nunca se comprobó bien o hace más de `every`
 * (CHECK_EVERY_MS para el temporizador, WAKE_EVERY_MS al abrir la app o volver a primer plano).
 */
export function checkDue(state, now = Date.now(), force = false, every = CHECK_EVERY_MS) {
  if (force) return true
  const last = Date.parse(state?.okAt ?? '')
  return !Number.isFinite(last) || now - last >= every || last > now + 3600_000
}
