import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { isLoopbackHost, loadConfig } from './config.ts'
import { createStatusCache } from './status.ts'

const config = loadConfig()
const VERSION = readVersion()
const startedAt = Date.now()
const getStatus = createStatusCache(config.mounts, config.cacheSeconds * 1000)

const LEVELS = { info: 0, warn: 1, error: 2 } as const
function log(level: keyof typeof LEVELS, msg: string, extra: Record<string, unknown> = {}): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return
  // Una línea JSON por evento. Nunca registrar contenido privado.
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, svc: 'device-api', msg, ...extra })}\n`)
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'method_not_allowed' })
    return
  }
  const path = (req.url ?? '/').split('?')[0]
  switch (path) {
    case '/health':
      send(res, 200, {
        status: 'ok',
        service: 'device-api',
        version: VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      })
      return
    case '/status':
      send(res, 200, await getStatus())
      return
    default:
      send(res, 404, { error: 'not_found' })
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    log('error', 'request_failed', { error: err instanceof Error ? err.message : String(err) })
    if (!res.headersSent) send(res, 500, { error: 'internal_error' })
    else res.end()
  })
})

server.requestTimeout = 10_000
server.headersTimeout = 5_000

if (!isLoopbackHost(config.host)) {
  log('warn', 'listening_on_non_loopback', { host: config.host })
}

server.listen(config.port, config.host, () => {
  log('info', 'listening', { host: config.host, port: config.port, version: VERSION })
})

server.on('error', (err) => {
  log('error', 'server_error', { error: err.message })
  process.exitCode = 1
})

function shutdown(signal: string): void {
  log('info', 'shutdown', { signal })
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
