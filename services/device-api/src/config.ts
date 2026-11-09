export interface DeviceApiConfig {
  host: string
  port: number
  cacheSeconds: number
  mounts: string[]
  logLevel: 'info' | 'warn' | 'error'
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? Number.NaN : Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DeviceApiConfig {
  const level = env.LOG_LEVEL
  return {
    host: env.DEVICE_API_HOST || '127.0.0.1',
    port: int(env.DEVICE_API_PORT, 8781, 1, 65535),
    cacheSeconds: int(env.DEVICE_API_CACHE_SECONDS, 5, 0, 300),
    mounts: (env.DEVICE_API_MOUNTS || (process.platform === 'linux' ? '/,/boot/firmware' : '/'))
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    logLevel: level === 'warn' || level === 'error' ? level : 'info',
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.')
}
