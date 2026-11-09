import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Tarea root `ap` (scripts/admin-job.py, ADR 0009): la contraseña del AP nunca va al registro ni a argv,
 * el perfil es un keyfile 0600 y cualquier fallo al encender lo revierte todo.
 * El arnés está en Python (tests/python/test_admin_job_ap.py); se omite si no hay intérprete.
 */
const script = fileURLToPath(new URL('../../../tests/python/test_admin_job_ap.py', import.meta.url))
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)

describe.skipIf(!python)('tarea ap (admin-job.py)', () => {
  it('sin fugas de la contraseña y con reversión completa', () => {
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
