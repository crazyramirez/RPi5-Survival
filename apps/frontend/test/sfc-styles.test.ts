import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// fileURLToPath decodifica %20: la carpeta del proyecto puede tener espacios («D:\DEV\Survivelia Project\…»).
const APP = fileURLToPath(new URL('../app/', import.meta.url))

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith('.vue') ? [p] : []
  })
}

describe('estilos de componentes', () => {
  it('ningún <style scoped> usa ":global(X) .y" (Vue descarta ".y" y el estilo se aplica a X entero)', () => {
    const offenders: string[] = []
    for (const file of vueFiles(APP)) {
      const src = readFileSync(file, 'utf8')
      for (const block of src.matchAll(/<style[^>]*\bscoped\b[^>]*>([\s\S]*?)<\/style>/g)) {
        if (/:global\([^)]*\)\s*[^\s{,]/.test(block[1] ?? '')) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
