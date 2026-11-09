import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['services/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.output/**', '**/.nuxt/**', '**/dist/**'],
    environment: 'node',
    // La E/S real de la Pi (vcgencmd, sysfs) puede tardar algo más que en un PC.
    testTimeout: 15_000,
  },
})
