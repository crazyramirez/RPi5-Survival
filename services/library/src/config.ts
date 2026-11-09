import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export interface LibraryConfig {
  host: string
  port: number
  dataDir: string
  docsDir: string
  dbPath: string
  protocolsDir: string
  kiwixUrl: string
  llmUrl: string
  maxDocBytes: number
}

const here = dirname(fileURLToPath(import.meta.url))
// src/ o dist/ → raíz de la release o del repo.
const appRoot = resolve(here, '..', '..', '..')

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LibraryConfig {
  const dataDir = env.LIBRARY_DATA_DIR || (process.platform === 'linux' ? '/var/lib/survival-os/library' : resolve(appRoot, '.data/library'))
  const port = Number.parseInt(env.LIBRARY_PORT ?? '', 10)
  return {
    host: env.LIBRARY_HOST || '127.0.0.1',
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 8782,
    dataDir,
    docsDir: env.LIBRARY_DOCS_DIR || resolve(dataDir, 'docs'),
    dbPath: env.LIBRARY_DB || resolve(dataDir, 'index.sqlite'),
    protocolsDir: env.LIBRARY_PROTOCOLS_DIR || resolve(appRoot, 'content/protocols'),
    kiwixUrl: (env.KIWIX_URL || 'http://127.0.0.1:8783/kiwix').replace(/\/$/, ''),
    llmUrl: (env.LLM_URL || 'http://127.0.0.1:8786').replace(/\/$/, ''),
    maxDocBytes: 50 * 1024 * 1024,
  }
}
