import { execFile } from 'node:child_process'
import { readFile, readdir, access } from 'node:fs/promises'

/** Lee un fichero de texto; devuelve null si no existe o no es legible. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function readBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export type RunResult = { ok: true; stdout: string } | { ok: false; reason: string }

/**
 * Ejecuta un binario SIN shell, con timeout y salida acotada.
 * Nunca lanza excepciones: devuelve un resultado tipado.
 */
export function run(cmd: string, args: string[], timeoutMs = 2000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          resolve({ ok: false, reason: code === 'ENOENT' ? `${cmd} no instalado` : `${cmd} falló` })
          return
        }
        resolve({ ok: true, stdout: String(stdout) })
      },
    )
  })
}
