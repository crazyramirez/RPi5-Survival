#!/usr/bin/env node
/**
 * Desarrollo: device-api (recarga con --watch) + Nuxt dev, ambos en 127.0.0.1.
 * En Windows/macOS la mayoría de sondas devolverán "no disponible": es lo esperado.
 */
import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'
const procs = [
  ['device-api', ['run', 'dev', '-w', '@survival-os/device-api']],
  ['library', ['run', 'dev', '-w', '@survival-os/library']],
  ['navigation', ['run', 'dev', '-w', '@survival-os/navigation']],
  ['web', ['run', 'dev', '-w', '@survival-os/frontend']],
].map(([name, args]) => {
  const p = spawn(isWin ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: isWin })
  p.on('exit', (code) => {
    console.error(`[dev] ${name} terminó (code=${code})`)
    shutdown()
  })
  return p
})

let down = false
function shutdown() {
  if (down) return
  down = true
  for (const p of procs) if (p.exitCode === null) p.kill()
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
