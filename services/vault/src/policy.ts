/**
 * Reglas puras de la bóveda (testeables sin cryptsetup).
 */

/**
 * Equipo personal (decisión del usuario, ADR 0013): se admiten contraseñas cortas e incluso PIN
 * numéricos. Solo se rechazan las triviales. La interfaz avisa de que una contraseña débil NO protege
 * frente al robo de la microSD (ataque offline); el límite de intentos solo frena la pantalla.
 */
export const MIN_PASSPHRASE_LENGTH = 4

/** Contraseñas triviales que no se aceptan: un solo carácter repetido o secuencias de teclado. */
const BANNED = [/^(.)\1+$/, /^(0123456789|1234567890|qwertyuiop|abcdefghij)/i, /^(?:contrase(?:n|ñ)a|password|survival)\d*$/i]

/** true si los dígitos forman una secuencia ascendente o descendente (1234, 98765). */
function isDigitRun(p: string): boolean {
  if (!/^\d+$/.test(p)) return false
  const d = [...p].map(Number)
  const step = (d[1] ?? 0) - (d[0] ?? 0)
  return Math.abs(step) === 1 && d.every((v, i) => i === 0 || v - (d[i - 1] ?? 0) === step)
}

/** Devuelve el motivo de rechazo o null si la contraseña es aceptable. */
export function passphraseProblem(p: string): string | null {
  if (typeof p !== 'string') return 'Contraseña no válida'
  if ([...p].length < MIN_PASSPHRASE_LENGTH) return `Mínimo ${MIN_PASSPHRASE_LENGTH} caracteres`
  if ([...p].length > 512) return 'Máximo 512 caracteres'
  if (BANNED.some((re) => re.test(p)) || isDigitRun(p)) return 'Contraseña demasiado previsible'
  if (normalizeRecoveryKey(p)) return 'No uses el formato de la clave de recuperación como contraseña'
  return null
}

/**
 * Contraseña débil frente a un ataque offline (contenedor copiado): corta, solo dígitos o de una
 * sola clase de caracteres sin ser frase. Se acepta, pero la interfaz lo advierte.
 */
export function passphraseIsWeak(p: string): boolean {
  if ([...p].length < 12 || /^\d+$/.test(p)) return true
  const classes = [/[a-zñáéíóúü]/, /[A-ZÑÁÉÍÓÚÜ]/, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(p)).length
  return classes < 2 && p.trim().split(/\s+/).length < 4
}

// ------------------------------------------------------------------ Clave de recuperación

/** Base32 de Crockford: sin I, L, O ni U (se confunden al copiar a mano). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RK_CHARS = 32 // 32 × 5 bits = 160 bits de entropía
const RK_GROUP = 4

/** Clave de recuperación aleatoria «XXXX-XXXX-…» (8 grupos de 4). `bytes` debe ser aleatorio criptográfico. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length < 20) throw new Error('Se necesitan 20 bytes aleatorios')
  let bits = 0
  let acc = 0
  let out = ''
  for (const b of bytes.subarray(0, 20)) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  return out.match(new RegExp(`.{${RK_GROUP}}`, 'g'))!.join('-')
}

/**
 * Normaliza lo que escribe el usuario (minúsculas, espacios, guiones, O→0, I/L→1) a la forma
 * canónica con la que se registró en LUKS. Devuelve null si no es una clave de recuperación válida.
 */
export function normalizeRecoveryKey(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== RK_CHARS || [...s].some((c) => !CROCKFORD.includes(c))) return null
  return s.match(new RegExp(`.{${RK_GROUP}}`, 'g'))!.join('-')
}

/** Keyslots activos según la salida de `cryptsetup luksDump` (LUKS2). */
export function parseKeyslots(dump: string): number[] {
  const slots: number[] = []
  let inside = false
  for (const line of dump.split(/\r?\n/)) {
    if (/^Keyslots:/.test(line)) inside = true
    else if (/^\S/.test(line)) inside = false
    else if (inside) {
      const m = /^\s+(\d+): luks2\b/.exec(line)
      if (m) slots.push(Number(m[1]))
    }
  }
  return slots
}

/** Número de keyslot que informa `cryptsetup open --test-passphrase -v` ("Key slot 1 unlocked."). */
export function parseUnlockedSlot(output: string): number | null {
  const m = /Key slot (\d+) unlocked/i.exec(output)
  return m ? Number(m[1]) : null
}

/**
 * Espera tras fallos consecutivos: 0 s para los 3 primeros, luego 2^(n-3) s hasta 15 min.
 * Ralentiza ataques por la interfaz; NO sustituye a la KDF (Argon2id) frente a ataques offline.
 */
export function backoffSeconds(failures: number): number {
  if (failures <= 3) return 0
  return Math.min(900, 2 ** (failures - 3))
}

export function retryAfter(failures: number, lastFailureAt: number | null, now: number): number {
  if (!lastFailureAt) return 0
  const wait = backoffSeconds(failures) * 1000 - (now - lastFailureAt)
  return wait > 0 ? Math.ceil(wait / 1000) : 0
}

/** Nombre de fichero seguro para mostrar/guardar (sin rutas ni caracteres de control). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/^\.+/, '').trim().slice(0, 120)
  return cleaned || 'documento'
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
}

/** Tipo MIME por extensión (lista cerrada; lo demás se sirve como descarga binaria). */
export function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [...new Set(input.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, 10)
}

export function sanitizeDate(input: unknown): string | null {
  return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(input)) ? input : null
}

/** Ruta relativa dentro de un medio extraíble: sin "..", sin absolutas. */
export function safeRelative(p: string): boolean {
  return typeof p === 'string' && p.length > 0 && p.length < 1024 && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '')
}
