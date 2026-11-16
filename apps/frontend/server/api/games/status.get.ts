import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GamesStatus } from '@survival-os/shared-types'

const str = (v: unknown): string | null => (typeof v === 'string' && v.length <= 64 ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const slugs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s)).slice(0, 100) : []

/** Estado de la copia offline de Viseni Games (state.json de games-sync.py) y del servidor local. */
export default defineEventHandler(async (): Promise<GamesStatus> => {
  const cfg = useRuntimeConfig()
  const dir = String(cfg.gamesDir)
  const url = String(cfg.gamesUrl)
  let st: Record<string, unknown> = {}
  try {
    const j: unknown = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'))
    if (j && typeof j === 'object' && !Array.isArray(j)) st = j as Record<string, unknown>
  } catch {
    // sin descargar
  }
  const installed = (await fs.stat(join(dir, 'current', 'index.html')).then((s) => s.isFile(), () => false)) && Object.keys(st).length > 0
  let available = false
  let reason: string | null = null
  if (!installed) reason = 'Juegos no descargados (Sistema → Mantenimiento → Juegos offline)'
  else {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
      available = res.ok
      if (!available) reason = `El servidor de juegos respondió ${res.status}`
    } catch {
      reason = 'El servidor de juegos no responde'
    }
  }
  const external = Array.isArray(st.external)
    ? (st.external as unknown[])
        .filter((e): e is { file: string; url: string } => !!e && typeof (e as { file?: unknown }).file === 'string' && typeof (e as { url?: unknown }).url === 'string')
        .slice(0, 50)
        .map((e) => ({ file: e.file.slice(0, 200), url: e.url.slice(0, 300) }))
    : []
  return {
    available,
    installed,
    reason,
    url,
    installedAt: str(st.installedAt),
    manifestGeneratedAt: str(st.manifestGeneratedAt),
    files: num(st.files),
    bytes: num(st.bytes),
    games: slugs(st.games),
    incompleteGames: slugs(st.incompleteGames),
    failedFiles: Array.isArray(st.failed) ? st.failed.length : 0,
    external,
  }
})
