import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Hora de respaldo sin red (scripts/time-sync.py, ADR 0011): decisión probada en Python.
 * El arnés está en tests/python/test_time_sync.py; se omite si no hay intérprete.
 */
const script = fileURLToPath(new URL('../../../tests/python/test_time_sync.py', import.meta.url))
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)

describe.skipIf(!python)('time-sync (Python)', () => {
  it('prioridades NTP > GNSS > LoRa, umbral de ajuste y datos absurdos', () => {
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
