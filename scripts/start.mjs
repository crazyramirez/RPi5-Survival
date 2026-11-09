#!/usr/bin/env node
/**
 * Arranque de producción manual (Fase 1): device-api + servidor web, ambos en loopback.
 * Si uno de los dos muere, se detiene el otro y se sale con error (systemd o el
 * operador decidirán reiniciar; aquí no hay bucles de reinicio).
 *
 * Variables: ver .env.example. Rutas sobrescribibles con DEVICE_API_ENTRY / WEB_ENTRY.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const deviceEntry = process.env.DEVICE_API_ENTRY ?? resolve(root, 'services/device-api/dist/server.js')
const webEntry = process.env.WEB_ENTRY ?? resolve(root, 'apps/frontend/.output/server/index.mjs')

for (const f of [deviceEntry, webEntry]) {
  if (!existsSync(f)) {
    console.error(`[start] No existe ${f}. ¿Has ejecutado "npm run build"?`)
    process.exit(1)
  }
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  NITRO_HOST: process.env.NITRO_HOST ?? '127.0.0.1',
  NITRO_PORT: process.env.NITRO_PORT ?? '3000',
  DEVICE_API_HOST: process.env.DEVICE_API_HOST ?? '127.0.0.1',
  DEVICE_API_PORT: process.env.DEVICE_API_PORT ?? '8781',
}
env.NUXT_DEVICE_API_URL ??= `http://127.0.0.1:${env.DEVICE_API_PORT}`

const children = []
let stopping = false

function launch(name, entry) {
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('exit', (code, signal) => {
    if (stopping) return
    console.error(`[start] ${name} terminó (code=${code}, signal=${signal}). Deteniendo el resto.`)
    stop(1)
  })
  children.push(child)
  return child
}

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
  setTimeout(() => process.exit(exitCode), 4000).unref()
  Promise.all(children.map((c) => (c.exitCode === null ? new Promise((r) => c.once('exit', r)) : null))).then(() =>
    process.exit(exitCode),
  )
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

launch('device-api', deviceEntry)
launch('web', webEntry)
console.log(`[start] Survival OS en http://${env.NITRO_HOST}:${env.NITRO_PORT} (device-api ${env.DEVICE_API_HOST}:${env.DEVICE_API_PORT})`)
