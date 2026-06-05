// vitest.main.config.ts
// Source: RESEARCH.md §9 (Vitest Setup for Main-Process Tests)
// Refs: vitest.dev/config, vitest.dev/guide/environment
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'src/preload/**/*.test.ts'],
    exclude: ['src/renderer/**', 'node_modules/**'],
    setupFiles: ['./vitest.setup.main.ts'],
  },
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared'),
      '@preload': resolve('src/preload'),
    },
  },
})
