import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Pasarela Meshtastic (services/mesh/survival_mesh.py): funciones puras probadas en Python.
 * El arnés está en tests/python/test_survival_mesh.py; se omite si no hay intérprete.
 */
const script = fileURLToPath(new URL('../../../tests/python/test_survival_mesh.py', import.meta.url))
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)

describe.skipIf(!python)('survival-mesh (Python)', () => {
  it('nodos sin datos inventados, mensajes, validación y almacenamiento', () => {
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
