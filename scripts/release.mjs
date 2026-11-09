#!/usr/bin/env node
/**
 * Empaqueta una release instalable en la Pi (sin node_modules de desarrollo):
 *   release/survival-os-<versión>.tar.gz  +  .sha256
 * Requiere haber ejecutado `npm run build`. Se construye en el PC: la Pi no compila.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = `survival-os-${version}`
const outDir = join(root, 'release')
const stage = join(outDir, name)

const required = ['apps/frontend/.output/server/index.mjs', 'services/device-api/dist/server.js']
for (const f of required) {
  if (!existsSync(join(root, f))) {
    console.error(`[release] Falta ${f}. Ejecuta "npm run build" primero.`)
    process.exit(1)
  }
}

// Nitro lista en .output/server/package.json las dependencias que trazó; si falta alguna en
// node_modules (build interrumpido o dos builds a la vez), el servidor no arranca en la Pi.
const serverDir = join(root, 'apps/frontend/.output/server')
const serverDeps = Object.keys(JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8')).dependencies ?? {})
const missingDeps = serverDeps.filter((d) => !existsSync(join(serverDir, 'node_modules', d, 'package.json')))
if (missingDeps.length) {
  console.error(`[release] .output incompleto, faltan: ${missingDeps.join(', ')}. Borra apps/frontend/.output y .nuxt y recompila.`)
  process.exit(1)
}

// El trazado de Nitro a veces omite dependencias anidadas (p. ej. estree-walker 2 de
// @vue/compiler-core) sin listarlas: solo arrancar el servidor lo detecta. Se arranca en un
// puerto libre de loopback y debe seguir vivo y responder a /api/health.
{
  const { spawn } = await import('node:child_process')
  const { createServer } = await import('node:net')
  const port = await new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => ok(p))
    })
  })
  // Copia fuera del repo: si no, Node resolvería lo que falte en el node_modules del monorepo.
  const { tmpdir } = await import('node:os')
  const smokeDir = join(tmpdir(), `survival-os-smoke-${process.pid}`)
  rmSync(smokeDir, { recursive: true, force: true })
  cpSync(join(root, 'apps/frontend/.output'), smokeDir, { recursive: true })
  const child = spawn(process.execPath, [join(smokeDir, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  let healthy = false
  for (let i = 0; i < 40 && child.exitCode === null && !healthy; i++) {
    await new Promise((r) => setTimeout(r, 250))
    // 503 = «degradado» (sin device-api ni el resto de servicios, como en el PC): el servidor web SÍ arrancó.
    healthy = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.status < 500 || r.status === 503, () => false)
  }
  // La página debe ser de PRODUCCIÓN: si un `nuxt dev` regeneró .nuxt durante el build, el HTML
  // apunta a /_nuxt/@vite/client y a rutas del PC, /api/health responde igual y la app se queda
  // en blanco en la Pi.
  let pageProblem = null
  if (healthy) {
    const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text(), () => '')
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
    if (!html) pageProblem = 'GET / no responde'
    else if (/@vite\/client|\/@fs\/|[A-Za-z]:\/DEV\//.test(html)) pageProblem = 'el HTML es de nuxt dev (@vite/client o rutas del PC)'
    else if (!scripts.length) pageProblem = 'el HTML no carga ningún script'
    else {
      const missing = scripts.filter((src) => !src.startsWith('/_nuxt/') || !existsSync(join(smokeDir, 'public', src)))
      if (missing.length) pageProblem = `scripts ausentes en public/: ${missing.join(', ')}`
    }
  }
  child.kill()
  await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
  rmSync(smokeDir, { recursive: true, force: true })
  if (!healthy || pageProblem) {
    const why = healthy ? pageProblem : `el servidor no arranca\n${stderr.slice(0, 1500)}`
    console.error(`[release] .output no válido: ${why}.\nPara todo \`nuxt dev\` de este repo, borra apps/frontend/.output y .nuxt y recompila.`)
    process.exit(1)
  }
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true })
copy('apps/frontend/.output')
copy('services/device-api/dist')
copy('services/device-api/package.json')
copy('services/library/dist')
copy('services/library/package.json')
copy('services/navigation/dist')
copy('services/navigation/package.json')
copy('services/vault/dist')
copy('services/vault/package.json')
copy('services/esp32-gateway/dist')
copy('services/esp32-gateway/package.json')
mkdirSync(join(stage, 'services/mesh'), { recursive: true })
for (const f of ['survival_mesh.py', 'requirements.txt']) copy(`services/mesh/${f}`)
copy('firmware')
copy('content')
mkdirSync(join(stage, 'scripts'), { recursive: true })
for (const f of readdirSync(join(root, 'scripts'))) {
  if (f.endsWith('.sh') || f.endsWith('.py') || f === 'start.mjs' || f === 'public-gateway.mjs') copy(`scripts/${f}`)
}
copy('systemd')
copy('kiosk')
copy('.env.example')
copy('README.md')
writeFileSync(join(stage, 'VERSION'), `${version}\n`)

// Manifiesto de integridad de todos los ficheros.
function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const sums = walk(stage)
  .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(stage, f).split('\\').join('/')}`)
  .sort((a, b) => a.slice(66).localeCompare(b.slice(66)))
writeFileSync(join(stage, 'SHA256SUMS'), `${sums.join('\n')}\n`)

const tarball = `${name}.tar.gz`
const res = spawnSync('tar', ['-czf', tarball, name], { cwd: outDir, stdio: 'inherit' })
if (res.status !== 0) {
  console.error('[release] tar falló')
  process.exit(1)
}
const digest = createHash('sha256').update(readFileSync(join(outDir, tarball))).digest('hex')
writeFileSync(join(outDir, `${tarball}.sha256`), `${digest}  ${tarball}\n`)
console.log(`[release] ${join('release', tarball)}  sha256=${digest}  ficheros=${sums.length}`)
