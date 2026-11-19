import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Tarea root `bluetooth` (scripts/admin-job.py) y motor scripts/bt-input.py: lista cerrada de acciones, MAC
 * validada, sin shell, y clasificación de teclados/ratones/mandos. El arnés está en Python
 * (tests/python/test_bluetooth.py); se omite si no hay intérprete.
 */
const script = fileURLToPath(new URL('../../../tests/python/test_bluetooth.py', import.meta.url))
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)

describe.skipIf(!python)('tarea bluetooth (admin-job.py + bt-input.py)', () => {
  it('valida acciones y direcciones y clasifica los dispositivos', () => {
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
