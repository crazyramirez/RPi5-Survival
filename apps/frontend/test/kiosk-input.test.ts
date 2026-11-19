import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Dirección del trackpad en el quiosco (scripts/kiosk-input.py): edita solo <libinput> de rc.xml de labwc, conserva
 * el resto y la copia previa, y publica el estado. El arnés está en Python (tests/python/test_kiosk_input.py).
 */
const script = fileURLToPath(new URL('../../../tests/python/test_kiosk_input.py', import.meta.url))
const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0)

describe.skipIf(!python)('trackpad del quiosco (kiosk-input.py)', () => {
  it('cambia naturalScroll en rc.xml sin tocar el resto', () => {
    const r = spawnSync(python!, [script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    expect(r.stdout + r.stderr).toContain('TODO OK')
    expect(r.status).toBe(0)
  })
})
