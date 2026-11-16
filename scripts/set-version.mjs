#!/usr/bin/env node
/**
 * Versión única del monorepo (ADR 0021): todos los package.json y package-lock.json con la misma versión.
 *
 *   npm run set-version -- 0.10.0     fija la versión en todos
 *   npm run set-version               solo comprueba (código 1 si no coinciden)
 *
 * La versión publicada sale de aquí: VERSION de la release, app/VERSION de la portable, versionName del APK y la que
 * comparan las instalaciones para actualizarse.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion } from './update-lib.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Carpetas de los workspaces (relativas a la raíz, con «/»), expandiendo «dir/*». */
export function workspaceDirs(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const out = []
  for (const w of pkg.workspaces ?? []) {
    if (w.endsWith('/*')) {
      const base = w.slice(0, -2)
      for (const d of readdirSync(join(root, base), { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(root, base, d.name, 'package.json'))) out.push(`${base}/${d.name}`)
      }
    } else if (existsSync(join(root, w, 'package.json'))) out.push(w)
  }
  return out.sort()
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Nombres de los paquetes del propio monorepo (@survival-os/…). */
function workspaceNames(root) {
  return new Set(workspaceDirs(root).map((d) => JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8')).name))
}

/**
 * Dependencias internas fijadas a otra versión: npm las buscaría en el registro público (404 en un clon nuevo con
 * `npm ci`). → [{ file, dep, version }]
 */
function internalDepMismatches(pkg, names, version, file) {
  const out = []
  for (const f of DEP_FIELDS) {
    for (const [dep, v] of Object.entries(pkg?.[f] ?? {})) if (names.has(dep) && v !== version) out.push({ file: `${file} → ${dep}`, version: v })
  }
  return out
}

/** → { version, mismatches: [{ file, version }] } (version = la del package.json raíz). */
export function checkVersions(root = ROOT) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const names = workspaceNames(root)
  const mismatches = []
  for (const dir of workspaceDirs(root)) {
    const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    if (pkg.version !== version) mismatches.push({ file: `${dir}/package.json`, version: pkg.version })
    mismatches.push(...internalDepMismatches(pkg, names, version, `${dir}/package.json`))
  }
  const lockFile = join(root, 'package-lock.json')
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
    if (lock.version !== version) mismatches.push({ file: 'package-lock.json', version: lock.version })
    for (const key of ['', ...workspaceDirs(root)]) {
      const v = lock.packages?.[key]?.version
      if (lock.packages?.[key] && v !== version) mismatches.push({ file: `package-lock.json → ${key || '(raíz)'}`, version: v })
      mismatches.push(...internalDepMismatches(lock.packages?.[key], names, version, `package-lock.json → ${key || '(raíz)'}`))
    }
  }
  return { version, mismatches }
}

/** Reescribe un JSON conservando el formato de 2 espacios y el salto de línea final. */
function rewrite(file, mutate) {
  const raw = readFileSync(file, 'utf8')
  const obj = JSON.parse(raw)
  mutate(obj)
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`)
}

export function setVersion(version, root = ROOT) {
  if (!parseVersion(version)) throw new Error(`versión no válida: ${version} (formato X.Y.Z)`)
  const names = workspaceNames(root)
  // Las dependencias entre paquetes del monorepo siguen a la versión (si no, npm ci las busca en el registro).
  const syncDeps = (pkg) => {
    for (const f of DEP_FIELDS) for (const dep of Object.keys(pkg?.[f] ?? {})) if (names.has(dep)) pkg[f][dep] = version
  }
  rewrite(join(root, 'package.json'), (p) => {
    p.version = version
    syncDeps(p)
  })
  const dirs = workspaceDirs(root)
  for (const dir of dirs) {
    rewrite(join(root, dir, 'package.json'), (p) => {
      p.version = version
      syncDeps(p)
    })
  }
  const lockFile = join(root, 'package-lock.json')
  if (existsSync(lockFile)) {
    rewrite(lockFile, (lock) => {
      lock.version = version
      for (const key of ['', ...dirs]) {
        if (!lock.packages?.[key]) continue
        lock.packages[key].version = version
        syncDeps(lock.packages[key])
      }
    })
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const wanted = process.argv[2]
  if (wanted) {
    try {
      setVersion(wanted)
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : err}`)
      process.exit(2)
    }
  }
  const { version, mismatches } = checkVersions()
  if (mismatches.length) {
    console.error(`Versión del monorepo: ${version}. No coinciden:`)
    for (const m of mismatches) console.error(`  ${m.file}: ${m.version}`)
    console.error('Arreglo: npm run set-version -- <X.Y.Z>')
    process.exit(1)
  }
  console.log(`Versión ${version} en todos los paquetes${wanted ? ' (actualizada)' : ''}.`)
}
